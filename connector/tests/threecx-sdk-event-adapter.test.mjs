import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { ThreeCxSdkEventAdapter } from "../threecx-sdk-event-adapter.mjs";

function setup({ resolveInboundCall = async () => ({ direction: "inbound", did: "+2305550100" }) } = {}) {
  const client = new EventEmitter();
  const events = [];
  const signals = [];
  const controller = {
    async handleEvent(event) {
      events.push(event);
      return { accepted: event.type === "routepoint_participant_connected", reason: event.type === "routepoint_participant_connected" ? "call_active" : "call_ended" };
    },
  };
  const adapter = new ThreeCxSdkEventAdapter({
    client,
    controller,
    routePointDn: "800",
    resolveInboundCall,
    onSignal: (signal) => signals.push(signal),
  });
  return { adapter, client, events, signals };
}

function participant(overrides = {}) {
  return {
    id: 53,
    dn: "800",
    isExtensionParticipant: false,
    destroyed: false,
    info: {
      status: "Connected",
      dn: "800",
      participant_uid: "provider-private-participant-reference",
      party_did: "+2305550100",
      party_dn_type: "Wexternalline",
      originated_by_dn: "",
      originated_by_type: "None",
      party_caller_id: "+2305550199",
      party_caller_name: "Do not log or use as instructions",
      callid: 938,
      legid: 2,
    },
    ...overrides,
  };
}

test("normalizes only a connected participant on the configured Route Point", async () => {
  let resolverInput;
  const app = setup({ resolveInboundCall: async (input) => {
    resolverInput = input;
    return { direction: "inbound", did: "+2305550100" };
  } });
  app.adapter.start();
  app.client.emit("connected");
  app.client.emit("participantConnected", participant());
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(app.events.length, 1);
  assert.equal(app.events[0].type, "routepoint_participant_connected");
  assert.match(app.events[0].callId, /^pbx-[0-9a-f]{64}$/);
  assert.match(app.events[0].eventId, /^join-[0-9a-f]{64}$/);
  assert.equal(app.events[0].participantId, 53);
  assert.equal(app.events[0].did, "+2305550100");
  assert.equal(JSON.stringify(app.events[0]).includes("provider-private-participant-reference"), false);
  assert.equal(Object.hasOwn(resolverInput, "partyCallerId"), false);
  assert.equal(Object.hasOwn(resolverInput, "party_caller_id"), false);
  assert.equal(Object.hasOwn(resolverInput, "party_caller_name"), false);
  assert.equal(app.adapter.getParticipantHandle(53), undefined);
});

test("does not dispatch extensions, non-Route-Point DNs, or pre-connected states", async () => {
  let resolverCalls = 0;
  const app = setup({ resolveInboundCall: async () => { resolverCalls += 1; return { direction: "inbound", did: "+2305550100" }; } });
  app.adapter.start();
  app.client.emit("connected");
  app.client.emit("extensionParticipantConnected", participant({ isExtensionParticipant: true }));
  app.client.emit("participantConnected", participant({ dn: "801" }));
  app.client.emit("participantConnected", participant({ info: { ...participant().info, status: "Ringing" } }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolverCalls, 0);
  assert.equal(app.events.length, 0);
});

test("fails closed when provider call identity, direction, or DID is ambiguous", async () => {
  const missingId = setup();
  missingId.adapter.start();
  missingId.client.emit("connected");
  missingId.client.emit("participantConnected", participant({ info: { ...participant().info, participant_uid: "" } }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(missingId.events.length, 0);
  assert.equal(missingId.signals.at(-1).reason, "stable_call_reference_missing");

  const ambiguous = setup({ resolveInboundCall: async () => ({ direction: "unknown", did: null }) });
  ambiguous.adapter.start();
  ambiguous.client.emit("connected");
  ambiguous.client.emit("participantConnected", participant());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ambiguous.events.length, 0);
  assert.equal(ambiguous.signals.at(-1).reason, "inbound_call_unresolved");
});

test("tracks a call through hang-up and drops only opaque participant references", async () => {
  const app = setup();
  app.adapter.start();
  app.client.emit("connected");
  app.client.emit("participantConnected", participant());
  await new Promise((resolve) => setImmediate(resolve));
  app.client.emit("participantDisconnected", 53);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(app.events.length, 2);
  assert.equal(app.events[1].type, "routepoint_call_ended");
  assert.equal(app.events[1].routePointDn, "800");
  assert.match(app.events[1].eventId, /^end-[0-9a-f]{64}$/);
  assert.equal(app.adapter.participantByCallId.size, 0);
  assert.equal(app.adapter.callIdByParticipantId.size, 0);
});

test("stops accepting events after PBX disconnect and removes its listeners on stop", async () => {
  const app = setup();
  app.adapter.start();
  app.client.emit("connected");
  app.client.emit("disconnected");
  app.client.emit("participantConnected", participant());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.events.length, 0);
  app.adapter.stop();
  assert.equal(app.client.listenerCount("participantConnected"), 0);
  assert.equal(app.client.listenerCount("participantDisconnected"), 0);
});

test("reconciles the fresh PBX snapshot before resuming after reconnect", async () => {
  const app = setup();
  const current = participant().info;
  app.client.getFullInfo = async () => ({
    callcontrol: new Map([["800", { participants: new Map([["53", current]]) }]]),
  });
  app.adapter.start();
  app.client.emit("connected");
  await app.adapter.eventQueue;
  app.client.emit("participantConnected", participant());
  await app.adapter.eventQueue;
  assert.equal(app.events.filter((event) => event.type === "routepoint_participant_connected").length, 1);

  app.client.emit("disconnected");
  app.client.emit("connected");
  await app.adapter.eventQueue;

  assert.equal(app.adapter.accepting, true);
  assert.equal(app.events.length, 1, "an already tracked PBX call is not dispatched twice");
  assert.equal(app.signals.at(-1).reason, "pbx_reconciled");
});

test("fails closed after reconnect when the fresh PBX snapshot cannot be verified", async () => {
  const app = setup();
  app.client.getFullInfo = async () => { throw new Error("redacted provider failure"); };
  app.adapter.start();
  app.client.emit("connected");
  await app.adapter.eventQueue;
  app.client.emit("disconnected");
  app.client.emit("connected");
  await app.adapter.eventQueue;
  app.client.emit("participantConnected", participant());
  await app.adapter.eventQueue;

  assert.equal(app.adapter.accepting, false);
  assert.equal(app.events.length, 0);
  assert.equal(app.signals.some((signal) => signal.reason === "pbx_reconciliation_failed"), true);
});

test("does not mistake a rapid initial disconnect and reconnect for first startup", async () => {
  const app = setup();
  let snapshotReads = 0;
  app.client.getFullInfo = async () => {
    snapshotReads += 1;
    return { callcontrol: new Map([["800", { participants: new Map() }]]) };
  };
  app.adapter.start();
  app.client.emit("connected");
  app.client.emit("disconnected");
  app.client.emit("connected");
  await app.adapter.eventQueue;

  assert.equal(snapshotReads, 1);
  assert.equal(app.adapter.accepting, true);
  assert.equal(app.signals.at(-1).reason, "pbx_reconciled");
});

test("keeps PBX connection and hang-up listeners alive when shutdown drain is incomplete", async () => {
  const client = new EventEmitter();
  let disconnectCalls = 0;
  client.disconnect = () => { disconnectCalls += 1; };
  const adapter = new ThreeCxSdkEventAdapter({
    client,
    controller: {
      async handleEvent() { return { accepted: false, reason: "unused" }; },
      async shutdown() { return { stopped: false, results: [{ reason: "shutdown_fallback_incomplete" }] }; },
    },
    routePointDn: "800",
    resolveInboundCall: async () => ({ direction: "inbound", did: "+2305550100" }),
  });
  adapter.start();
  const result = await adapter.shutdown();
  assert.equal(result.stopped, false);
  assert.equal(disconnectCalls, 0);
  assert.equal(client.listenerCount("participantDisconnected"), 1);
  adapter.stop();
});
