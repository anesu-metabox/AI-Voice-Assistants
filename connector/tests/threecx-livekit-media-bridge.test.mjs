import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { JobStatus } from "@livekit/protocol";
import { ParticipantKind } from "@livekit/rtc-node";
import { ThreeCxLiveKitMediaBridge } from "../threecx-livekit-media-bridge.mjs";
import { startVerifiedThreeCxLiveKitMediaBridge } from "../verified-threecx-livekit-media.mjs";

class FakeResampler {
  constructor({ inputRate, outputRate }) { this.inputRate = inputRate; this.outputRate = outputRate; this.closed = false; }
  push(frame) {
    if (this.inputRate === 24000) return [Buffer.alloc(320)];
    return [{ sampleRate: this.outputRate, channels: 1, samplesPerChannel: 480, data: new Int16Array(480) }];
  }
  flush() { return []; }
  close() { this.closed = true; return []; }
}

class FakeAudioSource {
  constructor(rate, channels, queueSize) { Object.assign(this, { rate, channels, queueSize, frames: [], closed: false }); }
  async captureFrame(frame) { this.frames.push(frame); }
  async close() { this.closed = true; }
}

class FakeTrack {
  static createAudioTrack(name, source) { return new FakeTrack(name, source); }
  constructor(name, source) { Object.assign(this, { name, source, closed: false }); }
  async close(closeSource = true) { this.closed = true; if (closeSource) await this.source?.close(); }
}

class FakeAudioStream {
  constructor(track) { this.track = track; }
  getReader() {
    const values = [...(this.track.frames || [])];
    return {
      async read() { return values.length ? { done: false, value: values.shift() } : { done: true }; },
      async cancel() { values.length = 0; },
    };
  }
}

class FakeRoom extends EventEmitter {
  constructor() {
    super();
    this.published = [];
    this.localParticipant = { publishTrack: async (track, options) => this.published.push({ track, options }) };
    this.remoteParticipants = new Map();
  }
}

function dependencies() {
  return {
    AudioSource: FakeAudioSource,
    AudioStream: FakeAudioStream,
    LocalAudioTrack: FakeTrack,
    TrackPublishOptions: class {},
    TrackSource: { SOURCE_MICROPHONE: "microphone" },
    Pcm16FrameAssembler: class {
      constructor({ sampleRate }) { this.frameBytes = sampleRate === 8000 ? 320 : 960; }
      push(chunk) {
        const bytes = Buffer.from(chunk);
        const frames = [];
        for (let i = 0; i + this.frameBytes <= bytes.length; i += this.frameBytes) frames.push(bytes.subarray(i, i + this.frameBytes));
        return frames;
      }
      reset() { return 0; }
    },
    Pcm16LiveKitResampler: FakeResampler,
  };
}

function makeBridge({ agentIdentity = "agent-trusted", inboundChunks = [Buffer.alloc(320)], onFailure = () => {}, onSignal = () => {} } = {}) {
  const room = new FakeRoom();
  const writer = {
    cancelled: false,
    bufferedBytes: 0,
    writes: [],
    clears: 0,
    clear() { this.clears += 1; this.writes.length = 0; this.bufferedBytes = 0; },
    write(chunk) { this.writes.push(chunk); },
    cancel() { this.cancelled = true; },
  };
  const participant = {
    getAudioStream: async () => inboundChunks === null ? new PassThrough() : Readable.from(inboundChunks),
    getAudioWriter: () => writer,
  };
  const bridge = new ThreeCxLiveKitMediaBridge({
    room,
    participant,
    dispatchId: "dispatch-1",
    isAuthorizedAgent: (remote, dispatchId) => remote.identity === agentIdentity && dispatchId === "dispatch-1",
    onFailure,
    onSignal,
    dependencies: dependencies(),
  });
  return { bridge, room, participant, writer };
}

test("publishes PBX caller audio, accepts only dispatch-verified agent audio, and cleans up", async () => {
  const { bridge, room, writer } = makeBridge();
  await bridge.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(room.published.length, 1);
  assert.equal(room.published[0].track.source.frames.length, 1);
  assert.equal(room.published[0].track.source.frames[0].sampleRate, 24000);

  const attacker = { identity: "unverified", trackPublications: new Map() };
  const audioTrack = { frames: [{ sampleRate: 24000, channels: 1, data: new Int16Array(480) }] };
  const publication = { kind: "audio", setSubscribed() { this.subscribed = true; } };
  room.emit("trackPublished", publication, attacker);
  room.emit("trackSubscribed", audioTrack, publication, attacker);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(publication.subscribed, undefined);
  assert.equal(writer.writes.length, 0);

  const agent = { identity: "agent-trusted", trackPublications: new Map() };
  room.emit("trackPublished", publication, agent);
  assert.equal(publication.subscribed, true);
  room.emit("trackSubscribed", audioTrack, publication, agent);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writer.writes.length, 1);
  assert.equal(writer.writes[0].length, 320);

  bridge.clearOutboundAudio();
  await bridge.close();
  assert.equal(writer.cancelled, true);
  assert.equal(room.published[0].track.closed, true);
  assert.equal(room.listenerCount("trackSubscribed"), 0);
  assert.equal(bridge.source.closed, true);
});

test("fails closed when a dispatch-bound agent verifier is missing", () => {
  const room = new FakeRoom();
  assert.throws(() => new ThreeCxLiveKitMediaBridge({
    room,
    participant: { getAudioStream() {}, getAudioWriter() {} },
    dispatchId: "dispatch-1",
  }), /agent verifier/);
});

test("verified media startup waits for the exact dispatch job before opening the PBX audio path", async () => {
  const room = new FakeRoom();
  const writer = { cancelled: false, bufferedBytes: 0, writes: [], clear() {}, write(chunk) { this.writes.push(chunk); }, cancel() { this.cancelled = true; } };
  let dispatchReads = 0;
  const mediaFailures = [];
  const controllerOutcomes = [];
  const bridge = await startVerifiedThreeCxLiveKitMediaBridge({
    dispatchClient: {
      async getDispatch(dispatchId, roomName) {
        dispatchReads += 1;
        assert.equal(dispatchId, "dispatch-exact");
        assert.equal(roomName, "threecx-0123456789abcdef0123456789abcdef");
        return {
          id: dispatchId,
          room: roomName,
          agentName: "calendar-assistant",
          state: { jobs: [{ dispatchId, agentName: "calendar-assistant", state: {
            status: JobStatus.JS_RUNNING,
            participantIdentity: "agent-exact-job",
          } }] },
        };
      },
    },
    dispatchId: "dispatch-exact",
    roomName: "threecx-0123456789abcdef0123456789abcdef",
    participant: { getAudioStream: async () => Readable.from([]), getAudioWriter: () => writer },
    room,
    controller: {
      async handleMediaFailure(failure) {
        mediaFailures.push(failure);
        return { reason: "call_failed_after_media_fallback" };
      },
    },
    sessionId: "session-for-verified-dispatch",
    onFailureObserver: (event) => controllerOutcomes.push(event),
    dependencies: dependencies(),
  });
  assert.equal(dispatchReads, 1);
  const publication = { kind: "audio", setSubscribed() { this.subscribed = true; } };
  const wrongKind = { identity: "agent-exact-job", kind: ParticipantKind.STANDARD };
  room.emit("trackPublished", publication, wrongKind);
  assert.equal(publication.subscribed, undefined);
  const dispatchAgent = { identity: "agent-exact-job", kind: ParticipantKind.AGENT };
  room.emit("trackPublished", publication, dispatchAgent);
  assert.equal(publication.subscribed, true);
  await bridge.onFailure({ reason: "livekit_room_disconnected" });
  assert.deepEqual(mediaFailures, [{
    sessionId: "session-for-verified-dispatch",
    reason: "livekit_room_disconnected",
  }]);
  assert.deepEqual(controllerOutcomes, [{
    reason: "livekit_room_disconnected",
    outcome: "call_failed_after_media_fallback",
  }]);
  await bridge.close();
});

test("clears bounded outbound audio instead of growing the PBX writer queue", async () => {
  const failures = [];
  let resolveFailure;
  const failureObserved = new Promise((resolve) => { resolveFailure = resolve; });
  const { bridge, room, writer } = makeBridge({ inboundChunks: [], onFailure: (failure) => { failures.push(failure); resolveFailure(); } });
  await bridge.start();
  writer.bufferedBytes = 3000;
  const agent = { identity: "agent-trusted", trackPublications: new Map() };
  const track = { frames: [{ sampleRate: 24000, channels: 1, data: new Int16Array(480) }] };
  room.emit("trackSubscribed", track, { kind: "audio" }, agent);
  await failureObserved;
  assert.deepEqual(writer.writes, []);
  assert.equal(writer.clears, 1);
  assert.equal(writer.bufferedBytes, 0);
  assert.deepEqual(failures, [{ reason: "pbx_audio_queue_overflow" }]);
  await bridge.close();
});

test("invokes the safe PBX failure callback when verified agent media disappears", async (t) => {
  for (const [event, reason] of [
    ["participantDisconnected", "verified_agent_disconnected"],
    ["trackUnsubscribed", "agent_audio_unsubscribed"],
    ["disconnected", "livekit_room_disconnected"],
  ]) {
    await t.test(event, async () => {
      const failures = [];
      const { bridge, room } = makeBridge({ inboundChunks: [], onFailure: (failure) => failures.push(failure) });
      await bridge.start();
      const agent = { identity: "agent-trusted" };
      if (event === "participantDisconnected") room.emit(event, agent);
      else if (event === "trackUnsubscribed") room.emit(event, {}, { kind: "audio" }, agent);
      else room.emit(event);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(failures, [{ reason }]);

      // Multiple simultaneous room/participant teardown notifications must not
      // request multiple PBX fallback actions for the same bridge.
      room.emit("participantDisconnected", agent);
      room.emit("disconnected");
      assert.deepEqual(failures, [{ reason }]);
      await bridge.close();
    });
  }
});

test("observes rejected async PBX fallback callbacks without an unhandled rejection", async () => {
  const signals = [];
  const { bridge, room } = makeBridge({
    inboundChunks: [],
    onFailure: async () => { throw new Error("private fallback error"); },
    onSignal: (signal) => signals.push(signal),
  });
  await bridge.start();
  room.emit("disconnected");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signals.some((signal) => signal.reason === "pbx_failure_handler_failed"), true);
  assert.equal(JSON.stringify(signals).includes("private fallback error"), false);
  await bridge.close();
});

test("does not deadlock when the asynchronous failure handler closes the bridge", async () => {
  let bridge;
  let completeFallback;
  const fallbackCompleted = new Promise((resolve) => { completeFallback = resolve; });
  const app = makeBridge({
    inboundChunks: null,
    onFailure: async () => {
      await bridge.close();
      completeFallback();
    },
  });
  bridge = app.bridge;
  await bridge.start();
  app.room.emit("disconnected");
  await Promise.race([
    fallbackCompleted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("fallback cleanup timed out")), 1000)),
  ]);
  assert.equal(bridge.closed, true);
});
