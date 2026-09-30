import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LiveKitApiClient,
  MockAudioSession,
  MockLiveKitRoom,
  VoiceBotStateMachine,
} from "./harness.mjs";

describe("Tier 3 - Cross-Feature Combinations: Full Session Lifecycle", () => {
  it("3.1: Complete Golden Happy Path Lifecycle (token -> connect -> AudioSession -> trackSub -> speaking -> interrupt -> hangup -> stop)", async () => {
    const mockAudioSession = new MockAudioSession();
    const mockRoom = new MockLiveKitRoom();
    const client = new LiveKitApiClient("http://localhost:8000");
    const stateMachine = new VoiceBotStateMachine({
      apiClient: client,
      room: mockRoom,
      audioSession: mockAudioSession,
    });

    const lifecycleEvents = [];
    stateMachine.on("statusChanged", (next, prev) => lifecycleEvents.push(`status:${prev}->${next}`));
    stateMachine.on("interrupted", (rec) => lifecycleEvents.push(`interrupted:${rec.elapsedMs.toFixed(1)}ms`));

    const mockFetch = async (url, init) => {
      assert.ok(url.includes("/api/livekit/token"));
      assert.equal(init.headers["X-Verified-Session-Context"], undefined);
      assert.equal(init.credentials, "include");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          token: "jwt_token_sample",
          ws_url: "wss://ai-voice-assistant-vu6rr406.livekit.cloud",
          room: "sandbox-golden-1",
          identity: "user-test-golden",
          session_id: "golden-1",
        }),
      };
    };

    // Step 1: Start call
    const startPromise = stateMachine.startCall({ sessionId: "golden-1" }, mockFetch);

    assert.equal(stateMachine.connectionStatus, "connecting");
    await startPromise;

    // Step 2: AudioSession is in VoIP mode and speakerphone is active
    assert.equal(mockAudioSession.isActive, true);
    assert.equal(mockAudioSession.mode, "AVAudioSessionModeVoiceChat");
    assert.equal(mockAudioSession.isSpeakerphoneOn, true);

    // Step 3: Room is connected, waiting for agent
    assert.equal(stateMachine.connectionStatus, "waiting_for_agent");

    // Step 4: Agent connects and publishes audio track
    mockRoom.simulateAgentJoined("calendar-assistant");
    assert.equal(stateMachine.connectionStatus, "connected");

    // Step 5: Agent speaks
    stateMachine.isBotSpeaking = true;
    stateMachine.audioLevel.remote = 85;

    // Step 6: User interrupts agent mid-speech
    const interruptResult = await stateMachine.handleUserSpeechActivity(true);
    assert.equal(interruptResult.interrupted, true);
    assert.ok(interruptResult.elapsedMs < 20);
    assert.equal(stateMachine.isBotSpeaking, false);
    assert.equal(mockRoom.sentPackets.length, 1);
    assert.deepEqual(mockRoom.sentPackets[0].payload, { type: "response.cancel" });

    // Step 7: Hangup
    await stateMachine.endCall();
    assert.equal(stateMachine.connectionStatus, "disconnected");
    assert.equal(mockAudioSession.isActive, false);
    assert.equal(mockRoom.state, "disconnected");

    // Verify lifecycle progression
    assert.deepEqual(lifecycleEvents, [
      "status:disconnected->connecting",
      "status:connecting->waiting_for_agent",
      "status:waiting_for_agent->connected",
      `interrupted:${interruptResult.elapsedMs.toFixed(1)}ms`,
      "status:connected->disconnected",
    ]);
  });

  it("3.2: Late Agent Arrival Lifecycle with Keep-Alive", async () => {
    const mockAudioSession = new MockAudioSession();
    const mockRoom = new MockLiveKitRoom();
    const stateMachine = new VoiceBotStateMachine({
      room: mockRoom,
      audioSession: mockAudioSession,
    });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: "jwt", ws_url: "wss://lk.io", room: "sandbox-late" }),
    });

    await stateMachine.startCall({}, mockFetch);
    assert.equal(stateMachine.connectionStatus, "waiting_for_agent");
    assert.equal(mockAudioSession.isActive, true);

    // Wait simulated delay for agent worker prewarm
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(stateMachine.connectionStatus, "waiting_for_agent");

    // Agent joins
    mockRoom.simulateAgentJoined("calendar-assistant");
    assert.equal(stateMachine.connectionStatus, "connected");

    await stateMachine.endCall();
    assert.equal(mockAudioSession.isActive, false);
  });

  it("3.3: In-Call Mute and Interruption Interaction Lifecycle", async () => {
    const mockRoom = new MockLiveKitRoom();
    const stateMachine = new VoiceBotStateMachine({ room: mockRoom });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: "jwt", ws_url: "wss://lk.io" }),
    });

    await stateMachine.startCall({}, mockFetch);
    mockRoom.simulateAgentJoined();
    assert.equal(stateMachine.connectionStatus, "connected");

    // Bot is speaking
    stateMachine.isBotSpeaking = true;

    // User mutes
    stateMachine.setMuted(true);
    assert.equal(stateMachine.isMuted, true);

    // User coughs / makes voice noise while muted -> cancel must NOT be sent
    const mutedActivity = await stateMachine.handleUserSpeechActivity(true);
    assert.equal(mutedActivity.interrupted, false);
    assert.equal(mockRoom.sentPackets.length, 0);
    assert.equal(stateMachine.isBotSpeaking, true);

    // User unmutes
    stateMachine.setMuted(false);

    // User says "Stop" while unmuted -> cancel IS sent immediately
    const unmutedActivity = await stateMachine.handleUserSpeechActivity(true);
    assert.equal(unmutedActivity.interrupted, true);
    assert.equal(mockRoom.sentPackets.length, 1);
    assert.equal(stateMachine.isBotSpeaking, false);

    await stateMachine.endCall();
  });

  it("3.4: Premature Hangup During In-Flight Connection Setup", async () => {
    const mockAudioSession = new MockAudioSession();
    const mockRoom = new MockLiveKitRoom();
    const stateMachine = new VoiceBotStateMachine({
      room: mockRoom,
      audioSession: mockAudioSession,
    });

    // Slow connect
    mockRoom.setConnectDelay(100);

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: "jwt", ws_url: "wss://lk.io" }),
    });

    const callPromise = stateMachine.startCall({}, mockFetch);
    assert.equal(stateMachine.connectionStatus, "connecting");

    // User immediately taps Hangup before room connect completes
    await stateMachine.endCall();
    assert.equal(stateMachine.connectionStatus, "disconnected");
    assert.equal(mockAudioSession.isActive, false);

    // Await call promise resolution
    try {
      await callPromise;
    } catch {}

    assert.equal(mockAudioSession.isActive, false);
    assert.equal(stateMachine.connectionStatus, "disconnected");
  });

  it("3.5: Mid-Call Drop and Recovery with Active Interruption Protocol", async () => {
    const mockRoom = new MockLiveKitRoom();
    const stateMachine = new VoiceBotStateMachine({ room: mockRoom });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: "jwt", ws_url: "wss://lk.io" }),
    });

    await stateMachine.startCall({}, mockFetch);
    mockRoom.simulateAgentJoined();
    assert.equal(stateMachine.connectionStatus, "connected");

    // Drop connection
    mockRoom.simulateNetworkDrop();
    assert.equal(stateMachine.connectionStatus, "reconnecting");

    // Reconnected
    mockRoom.simulateNetworkRestored();
    assert.equal(stateMachine.connectionStatus, "connected");

    // Agent resumes speaking after reconnection
    stateMachine.isBotSpeaking = true;

    // User interrupts
    const result = await stateMachine.handleUserSpeechActivity(true);
    assert.equal(result.interrupted, true);
    assert.equal(mockRoom.sentPackets.length, 1);
    assert.deepEqual(mockRoom.sentPackets[0].payload, { type: "response.cancel" });

    await stateMachine.endCall();
    assert.equal(stateMachine.connectionStatus, "disconnected");
  });
});
