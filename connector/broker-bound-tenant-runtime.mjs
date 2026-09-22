import { createThreeCxTenantRuntime } from "./threecx-tenant-runtime.mjs";

/**
 * Compose one broker-issued tenant lease into the single-tenant 3CX runtime.
 *
 * The broker contract deliberately returns an authenticated PBX client and a
 * minimum verified binding; this module never receives, logs, decrypts, or
 * forwards raw credentials. The concrete broker transport, workload identity,
 * Neon repositories, and lease implementation remain injected deployment
 * adapters.
 */
export function createBrokerBoundTenantRuntime({
  acquireTenantLease,
  releaseTenantLease,
  createThreeCxRuntime = createThreeCxTenantRuntime,
  tenantRef,
  runtimeOptions = {},
}) {
  if (typeof acquireTenantLease !== "function") {
    throw new TypeError("acquireTenantLease must be a function");
  }
  if (typeof releaseTenantLease !== "function") {
    throw new TypeError("releaseTenantLease must be a function");
  }
  if (typeof createThreeCxRuntime !== "function") {
    throw new TypeError("createThreeCxRuntime must be a function");
  }
  if (!isTenantRef(tenantRef)) throw new TypeError("A bounded tenant reference is required");

  let state = "idle";
  let startPromise = null;
  let runtime = null;
  let lease = null;
  let releasePromise = null;
  let leaseExpiryTimer = null;
  let publicApi = null;

  const api = Object.freeze({
    get state() { return state; },
    get runtime() { return runtime; },

    start() {
      if (state === "starting") return startPromise;
      if (state === "running") return Promise.resolve({ started: true, state });
      if (state !== "idle") throw new Error("broker-bound tenant runtime cannot be restarted");
      state = "starting";
      startPromise = (async () => {
        let acquired;
        try {
          acquired = await acquireTenantLease(tenantRef);
          if (!isLease(acquired, tenantRef)) throw new Error("tenant_lease_invalid");
          lease = acquired;
          // A lease exposes only an already-authenticated client and verified
          // binding. Never let runtime options override either tenant value.
          runtime = createThreeCxRuntime({
            ...runtimeOptions,
            tenantBinding: lease.tenantBinding,
            client: lease.client,
          });
          if (!runtime || typeof runtime.start !== "function" || typeof runtime.shutdown !== "function") {
            throw new Error("tenant_runtime_invalid");
          }
          await runtime.start();
          armLeaseExpiryWatchdog();
          state = "running";
          return { started: true, state };
        } catch {
          let releaseFailed = false;
          try {
            await releaseOnce();
          } catch {
            releaseFailed = true;
          }
          clearLeaseExpiryWatchdog();
          runtime = null;
          // If the broker could not revoke the lease, keep it attached to a
          // retryable draining state. Reporting failed/stopped here would
          // allow the caller to forget an authorization lease that remains
          // active in the broker.
          if (!releaseFailed) lease = null;
          state = releaseFailed && lease ? "draining" : "failed";
          throw new Error("broker_bound_tenant_runtime_start_failed");
        }
      })();
      return startPromise;
    },

    async shutdown() {
      if (state === "stopped") return { stopped: true };
      if (state === "starting" && startPromise) {
        try { await startPromise; } catch { /* startup already released its lease */ }
      }
      if (state === "stopped") return { stopped: true };
      state = "stopping";
      try {
        const runtimeResult = runtime ? await runtime.shutdown() : { stopped: true };
        if (runtimeResult?.stopped === false) {
          // Keep the client and lease alive: the underlying runtime still has
          // calls or listeners and must be retried before another worker can
          // acquire this tenant.
          state = "draining";
          return runtimeResult;
        }
        try {
          await releaseOnce();
        } catch {
          state = "draining";
          throw new Error("broker_bound_tenant_runtime_release_failed");
        }
        clearLeaseExpiryWatchdog();
        runtime = null;
        lease = null;
        state = "stopped";
        return runtimeResult;
      } catch (error) {
        state = "draining";
        throw error;
      }
    },
  });
  publicApi = api;
  return api;

  async function releaseOnce() {
    if (!lease) return;
    if (!releasePromise) {
      const currentLease = lease;
      releasePromise = Promise.resolve(releaseTenantLease(currentLease)).finally(() => {
        releasePromise = null;
      });
    }
    await releasePromise;
  }

  function armLeaseExpiryWatchdog() {
    clearLeaseExpiryWatchdog();
    const delayMs = Math.max(0, lease.expiresAt - Date.now());
    leaseExpiryTimer = setTimeout(() => {
      if (state !== "running") return;
      void shutdownAfterLeaseExpiry();
    }, delayMs);
    leaseExpiryTimer.unref?.();
  }

  async function shutdownAfterLeaseExpiry() {
    try {
      await thisRuntimeShutdown();
    } catch {
      // The runtime remains in draining state for an explicit retry; never
      // release an expired lease while PBX listeners or calls remain active.
    }
  }

  async function thisRuntimeShutdown() {
    // Keep the public shutdown implementation as the single cleanup path.
    return publicApi.shutdown();
  }

  function clearLeaseExpiryWatchdog() {
    if (leaseExpiryTimer) clearTimeout(leaseExpiryTimer);
    leaseExpiryTimer = null;
  }
}

function isTenantRef(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 255;
}

function isLease(value, tenantRef) {
  return Boolean(
    value && typeof value === "object"
      && typeof value.leaseId === "string" && value.leaseId.length > 0 && value.leaseId.length <= 255
      && value.tenantRef === tenantRef
      && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now()
      && value.client && typeof value.client.connect === "function"
      && typeof value.client.disconnect === "function"
      && value.tenantBinding && typeof value.tenantBinding === "object"
  );
}
