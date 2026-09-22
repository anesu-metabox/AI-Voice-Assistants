import { ThreeCxCallController } from "./call-controller.mjs";
import { ThreeCxSdkEventAdapter } from "./threecx-sdk-event-adapter.mjs";

/**
 * Compose one already-authenticated PBX connection with one verified tenant.
 * Credential acquisition, database access, LiveKit signing, and PBX SDK
 * construction stay in injected workload adapters; this module never reads
 * secrets or performs cross-company lookup.
 */
export function createThreeCxTenantRuntime({
  tenantBinding,
  client,
  resolveInboundCall,
  claimCall,
  transitionCall,
  renewCallLease,
  dispatchAgent,
  createMediaBridge,
  stopAgent,
  handlePbxFallback,
  onDecision = () => {},
  onSignal = () => {},
  leaseRenewIntervalMs,
}) {
  if (!client || typeof client.connect !== "function" || typeof client.disconnect !== "function") {
    throw new TypeError("An authenticated 3CX client with connect/disconnect is required");
  }
  if (typeof createMediaBridge !== "function") {
    throw new TypeError("A tenant-bound media bridge factory is required");
  }
  if (typeof onSignal !== "function") throw new TypeError("onSignal must be a function");

  let eventAdapter;
  let state = "idle";
  let startPromise = null;
  let shutdownPromise = null;
  let lastShutdown = null;

  const controller = new ThreeCxCallController({
    tenantBinding,
    claimCall,
    transitionCall,
    renewCallLease,
    dispatchAgent,
    attachMedia: (request) => createMediaBridge({
      ...request,
      controller,
      getParticipantHandle: (participantId) => eventAdapter?.getParticipantHandle(participantId),
    }),
    stopAgent,
    handlePbxFallback,
    onDecision,
    ...(leaseRenewIntervalMs === undefined ? {} : { leaseRenewIntervalMs }),
  });

  eventAdapter = new ThreeCxSdkEventAdapter({
    client,
    controller,
    routePointDn: controller.binding.routePointDn,
    resolveInboundCall,
    onSignal,
  });

  return Object.freeze({
    controller,
    get state() { return state; },

    /** Concurrent starts share one connection attempt. A failed start is terminal. */
    start() {
      if (state === "starting") return startPromise;
      if (state === "running") return Promise.resolve({ started: true, state });
      if (state !== "idle") throw new Error("3CX tenant runtime cannot be restarted");
      state = "starting";
      startPromise = (async () => {
        eventAdapter.start();
        try {
          await client.connect();
          state = "running";
          signal("tenant_runtime_started");
          return { started: true, state };
        } catch {
          const shutdown = await eventAdapter.shutdown();
          lastShutdown = shutdown;
          state = shutdown?.stopped ? "failed" : "draining";
          signal(shutdown?.stopped ? "tenant_runtime_start_failed" : "tenant_runtime_start_cleanup_incomplete");
          throw new Error("threecx_tenant_runtime_start_failed");
        }
      })();
      return startPromise;
    },

    /** Drain calls before disconnect; an incomplete drain remains retryable. */
    shutdown() {
      if (shutdownPromise) return shutdownPromise;
      if (state === "stopped") return Promise.resolve(lastShutdown);
      shutdownPromise = (async () => {
        if (startPromise) {
          try { await startPromise; } catch { /* Startup already attempted cleanup. */ }
        }
        if (state === "failed") return lastShutdown || { stopped: true, calls: [] };
        state = "draining";
        const result = await eventAdapter.shutdown();
        lastShutdown = result;
        state = result?.stopped ? "stopped" : "draining";
        return result;
      })();
      return shutdownPromise.finally(() => { shutdownPromise = null; });
    },
  });

  function signal(reason) {
    try { onSignal({ reason }); } catch { /* Diagnostics cannot affect call safety. */ }
  }
}
