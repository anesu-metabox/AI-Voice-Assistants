import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createThreeCxTenantRuntime } from "../threecx-tenant-runtime.mjs";

const TENANT = {
  companyId: "123e4567-e89b-12d3-a456-426614174111",
  authSubject: "verified-auth-subject",
  profileVersion: 3,
  timezone: "Indian/Mauritius",
  integrationId: "integration-111",
  routePointDn: "9100",
  dids: ["2300111"],
  transferDestinations: [],
  failureAction: "disconnect",
  failureDestination: null,
};

class FakePbx extends EventEmitter {
  constructor() {
    super();
    this.participants = new Map();
    this.connected = false;
    this.connectCalls = 0;
    this.disconnectCalls = 0;
  }
  async connect() { this.connectCalls += 1; this.connected = true; this.emit("connected"); }
  async disconnect() { this.disconnectCalls += 1; this.connected = false; this.emit("disconnected"); }
  getParticipantHandle(id) { return this.participants.get(id); }
  receive(participant) { this.participants.set(participant.id, participant); this.emit("participantConnected", participant); }
}

function makeRuntime({ client = new FakePbx(), handlePbxFallback = async () => true, onSignal = () => {} } = {}) {
  const runtime = createThreeCxTenantRuntime({
    tenantBinding: TENANT,
    client,
    resolveInboundCall: async ({ partyDid }) => ({ direction: "inbound", did: partyDid }),
    claimCall: async () => ({
      claimed: true,
      call: { claim_token: "opaque-claim", livekit_room: "threecx-0123456789abcdef0123456789abcdef" },
    }),
    transitionCall: async () => true,
    renewCallLease: async () => true,
    dispatchAgent: async () => ({ dispatchId: "dispatch-opaque" }),
    createMediaBridge: async ({ controller, getParticipantHandle, pbxParticipantId }) => {
      assert.equal(typeof controller.handleMediaFailure, "function");
      assert.equal(getParticipantHandle(pbxParticipantId), client.getParticipantHandle(pbxParticipantId));
      return { close: async () => {} };
    },
    stopAgent: async () => {},
    handlePbxFallback,
    onSignal,
    leaseRenewIntervalMs: 1000,
  });
  return { runtime, client };
}

function waitFor(predicate, timeoutMs = 1000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("runtime lifecycle timed out"));
      setTimeout(poll, 5);
    };
    poll();
  });
}

test("runtime single-flights PBX connection and drains before disconnecting", async () => {
  const client = new FakePbx();
  let releaseConnect;
  client.connect = async () => {
    client.connectCalls += 1;
    await new Promise((resolve) => { releaseConnect = resolve; });
    client.connected = true;
    client.emit("connected");
  };
  const signals = [];
  const { runtime } = makeRuntime({ client, onSignal: ({ reason }) => signals.push(reason) });

  const first = runtime.start();
  const second = runtime.start();
  assert.equal(first, second);
  await waitFor(() => typeof releaseConnect === "function");
  assert.equal(client.connectCalls, 1);
  releaseConnect();
  assert.deepEqual(await first, { started: true, state: "running" });
  assert.deepEqual(await runtime.start(), { started: true, state: "running" });
  assert.equal(client.connectCalls, 1);

  const stopped = await runtime.shutdown();
  assert.equal(stopped.stopped, true);
  assert.equal(runtime.state, "stopped");
  assert.equal(client.disconnectCalls, 1);
  assert.equal(client.listenerCount("participantConnected"), 0);
  assert.throws(() => runtime.start(), /cannot be restarted/);
  assert.ok(signals.includes("tenant_runtime_started"));
  assert.ok(signals.includes("connector_shutdown_complete"));
});

test("failed PBX startup cleans listeners and exposes only a static failure", async () => {
  const client = new FakePbx();
  client.connect = async () => { throw new Error("private PBX URL and secret"); };
  const { runtime } = makeRuntime({ client });

  await assert.rejects(runtime.start(), { message: "threecx_tenant_runtime_start_failed" });
  assert.equal(runtime.state, "failed");
  assert.equal(client.disconnectCalls, 1);
  assert.equal(client.listenerCount("participantConnected"), 0);
  assert.deepEqual(await runtime.shutdown(), { stopped: true, calls: [] });
});

test("incomplete call drain keeps the runtime connected and a later shutdown retries", async () => {
  const client = new FakePbx();
  const signals = [];
  let fallbackCalls = 0;
  const { runtime } = makeRuntime({
    client,
    onSignal: ({ reason }) => signals.push(reason),
    handlePbxFallback: async () => ++fallbackCalls > 1,
  });
  await runtime.start();
  client.receive({
    id: 27,
    dn: TENANT.routePointDn,
    isExtensionParticipant: false,
    info: { status: "Connected", participant_uid: "opaque-leg", party_did: TENANT.dids[0] },
    getAudioStream: async () => Readable.from([]),
    getAudioWriter: () => ({ write() {}, clear() {}, cancel() {}, bufferedBytes: 0, cancelled: false }),
  });
  await waitFor(() => signals.includes("call_active"));

  const first = await runtime.shutdown();
  assert.equal(first.stopped, false);
  assert.equal(runtime.state, "draining");
  assert.equal(client.connected, true);
  assert.equal(client.listenerCount("participantConnected"), 1);

  const second = await runtime.shutdown();
  assert.equal(second.stopped, true);
  assert.equal(runtime.state, "stopped");
  assert.equal(fallbackCalls, 2);
  assert.equal(client.connected, false);
  assert.equal(client.listenerCount("participantConnected"), 0);
});
