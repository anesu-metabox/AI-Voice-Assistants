import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { ThreeCxCallController } from "../call-controller.mjs";
import { ThreeCxSdkEventAdapter } from "../threecx-sdk-event-adapter.mjs";

class FakePbx extends EventEmitter {
  constructor() {
    super();
    this.participants = new Map();
    this.connected = false;
  }
  async connect() { this.connected = true; this.emit("connected"); }
  getParticipantHandle(id) { return this.participants.get(id); }
  receiveCall(participant) {
    this.participants.set(participant.id, participant);
    this.emit("participantConnected", participant);
  }
  hangup(participantId) {
    this.participants.delete(participantId);
    this.emit("participantDisconnected", participantId);
  }
  async disconnect() { this.connected = false; this.emit("disconnected"); }
}

function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("fake PBX lifecycle timed out"));
      setTimeout(poll, 5);
    };
    poll();
  });
}

test("fake PBX call claims and dispatches once, attaches media, and cleans up on hang-up", async () => {
  const pbx = new FakePbx();
  const calls = [];
  const media = [];
  let dispatchCount = 0;
  const controller = new ThreeCxCallController({
    tenantBinding: {
      companyId: "123e4567-e89b-12d3-a456-426614174000",
      authSubject: "auth-subject-test",
      profileVersion: 7,
      timezone: "Indian/Mauritius",
      integrationId: "integration-test",
      routePointDn: "9000",
      dids: ["2300100"],
      transferDestinations: [],
      failureAction: "disconnect",
      failureDestination: null,
    },
    claimCall: async (call) => {
      calls.push(call);
      return {
        claimed: true,
        call: { claim_token: "claim-test", livekit_room: "threecx-0123456789abcdef0123456789abcdef" },
      };
    },
    transitionCall: async ({ expectedState, newState }) => {
      assert.ok({ claimed: ["connecting", "failed", "ended"], connecting: ["active", "failed", "ending"], active: ["ending"], ending: ["ended", "failed"] }[expectedState]?.includes(newState));
      return true;
    },
    renewCallLease: async () => true,
    dispatchAgent: async (request) => {
      dispatchCount += 1;
      assert.equal(request.companyId, "123e4567-e89b-12d3-a456-426614174000");
      assert.equal(request.profileVersion, 7);
      assert.equal(request.roomName, "threecx-0123456789abcdef0123456789abcdef");
      return { dispatchId: "dispatch-test" };
    },
    attachMedia: async ({ pbxParticipantId, dispatchId }) => {
      assert.equal(pbxParticipantId, 42);
      assert.equal(dispatchId, "dispatch-test");
      const handle = pbx.getParticipantHandle(pbxParticipantId);
      assert.ok(handle);
      const attached = { closed: false, close: async () => { attached.closed = true; } };
      media.push(attached);
      return attached;
    },
    stopAgent: async () => {},
    handlePbxFallback: async () => true,
  });
  const outcomes = [];
  const adapter = new ThreeCxSdkEventAdapter({
    client: pbx,
    controller,
    routePointDn: "9000",
    resolveInboundCall: async (fields) => {
      assert.equal(fields.partyDid, "2300100");
      return { direction: "inbound", did: "2300100" };
    },
    onSignal: ({ reason }) => outcomes.push(reason),
  });

  adapter.start();
  await pbx.connect();
  const participant = {
    id: 42,
    dn: "9000",
    isExtensionParticipant: false,
    info: { status: "Connected", participant_uid: "opaque-pbx-leg", party_did: "2300100" },
    getAudioStream: async () => Readable.from([]),
    getAudioWriter: () => ({ write() {}, clear() {}, cancel() {}, bufferedBytes: 0, cancelled: false }),
  };
  pbx.receiveCall(participant);
  await waitFor(() => outcomes.includes("call_active"));
  assert.equal(dispatchCount, 1);
  assert.equal(calls.length, 1);
  assert.equal(media.length, 1);

  // Duplicate provider lifecycle delivery must not claim or dispatch a second time.
  pbx.emit("participantConnected", participant);
  await waitFor(() => outcomes.includes("duplicate_local_participant"));
  assert.equal(dispatchCount, 1);
  assert.equal(calls.length, 1);

  pbx.hangup(42);
  await waitFor(() => outcomes.includes("call_ended"));
  assert.equal(media[0].closed, true);
  assert.equal(dispatchCount, 1);
  const shutdown = await adapter.shutdown();
  assert.equal(shutdown.stopped, true);
  assert.equal(pbx.connected, false);
  assert.equal(pbx.listenerCount("participantConnected"), 0);
});

test("two company PBX lifecycles stay isolated under concurrent calls and reject cross-tenant DIDs", async () => {
  const tenants = [
    { companyId: "123e4567-e89b-12d3-a456-426614174001", profileVersion: 7, timezone: "Indian/Mauritius", routePointDn: "9101", did: "2300101", transferDestinations: ["8001"], failureAction: "transfer", failureDestination: "8001" },
    { companyId: "123e4567-e89b-12d3-a456-426614174002", profileVersion: 12, timezone: "Africa/Harare", routePointDn: "9102", did: "2300102", transferDestinations: [], failureAction: "disconnect", failureDestination: null },
  ];

  function makeTenant({ companyId, profileVersion, timezone, routePointDn, did, transferDestinations, failureAction, failureDestination }) {
    const pbx = new FakePbx();
    const claims = [];
    const dispatches = [];
    const rooms = [];
    const fallbacks = [];
    const signals = [];
    const controller = new ThreeCxCallController({
      tenantBinding: {
        companyId,
        authSubject: `auth-${companyId}`,
        profileVersion,
        timezone,
        integrationId: `integration-${companyId}`,
        routePointDn,
        dids: [did],
        transferDestinations,
        failureAction,
        failureDestination,
      },
      claimCall: async (claim) => {
        claims.push(claim);
        const room = `threecx-${companyId.slice(-2).repeat(16)}`;
        rooms.push(room);
        return { claimed: true, call: { claim_token: `claim-${companyId}`, livekit_room: room } };
      },
      transitionCall: async () => true,
      renewCallLease: async () => true,
      dispatchAgent: async (dispatch) => {
        dispatches.push(dispatch);
        return { dispatchId: `dispatch-${companyId}` };
      },
      attachMedia: async () => ({ close: async () => {} }),
      stopAgent: async () => {},
      handlePbxFallback: async (fallback) => { fallbacks.push(fallback); return true; },
    });
    const adapter = new ThreeCxSdkEventAdapter({
      client: pbx,
      controller,
      routePointDn,
      resolveInboundCall: async ({ partyDid }) => ({ direction: "inbound", did: partyDid }),
      onSignal: ({ reason }) => signals.push(reason),
    });
    return { pbx, adapter, claims, dispatches, rooms, signals, fallbacks };
  }

  const [alpha, beta] = tenants.map(makeTenant);
  for (const tenant of [alpha, beta]) tenant.adapter.start();
  await Promise.all([alpha.pbx.connect(), beta.pbx.connect()]);

  const participant = (id, routePointDn, did, providerReference = "shared-provider-call-reference") => ({
    id,
    dn: routePointDn,
    isExtensionParticipant: false,
    info: { status: "Connected", participant_uid: providerReference, party_did: did },
    getAudioStream: async () => Readable.from([]),
    getAudioWriter: () => ({ write() {}, clear() {}, cancel() {}, bufferedBytes: 0, cancelled: false }),
  });
  alpha.pbx.receiveCall(participant(61, tenants[0].routePointDn, tenants[0].did));
  beta.pbx.receiveCall(participant(62, tenants[1].routePointDn, tenants[1].did));
  await waitFor(
    () => alpha.signals.includes("call_active") && beta.signals.includes("call_active"),
  ).catch(() => assert.fail(`tenant lifecycles did not activate: ${JSON.stringify({ alpha: alpha.signals, beta: beta.signals })}`));

  assert.equal(alpha.claims.length, 1);
  assert.equal(beta.claims.length, 1);
  assert.equal(alpha.claims[0].companyId, tenants[0].companyId);
  assert.equal(beta.claims[0].companyId, tenants[1].companyId);
  assert.equal(alpha.dispatches[0].companyId, tenants[0].companyId);
  assert.equal(beta.dispatches[0].companyId, tenants[1].companyId);
  assert.equal(alpha.dispatches[0].profileVersion, tenants[0].profileVersion);
  assert.equal(beta.dispatches[0].profileVersion, tenants[1].profileVersion);
  assert.notEqual(alpha.rooms[0], beta.rooms[0]);

  // A Route Point event carrying the other tenant's DID is rejected before
  // the call-claim adapter is invoked.
  beta.pbx.receiveCall(participant(63, tenants[1].routePointDn, tenants[0].did, "other-provider-call-reference"));
  await waitFor(() => beta.signals.includes("unconfigured_did"));
  assert.equal(beta.claims.length, 1);
  assert.equal(beta.dispatches.length, 1);

  await Promise.all([alpha.adapter.shutdown(), beta.adapter.shutdown()]);
  assert.equal(alpha.fallbacks[0].failureAction, "transfer");
  assert.equal(alpha.fallbacks[0].failureDestination, "8001");
  assert.equal(beta.fallbacks[0].failureAction, "disconnect");
  assert.equal(Object.hasOwn(beta.fallbacks[0], "failureDestination"), false);
});
