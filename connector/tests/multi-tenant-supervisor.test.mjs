import test from "node:test";
import assert from "node:assert/strict";
import { MultiTenantSupervisor } from "../multi-tenant-supervisor.mjs";

test("MultiTenantSupervisor starts and creates runtimes for active tenants", async () => {
  const started = [];
  const stopped = [];
  const activeTenants = [
    {
      companyId: "company-1",
      routePointDn: "8000",
      dids: ["+15551234567"],
      pbxHostname: "pbx1.3cx.cloud",
    },
    {
      companyId: "company-2",
      routePointDn: "8001",
      dids: ["+15557654321"],
      pbxHostname: "pbx2.3cx.cloud",
    },
  ];

  const supervisor = new MultiTenantSupervisor({
    fetchActiveTenants: async () => activeTenants,
    createTenantRuntime: (config) => ({
      config,
      start: async () => { started.push(config.companyId); },
      shutdown: async () => { stopped.push(config.companyId); },
    }),
    reconcileIntervalMs: 60000,
  });

  const res = await supervisor.start();
  assert.equal(res.started, true);
  assert.equal(res.runningCount, 2);
  assert.deepEqual(started.sort(), ["company-1", "company-2"]);

  const running = supervisor.getRunningTenants();
  assert.equal(running.length, 2);

  await supervisor.shutdown();
  assert.deepEqual(stopped.sort(), ["company-1", "company-2"]);
  assert.equal(supervisor.runningTenantCount, 0);
});

test("MultiTenantSupervisor dynamically reconciles additions, updates, and removals", async () => {
  let activeTenants = [
    {
      companyId: "company-1",
      routePointDn: "8000",
      dids: ["+15551000001"],
    },
  ];
  const starts = [];
  const shutdowns = [];

  const supervisor = new MultiTenantSupervisor({
    fetchActiveTenants: async () => activeTenants,
    createTenantRuntime: (config) => ({
      config,
      start: async () => { starts.push(config.companyId); },
      shutdown: async () => { shutdowns.push(config.companyId); },
    }),
    reconcileIntervalMs: 60000,
  });

  await supervisor.start();
  assert.equal(supervisor.runningTenantCount, 1);
  assert.deepEqual(starts, ["company-1"]);

  // 1. Add company-2
  activeTenants = [
    { companyId: "company-1", routePointDn: "8000", dids: ["+15551000001"] },
    { companyId: "company-2", routePointDn: "8002", dids: ["+15551000002"] },
  ];
  await supervisor.reconcile();
  assert.equal(supervisor.runningTenantCount, 2);
  assert.deepEqual(starts, ["company-1", "company-2"]);

  // 2. Update company-1 DIDs (should trigger restart)
  activeTenants = [
    { companyId: "company-1", routePointDn: "8000", dids: ["+15551000001", "+15559999999"] },
    { companyId: "company-2", routePointDn: "8002", dids: ["+15551000002"] },
  ];
  await supervisor.reconcile();
  assert.equal(supervisor.runningTenantCount, 2);
  assert.deepEqual(shutdowns, ["company-1"]);
  assert.deepEqual(starts, ["company-1", "company-2", "company-1"]);

  // 3. Remove company-2
  activeTenants = [
    { companyId: "company-1", routePointDn: "8000", dids: ["+15551000001", "+15559999999"] },
  ];
  await supervisor.reconcile();
  assert.equal(supervisor.runningTenantCount, 1);
  assert.deepEqual(shutdowns, ["company-1", "company-2"]);

  await supervisor.shutdown();
  assert.equal(supervisor.runningTenantCount, 0);
});

