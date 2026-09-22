import test from "node:test";
import assert from "node:assert/strict";
import { ThreeCxCallController } from "../call-controller.mjs";

const companyId = "11111111-1111-4111-8111-111111111111";
const authSubject = "auth-user-456";

function setup(overrides = {}) {
  const calls = new Map();
  const eventIds = new Set();
  const dispatches = [];
  const mediaAttachments = [];
  const stops = [];
  const fallbacks = [];
  const transitions = [];
  let mediaCloses = 0;
  const {
    leaseRenewIntervalMs = 15000,
    claimGate,
    tenantBinding: tenantBindingOverrides = {},
    ...dependencyOverrides
  } = overrides;

  const dependencies = {
    async claimCall(input) {
      if (claimGate) await claimGate;
      const eventKey = `${input.companyId}:${input.eventId}`;
      const callKey = `${input.companyId}:${input.pbxCallId}`;
      if (eventIds.has(eventKey)) return { claimed: false, reason: "duplicate_event" };
      eventIds.add(eventKey);
      if (calls.has(callKey)) return { claimed: false, reason: "duplicate" };
      const call = {
        state: "claimed",
        claim_token: `secret-claim-${input.pbxCallId}`,
        livekit_room: "threecx-0123456789abcdef0123456789abcdef",
      };
      calls.set(callKey, call);
      return { claimed: true, call };
    },
    async transitionCall(input) {
      const row = calls.get(`${input.companyId}:${input.pbxCallId}`);
      transitions.push({ expected: input.expectedState, next: input.newState });
      if (!row || row.claim_token !== input.claimToken || row.state !== input.expectedState) return false;
      row.state = input.newState;
      row.dispatchId = input.livekitDispatchId || row.dispatchId;
      return true;
    },
    async renewCallLease() { return true; },
    async dispatchAgent(input) {
      dispatches.push(input);
      return { dispatchId: "dispatch-opaque-id" };
    },
    async attachMedia(input) {
      mediaAttachments.push(input);
      return { close: async () => { mediaCloses += 1; } };
    },
    async stopAgent(input) { stops.push(input); },
    async handlePbxFallback(input) { fallbacks.push(input); return true; },
    onDecision() {},
    ...dependencyOverrides,
  };
  const controller = new ThreeCxCallController({
    tenantBinding: {
      companyId,
      authSubject,
      timezone: "Indian/Mauritius",
      profileVersion: 7,
      integrationId: "tenant-integration-opaque-id",
      routePointDn: "800",
      dids: ["+2305550100"],
      transferDestinations: [],
      failureAction: "disconnect",
      failureDestination: null,
      ...tenantBindingOverrides,
    },
    ...dependencies,
    leaseRenewIntervalMs,
  });
  return { controller, calls, dispatches, mediaAttachments, stops, fallbacks, transitions, get mediaCloses() { return mediaCloses; } };
}

function joined(overrides = {}) {
  return {
    type: "routepoint_participant_connected",
    eventId: "event-1",
    callId: "pbx-call-secret",
    routePointDn: "800",
    did: "+2305550100",
    direction: "inbound",
    participantId: 42,
    ...overrides,
  };
}

function ended(overrides = {}) {
  return {
    type: "routepoint_call_ended",
    eventId: "event-end-1",
    callId: "pbx-call-secret",
    routePointDn: "800",
    ...overrides,
  };
}

test("rejects events outside the bound Route Point, DID, and inbound direction before claiming", async () => {
  let claimCount = 0;
  const app = setup({ claimCall: async () => { claimCount += 1; return { claimed: false }; } });
  assert.equal((await app.controller.handleEvent(joined({ routePointDn: "801" }))).reason, "invalid_route_point_event");
  assert.equal((await app.controller.handleEvent(joined({ did: "+2305550199" }))).reason, "unconfigured_did");
  assert.equal((await app.controller.handleEvent(joined({ direction: "outbound" }))).reason, "unsupported_direction");
  assert.equal(claimCount, 0);
  assert.equal(app.dispatches.length, 0);
});

test("claims, dispatches one profile-bound agent, attaches media, and cleans up on hang-up", async () => {
  const app = setup();
  assert.deepEqual(await app.controller.handleEvent(joined()), { accepted: true, reason: "call_active" });
  assert.equal(app.dispatches.length, 1);
  assert.equal(app.dispatches[0].companyId, companyId);
  assert.equal(app.dispatches[0].authSubject, authSubject);
  assert.equal(app.dispatches[0].timezone, "Indian/Mauritius");
  assert.equal(app.dispatches[0].profileVersion, 7);
  assert.equal(app.dispatches[0].roomName, "threecx-0123456789abcdef0123456789abcdef");
  assert.equal(Object.hasOwn(app.dispatches[0], "pbxCallId"), false);
  assert.equal(app.dispatches[0].userIdentity, `threecx-${app.dispatches[0].sessionId}`);
  assert.equal(app.mediaAttachments[0].pbxParticipantId, 42);

  const endResult = await app.controller.handleEvent(ended());
  assert.equal(endResult.reason, "call_ended");
  assert.equal(app.mediaCloses, 1);
  assert.equal(app.stops.length, 1);
  assert.deepEqual(app.transitions.map(({ expected, next }) => `${expected}->${next}`), [
    "claimed->connecting", "connecting->active", "active->ending", "ending->ended",
  ]);
  assert.equal(app.stops[0].roomName, "threecx-0123456789abcdef0123456789abcdef");
  assert.equal(Object.hasOwn(app.stops[0], "pbxCallId"), false);
  assert.equal((await app.controller.handleEvent(ended())).reason, "call_not_tracked");
});

test("does not dispatch a duplicate event or a second claim for the same PBX call", async () => {
  const app = setup();
  assert.equal((await app.controller.handleEvent(joined())).reason, "call_active");
  assert.equal((await app.controller.handleEvent(joined())).reason, "duplicate_event");
  assert.equal((await app.controller.handleEvent(joined({ eventId: "event-2" }))).reason, "call_not_claimed");
  assert.equal(app.dispatches.length, 1);
});

test("dispatch failure marks the durable claim failed and never attaches media", async () => {
  const app = setup({
    dispatchAgent: async () => { throw new Error("provider error with secret"); },
    tenantBinding: {
      transferDestinations: ["8001"],
      failureAction: "transfer",
      failureDestination: "8001",
    },
  });
  assert.equal((await app.controller.handleEvent(joined())).reason, "dispatch_failed");
  assert.equal(app.calls.get(`${companyId}:pbx-call-secret`).state, "failed");
  assert.deepEqual(app.transitions.slice(-2).map(({ expected, next }) => `${expected}->${next}`), [
    "connecting->ending", "ending->failed",
  ]);
  assert.equal(app.fallbacks.length, 1);
  assert.equal(app.fallbacks[0].reason, "dispatch_failed");
  assert.equal(app.fallbacks[0].failureAction, "transfer");
  assert.equal(app.fallbacks[0].failureDestination, "8001");
  assert.equal(app.stops.length, 0);
  assert.equal(app.mediaCloses, 0);
});

test("media failure stops the already-created agent and never marks the call active", async () => {
  const order = [];
  let app;
  app = setup({
    attachMedia: async () => { throw new Error("unsafe provider details"); },
    stopAgent: async () => { order.push("stop_agent"); app.stops.push({}); },
    handlePbxFallback: async (input) => { order.push("pbx_fallback"); app.fallbacks.push(input); return true; },
  });
  assert.equal((await app.controller.handleEvent(joined())).reason, "media_bridge_failed");
  assert.equal(app.calls.get(`${companyId}:pbx-call-secret`).state, "failed");
  assert.equal(app.stops.length, 1);
  assert.deepEqual(order, ["stop_agent", "pbx_fallback"]);
  assert.equal(app.fallbacks.length, 1);
  assert.equal(app.fallbacks[0].reason, "media_bridge_failed");
  assert.equal(app.transitions.some(({ next }) => next === "active"), false);
});

test("keeps failed startup recoverable and retries the PBX fallback during shutdown", async () => {
  let fallbackAttempts = 0;
  const app = setup({
    attachMedia: async () => { throw new Error("media startup failed"); },
    handlePbxFallback: async () => ++fallbackAttempts > 1,
  });

  assert.equal((await app.controller.handleEvent(joined())).reason, "failure_fallback_incomplete");
  assert.equal(app.calls.get(`${companyId}:pbx-call-secret`).state, "ending");
  assert.equal(app.fallbacks.length, 0);
  assert.equal(app.stops.length, 1);

  const shutdown = await app.controller.shutdown();
  assert.equal(shutdown.stopped, true);
  assert.equal(fallbackAttempts, 2);
  assert.equal(app.calls.get(`${companyId}:pbx-call-secret`).state, "ended");
});

test("serializes active media failure through cleanup and the tenant PBX fallback", async () => {
  const order = [];
  let app;
  app = setup({
    attachMedia: async () => ({ close: async () => { order.push("close_media"); } }),
    stopAgent: async () => { order.push("stop_agent"); },
    handlePbxFallback: async (input) => {
      order.push("pbx_fallback");
      app.fallbacks.push(input);
      return true;
    },
  });
  assert.equal((await app.controller.handleEvent(joined())).reason, "call_active");
  const sessionId = app.dispatches[0].sessionId;

  assert.equal(
    (await app.controller.handleMediaFailure({ sessionId, reason: "arbitrary_provider_payload" })).reason,
    "invalid_media_failure",
  );
  assert.equal(app.fallbacks.length, 0);
  assert.equal(app.calls.get(`${companyId}:pbx-call-secret`).state, "active");

  assert.equal(
    (await app.controller.handleMediaFailure({ sessionId, reason: "livekit_room_disconnected" })).reason,
    "call_failed_after_media_fallback",
  );
  assert.deepEqual(order, ["close_media", "stop_agent", "pbx_fallback"]);
  assert.equal(app.fallbacks[0].reason, "livekit_room_disconnected");
  assert.equal(app.calls.get(`${companyId}:pbx-call-secret`).state, "failed");
  assert.equal((await app.controller.handleEvent(ended())).reason, "call_not_tracked");
});

test("keeps active media failure recoverable when its fallback is unsuccessful", async () => {
  let fallbackAttempts = 0;
  const app = setup({
    handlePbxFallback: async () => ++fallbackAttempts > 1,
  });
  assert.equal((await app.controller.handleEvent(joined())).reason, "call_active");
  const sessionId = app.dispatches[0].sessionId;
  assert.equal(
    (await app.controller.handleMediaFailure({ sessionId, reason: "agent_audio_stream_failed" })).reason,
    "media_failure_fallback_incomplete",
  );
  assert.equal(app.calls.get(`${companyId}:pbx-call-secret`).state, "ending");

  const shutdown = await app.controller.shutdown();
  assert.equal(shutdown.stopped, true);
  assert.equal(fallbackAttempts, 2);
  assert.equal(app.calls.get(`${companyId}:pbx-call-secret`).state, "ended");
});

test("retries incomplete cleanup without repeating a successful agent stop", async () => {
  let closeAttempts = 0;
  const app = setup({
    attachMedia: async () => ({ close: async () => {
      closeAttempts += 1;
      if (closeAttempts === 1) throw new Error("transport detail");
    } }),
  });
  assert.equal((await app.controller.handleEvent(joined())).reason, "call_active");
  assert.equal((await app.controller.handleEvent(ended())).reason, "cleanup_incomplete");
  assert.equal((await app.controller.handleEvent(ended({ eventId: "event-end-retry" }))).reason, "call_ended");
  assert.equal(closeAttempts, 2);
  assert.equal(app.stops.length, 1);
  assert.deepEqual(app.transitions.slice(-2).map(({ expected, next }) => `${expected}->${next}`), [
    "active->ending", "ending->ended",
  ]);
});

test("renews active call claims and tears down media before safe fallback when ownership is lost", async () => {
  const fallbackCalls = [];
  const app = setup({
    renewCallLease: async ({ companyId, integrationId, sessionId }) => {
      assert.equal(companyId, companyIdExpected);
      assert.equal(integrationId, "tenant-integration-opaque-id");
      assert.ok(sessionId);
      return false;
    },
    handlePbxFallback: async (input) => {
      fallbackCalls.push({ ...input, mediaAlreadyClosed: app.mediaCloses === 1, agentAlreadyStopped: app.stops.length === 1 });
      return true;
    },
    leaseRenewIntervalMs: 100,
  });
  const companyIdExpected = companyId;
  assert.equal((await app.controller.handleEvent(joined())).reason, "call_active");
  await waitFor(() => app.calls.get(`${companyId}:pbx-call-secret`).state === "ended");
  assert.equal(fallbackCalls.length, 1);
  assert.equal(fallbackCalls[0].reason, "call_claim_lease_lost");
  assert.equal(fallbackCalls[0].pbxParticipantId, 42);
  assert.equal(fallbackCalls[0].mediaAlreadyClosed, true);
  assert.equal(fallbackCalls[0].agentAlreadyStopped, true);
  assert.deepEqual(app.transitions.slice(-2).map(({ expected, next }) => `${expected}->${next}`), [
    "active->ending", "ending->ended",
  ]);
});

test("retries one transient lease-renewal error without ending a still-owned call", async () => {
  let renewalAttempts = 0;
  let fallbackAttempts = 0;
  const app = setup({
    renewCallLease: async () => {
      renewalAttempts += 1;
      if (renewalAttempts === 1) throw new Error("database detail must stay private");
      return true;
    },
    handlePbxFallback: async () => { fallbackAttempts += 1; return true; },
    leaseRenewIntervalMs: 100,
  });
  assert.equal((await app.controller.handleEvent(joined())).reason, "call_active");
  await waitFor(() => renewalAttempts >= 2);
  assert.equal(app.calls.get(`${companyId}:pbx-call-secret`).state, "active");
  assert.equal(fallbackAttempts, 0);
  await app.controller.handleEvent(ended());
});

test("shutdown drains active calls through media cleanup and configured PBX fallback", async () => {
  const fallbackCalls = [];
  const app = setup({
    handlePbxFallback: async (input) => { fallbackCalls.push(input); return true; },
  });
  await app.controller.handleEvent(joined());
  const shutdown = await app.controller.shutdown();
  assert.equal(shutdown.stopped, true);
  assert.equal(app.calls.get(`${companyId}:pbx-call-secret`).state, "ended");
  assert.equal(app.mediaCloses, 1);
  assert.equal(app.stops.length, 1);
  assert.equal(fallbackCalls.length, 1);
  assert.equal(fallbackCalls[0].reason, "connector_shutdown");
  assert.equal((await app.controller.handleEvent(joined({ eventId: "event-after-shutdown" }))).reason, "controller_stopping");
  assert.equal(app.dispatches.length, 1);
});

test("shutdown waits for an in-flight call claim before draining it", async () => {
  let releaseClaim;
  let fallbackCount = 0;
  const claimGate = new Promise((resolve) => { releaseClaim = resolve; });
  const app = setup({
    claimGate,
    handlePbxFallback: async () => { fallbackCount += 1; return true; },
  });
  const joinPromise = app.controller.handleEvent(joined());
  await new Promise((resolve) => setImmediate(resolve));
  const shutdownPromise = app.controller.shutdown();
  releaseClaim();
  assert.equal((await joinPromise).reason, "call_active");
  const result = await shutdownPromise;
  assert.equal(result.stopped, true);
  assert.equal(fallbackCount, 1);
  assert.equal(app.calls.get(`${companyId}:pbx-call-secret`).state, "ended");
});

test("requires a verified tenant, user, and published profile binding", () => {
  const app = setup({ tenantBinding: { clientSecret: "must-not-be-retained", opaqueCredential: { value: "sensitive" } } });
  assert.throws(() => new ThreeCxCallController({
    tenantBinding: { companyId: "not-a-uuid" },
    claimCall: async () => {}, transitionCall: async () => {}, dispatchAgent: async () => {},
    attachMedia: async () => {}, stopAgent: async () => {},
  }), /verified tenant binding/);
  assert.throws(() => setup({
    tenantBinding: {
      failureAction: "transfer",
      failureDestination: "9999",
      transferDestinations: ["8001"],
    },
  }), /allowlisted/);
  assert.deepEqual(Object.keys(app.controller.binding).sort(), [
    "authSubject", "companyId", "dids", "failureAction", "failureDestination",
    "integrationId", "profileVersion", "routePointDn", "timezone", "transferDestinations",
  ]);
  assert.equal(app.controller.binding.clientSecret, undefined);
  assert.equal(app.controller.binding.opaqueCredential, undefined);
  assert.throws(() => setup({ tenantBinding: { dids: [] } }), /at least one.*DID/i);
  assert.throws(() => setup({ tenantBinding: { timezone: "Not/A_Real_Timezone" } }), /valid tenant timezone/i);
  assert.ok(app.controller);
});

function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("condition timed out"));
      setTimeout(check, 5);
    };
    check();
  });
}
