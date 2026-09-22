import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createBrokerBoundTenantRuntime } from "../broker-bound-tenant-runtime.mjs";

const binding = {
  companyId: "123e4567-e89b-12d3-a456-426614174111",
  authSubject: "auth-subject",
  profileVersion: 4,
  timezone: "Indian/Mauritius",
};

class Client extends EventEmitter {
  async connect() {}
  async disconnect() {}
}

function lease(tenantRef = "company-111") {
  return {
    leaseId: "lease-opaque",
    tenantRef,
    expiresAt: Date.now() + 60_000,
    client: new Client(),
    tenantBinding: binding,
  };
}

test("broker-bound runtime single-flights lease acquisition and releases on shutdown", async () => {
  let acquisitions = 0;
  let releases = 0;
  let starts = 0;
  let shutdowns = 0;
  let resolveLease;
  const pendingLease = new Promise((resolve) => { resolveLease = resolve; });
  const runtime = createBrokerBoundTenantRuntime({
    tenantRef: "company-111",
    acquireTenantLease: async (ref) => {
      assert.equal(ref, "company-111");
      acquisitions += 1;
      return pendingLease;
    },
    releaseTenantLease: async (current) => {
      assert.equal(current.tenantBinding, binding);
      releases += 1;
    },
    createThreeCxRuntime: ({ client, tenantBinding }) => {
      assert.equal(client instanceof Client, true);
      assert.equal(tenantBinding, binding);
      return {
        async start() { starts += 1; },
        async shutdown() { shutdowns += 1; return { stopped: true }; },
      };
    },
  });

  const first = runtime.start();
  const second = runtime.start();
  assert.equal(first, second);
  assert.equal(acquisitions, 1);
  resolveLease(lease());
  await first;
  assert.equal(runtime.state, "running");
  assert.equal(starts, 1);
  assert.deepEqual(await runtime.shutdown(), { stopped: true });
  assert.equal(shutdowns, 1);
  assert.equal(releases, 1);
  assert.equal(runtime.state, "stopped");
});

test("failed runtime startup releases the lease and never leaks a raw credential field", async () => {
  let releases = 0;
  const current = {
    ...lease(),
    tenantRef: "company-222",
    clientSecret: "must-not-be-read",
  };
  const runtime = createBrokerBoundTenantRuntime({
    tenantRef: "company-222",
    acquireTenantLease: async () => current,
    releaseTenantLease: async (released) => {
      releases += 1;
      assert.equal(released, current);
    },
    createThreeCxRuntime: ({ tenantBinding, client }) => {
      assert.deepEqual(tenantBinding, binding);
      assert.equal(client instanceof Client, true);
      throw new Error("runtime setup failed");
    },
  });

  await assert.rejects(runtime.start(), /broker_bound_tenant_runtime_start_failed/);
  assert.equal(releases, 1);
  assert.equal(runtime.state, "failed");
  assert.equal(runtime.runtime, null);
});

test("lease and tenant references are validated before any broker call", () => {
  let called = false;
  assert.throws(() => createBrokerBoundTenantRuntime({
    tenantRef: "",
    acquireTenantLease: async () => { called = true; },
    releaseTenantLease: async () => {},
  }), /tenant reference/);
  assert.equal(called, false);
});

test("expired and cross-tenant leases fail closed before runtime construction", async () => {
  let runtimeCreated = false;
  for (const invalidLease of [
    { ...lease(), tenantRef: "company-other" },
    { ...lease("company-lease-check"), expiresAt: Date.now() - 1 },
  ]) {
    const runtime = createBrokerBoundTenantRuntime({
      tenantRef: "company-lease-check",
      acquireTenantLease: async () => invalidLease,
      releaseTenantLease: async () => {},
      createThreeCxRuntime: () => { runtimeCreated = true; throw new Error("must not create"); },
    });
    await assert.rejects(runtime.start(), /broker_bound_tenant_runtime_start_failed/);
  }
  assert.equal(runtimeCreated, false);
});

test("incomplete shutdown retains the lease and remains retryable", async () => {
  let releases = 0;
  let shutdowns = 0;
  const runtime = createBrokerBoundTenantRuntime({
    tenantRef: "company-draining",
    acquireTenantLease: async () => lease("company-draining"),
    releaseTenantLease: async () => { releases += 1; },
    createThreeCxRuntime: () => ({
      async start() {},
      async shutdown() {
        shutdowns += 1;
        return shutdowns === 1 ? { stopped: false, calls: ["still-active"] } : { stopped: true };
      },
    }),
  });

  await runtime.start();
  assert.deepEqual(await runtime.shutdown(), { stopped: false, calls: ["still-active"] });
  assert.equal(runtime.state, "draining");
  assert.equal(releases, 0);
  assert.deepEqual(await runtime.shutdown(), { stopped: true });
  assert.equal(runtime.state, "stopped");
  assert.equal(releases, 1);
});

test("lease-release failure never reports a clean stop and can be retried", async () => {
  let releaseAttempts = 0;
  const runtime = createBrokerBoundTenantRuntime({
    tenantRef: "company-release-retry",
    acquireTenantLease: async () => lease("company-release-retry"),
    releaseTenantLease: async () => {
      releaseAttempts += 1;
      if (releaseAttempts === 1) throw new Error("broker unavailable");
    },
    createThreeCxRuntime: () => ({
      async start() {},
      async shutdown() { return { stopped: true }; },
    }),
  });

  await runtime.start();
  await assert.rejects(runtime.shutdown(), /broker_bound_tenant_runtime_release_failed/);
  assert.equal(runtime.state, "draining");
  assert.ok(runtime.runtime);
  assert.deepEqual(await runtime.shutdown(), { stopped: true });
  assert.equal(runtime.state, "stopped");
  assert.equal(releaseAttempts, 2);
});

test("lease expiry initiates the same guarded shutdown path", async () => {
  let shutdowns = 0;
  let releases = 0;
  const runtime = createBrokerBoundTenantRuntime({
    tenantRef: "company-expiry",
    acquireTenantLease: async () => ({
      ...lease("company-expiry"),
      expiresAt: Date.now() + 20,
    }),
    releaseTenantLease: async () => { releases += 1; },
    createThreeCxRuntime: () => ({
      async start() {},
      async shutdown() { shutdowns += 1; return { stopped: true }; },
    }),
  });

  await runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(shutdowns, 1);
  assert.equal(releases, 1);
  assert.equal(runtime.state, "stopped");
});
