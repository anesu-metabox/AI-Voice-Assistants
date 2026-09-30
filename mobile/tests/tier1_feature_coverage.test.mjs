import test, { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  LiveKitApiClient,
  MockAudioSession,
  MockLiveKitRoom,
  MockTrack,
  VoiceBotStateMachine,
  getVoiceAssistantBadge,
} from "./harness.mjs";

describe("Tier 1 - Feature Coverage: Token API Client (livekitApi)", () => {
  let client;

  beforeEach(() => {
    client = new LiveKitApiClient("http://localhost:8000");
  });

  it("1.1: URL construction trims trailing slashes and points to /api/livekit/token", () => {
    const clients = [
      new LiveKitApiClient("http://localhost:8000"),
      new LiveKitApiClient("http://localhost:8000/"),
      new LiveKitApiClient("https://api.mybackend.railway.app///"),
    ];

    for (const c of clients) {
      const url = c.buildTokenUrl();
      const parsed = new URL(url);
      assert.ok(parsed.pathname.endsWith("/api/livekit/token"));
      assert.ok(!parsed.pathname.includes("//"), `pathname ${parsed.pathname} should not contain duplicate slashes`);
    }
  });

  it("1.2: Query parameters correctly serialize session_id, participant_name, and profile_version", () => {
    const urlString = client.buildTokenUrl({
      sessionId: "session-12345-mobile",
      participantName: "Sarah Connor",
      profileVersion: 3,
    });
    const parsed = new URL(urlString);

    assert.equal(parsed.searchParams.get("session_id"), "session-12345-mobile");
    assert.equal(parsed.searchParams.get("participant_name"), "Sarah Connor");
    assert.equal(parsed.searchParams.get("profile_version"), "3");
  });

  it("1.3: Client sends Accept but leaves the trusted HMAC header server-side", () => {
    const headers = client.buildHeaders();

    assert.equal(headers["Accept"], "application/json");
    assert.equal(headers["X-Verified-Session-Context"], undefined);
  });

  it("1.4: Response normalization maps ws_url snake_case to wsUrl camelCase", () => {
    const rawBackendPayload = {
      token: "eyJhbGciOi...",
      ws_url: "wss://ai-voice-assistant-vu6rr406.livekit.cloud",
      room: "sandbox-session-abc",
      identity: "user-fedcba9876543210",
      session_id: "session-abc",
    };

    const normalized = client.normalizeTokenResponse(rawBackendPayload);

    assert.equal(normalized.token, rawBackendPayload.token);
    assert.equal(normalized.wsUrl, rawBackendPayload.ws_url);
    assert.equal(normalized.room, rawBackendPayload.room);
    assert.equal(normalized.identity, rawBackendPayload.identity);
    assert.equal(normalized.sessionId, "session-abc");
    assert.equal(normalized.ws_url, undefined);
  });

  it("1.5: Session ID handling auto-generates 8-128 char session ID when omitted", async () => {
    let requestedUrl = "";
    const mockFetch = async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          token: "valid-jwt",
          ws_url: "wss://test.livekit.cloud",
          room: "sandbox-auto",
        }),
      };
    };

    const result = await client.fetchToken({}, mockFetch);
    const parsed = new URL(requestedUrl);
    const generatedSessionId = parsed.searchParams.get("session_id");

    assert.ok(generatedSessionId, "session_id query param must be generated");
    assert.ok(generatedSessionId.length >= 8, "session_id must be >= 8 chars");
    assert.ok(generatedSessionId.length <= 128, "session_id must be <= 128 chars");
    assert.equal(result.sessionId, generatedSessionId);
  });

  it("1.6: Session ID handling preserves custom explicit session ID", async () => {
    let requestedUrl = "";
    const mockFetch = async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          token: "valid-jwt",
          ws_url: "wss://test.livekit.cloud",
          room: "sandbox-explicit",
          session_id: "explicit-session-999",
        }),
      };
    };

    const result = await client.fetchToken({ sessionId: "explicit-session-999" }, mockFetch);
    const parsed = new URL(requestedUrl);

    assert.equal(parsed.searchParams.get("session_id"), "explicit-session-999");
    assert.equal(result.sessionId, "explicit-session-999");
  });
});

describe("Tier 1 - Feature Coverage: Connection State Machine", () => {
  let stateMachine;
  let mockRoom;
  let mockAudioSession;

  beforeEach(() => {
    mockRoom = new MockLiveKitRoom();
    mockAudioSession = new MockAudioSession();
    stateMachine = new VoiceBotStateMachine({
      room: mockRoom,
      audioSession: mockAudioSession,
    });
  });

  it("2.1: State machine starts in disconnected initial state", () => {
    assert.equal(stateMachine.connectionStatus, "disconnected");
    assert.equal(stateMachine.isBotSpeaking, false);
    assert.equal(stateMachine.isUserSpeaking, false);
  });

  it("2.2: initiateCall transitions disconnected -> connecting", async () => {
    const transitions = [];
    stateMachine.on("statusChanged", (next, prev) => transitions.push({ next, prev }));

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        token: "tok_123",
        ws_url: "wss://livekit.cloud",
        room: "sandbox-1",
      }),
    });

    mockRoom.setConnectDelay(10);
    const callPromise = stateMachine.startCall({ sessionId: "test-sess" }, mockFetch);

    // Immediate state is connecting
    assert.equal(stateMachine.connectionStatus, "connecting");
    await callPromise;
    assert.equal(transitions[0].next, "connecting");
    assert.equal(transitions[0].prev, "disconnected");
  });

  it("2.3: Room connection transitions connecting -> waiting_for_agent", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        token: "tok_123",
        ws_url: "wss://livekit.cloud",
        room: "sandbox-1",
      }),
    });

    await stateMachine.startCall({ sessionId: "test-sess" }, mockFetch);
    assert.equal(stateMachine.connectionStatus, "waiting_for_agent");
  });

  it("2.4: Agent remote audio track subscription transitions waiting_for_agent -> connected", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        token: "tok_123",
        ws_url: "wss://livekit.cloud",
        room: "sandbox-1",
      }),
    });

    await stateMachine.startCall({ sessionId: "test-sess" }, mockFetch);
    assert.equal(stateMachine.connectionStatus, "waiting_for_agent");

    // Agent joins and publishes audio track
    mockRoom.simulateAgentJoined("calendar-assistant");
    assert.equal(stateMachine.connectionStatus, "connected");
  });

  it("2.5: Network drop transitions connected -> reconnecting and restores on reconnected", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        token: "tok_123",
        ws_url: "wss://livekit.cloud",
        room: "sandbox-1",
      }),
    });

    await stateMachine.startCall({ sessionId: "test-sess" }, mockFetch);
    mockRoom.simulateAgentJoined("calendar-assistant");
    assert.equal(stateMachine.connectionStatus, "connected");

    // Network drops
    mockRoom.simulateNetworkDrop();
    assert.equal(stateMachine.connectionStatus, "reconnecting");

    // Network recovers
    mockRoom.simulateNetworkRestored();
    assert.equal(stateMachine.connectionStatus, "connected");
  });

  it("2.6: Fatal room error transitions to error and hangup transitions to disconnected", async () => {
    mockRoom.simulateFatalError(new Error("PeerConnection terminated"));
    assert.equal(stateMachine.connectionStatus, "error");
    assert.equal(stateMachine.error.code, "ROOM_DISCONNECT");

    // User taps Hangup / End Call
    await stateMachine.endCall();
    assert.equal(stateMachine.connectionStatus, "disconnected");
  });
});

describe("Tier 1 - Feature Coverage: AudioSession VoIP Mode", () => {
  let mockAudioSession;
  let stateMachine;
  let mockRoom;

  beforeEach(() => {
    mockAudioSession = new MockAudioSession();
    mockRoom = new MockLiveKitRoom();
    stateMachine = new VoiceBotStateMachine({
      audioSession: mockAudioSession,
      room: mockRoom,
    });
  });

  it("3.1: VoIP mode activation configures voiceChat category and mode", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        token: "tok",
        ws_url: "wss://lk.io",
      }),
    });

    await stateMachine.startCall({}, mockFetch);

    assert.equal(mockAudioSession.isActive, true);
    assert.equal(mockAudioSession.category, "AVAudioSessionCategoryPlayAndRecord");
    assert.equal(mockAudioSession.mode, "AVAudioSessionModeVoiceChat");
  });

  it("3.2: Speakerphone configuration enables loudspeaker on call start", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        token: "tok",
        ws_url: "wss://lk.io",
      }),
    });

    await stateMachine.startCall({}, mockFetch);
    assert.equal(mockAudioSession.isSpeakerphoneOn, true);
  });

  it("3.3: Clean teardown stops AudioSession and releases microphone hardware on hangup", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        token: "tok",
        ws_url: "wss://lk.io",
      }),
    });

    await stateMachine.startCall({}, mockFetch);
    assert.equal(mockAudioSession.isActive, true);

    await stateMachine.endCall();
    assert.equal(mockAudioSession.isActive, false);
    assert.equal(mockAudioSession.isSpeakerphoneOn, false);

    const stopCall = mockAudioSession.history.find((h) => h.method === "stopAudioSession");
    assert.ok(stopCall, "stopAudioSession must be invoked to release mic hardware");
  });

  it("3.4: Prevents redundant AudioSession start if session is already active", async () => {
    await mockAudioSession.startAudioSession({ mode: "AVAudioSessionModeVoiceChat" });
    const initialHistoryLength = mockAudioSession.history.length;

    // Second call
    await mockAudioSession.startAudioSession({ mode: "AVAudioSessionModeVoiceChat" });
    assert.equal(mockAudioSession.history.length, initialHistoryLength + 1);
    assert.equal(mockAudioSession.isActive, true);
  });

  it("3.5: Handles microphone permission denial without locking hardware", async () => {
    mockAudioSession.setPermission(false);
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        token: "tok",
        ws_url: "wss://lk.io",
      }),
    });

    await assert.rejects(
      async () => {
        await stateMachine.startCall({}, mockFetch);
      },
      /Microphone permission denied/,
    );

    assert.equal(mockAudioSession.isActive, false);
    assert.equal(stateMachine.connectionStatus, "error");
  });

  it("3.6: Speakerphone toggle dynamically changes hardware routing while active", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        token: "tok",
        ws_url: "wss://lk.io",
      }),
    });

    await stateMachine.startCall({}, mockFetch);
    assert.equal(mockAudioSession.isSpeakerphoneOn, true);

    stateMachine.setSpeakerphone(false);
    assert.equal(mockAudioSession.isSpeakerphoneOn, false);

    stateMachine.setSpeakerphone(true);
    assert.equal(mockAudioSession.isSpeakerphoneOn, true);
  });
});

describe("Tier 1 - Feature Coverage: Sub-20ms DataChannel Interruption", () => {
  let stateMachine;
  let mockRoom;

  beforeEach(() => {
    mockRoom = new MockLiveKitRoom();
    stateMachine = new VoiceBotStateMachine({ room: mockRoom });
  });

  it("4.1: User speech onset triggers response.cancel strictly when isBotSpeaking === true", async () => {
    stateMachine.isBotSpeaking = true;
    const result = await stateMachine.handleUserSpeechActivity(true);

    assert.equal(result.interrupted, true);
    assert.equal(mockRoom.sentPackets.length, 1);
    assert.deepEqual(mockRoom.sentPackets[0].payload, { type: "response.cancel" });
    assert.equal(mockRoom.sentPackets[0].reliable, true);
  });

  it("4.2: User speech onset suppresses cancel signal when isBotSpeaking === false", async () => {
    stateMachine.isBotSpeaking = false;
    const result = await stateMachine.handleUserSpeechActivity(true);

    assert.equal(result.interrupted, false);
    assert.equal(result.reason, "bot_not_speaking");
    assert.equal(mockRoom.sentPackets.length, 0, "No cancel packet should be sent when bot is silent");
  });

  it("4.3: Interruption dispatch latency is sub-20ms", async () => {
    stateMachine.isBotSpeaking = true;
    const result = await stateMachine.handleUserSpeechActivity(true);

    assert.equal(result.interrupted, true);
    assert.ok(result.elapsedMs < 20, `Interruption elapsed time ${result.elapsedMs}ms must be < 20ms`);
  });

  it("4.4: Dispatched packet uses reliable WebRTC DataChannel delivery", async () => {
    stateMachine.isBotSpeaking = true;
    await stateMachine.handleUserSpeechActivity(true);

    const packet = mockRoom.sentPackets[0];
    assert.ok(packet);
    assert.equal(packet.reliable, true);
    assert.equal(packet.payload.type, "response.cancel");
  });

  it("4.5: State is immediately reset (isBotSpeaking = false) upon cancel dispatch", async () => {
    stateMachine.isBotSpeaking = true;
    await stateMachine.handleUserSpeechActivity(true);

    assert.equal(stateMachine.isBotSpeaking, false);
    assert.equal(stateMachine.isUserSpeaking, true);
  });

  it("4.6: User speech while microphone is muted does NOT trigger interruption", async () => {
    stateMachine.isBotSpeaking = true;
    stateMachine.setMuted(true);

    const result = await stateMachine.handleUserSpeechActivity(true);
    assert.equal(result.interrupted, false);
    assert.equal(result.reason, "muted");
    assert.equal(mockRoom.sentPackets.length, 0);
  });
});

describe("Tier 1 - Feature Coverage: VoiceAssistant UI & Controls", () => {
  let stateMachine;

  beforeEach(() => {
    stateMachine = new VoiceBotStateMachine();
  });

  it("5.1: Connection status badge helper maps all connection states to human-readable labels and colors", () => {
    const states = [
      { status: "disconnected", expectedLabel: "Offline", expectedColor: "gray", pulsing: false },
      { status: "connecting", expectedLabel: "Connecting...", expectedColor: "yellow", pulsing: true },
      { status: "waiting_for_agent", expectedLabel: "Waiting for Agent...", expectedColor: "blue", pulsing: true },
      { status: "connected", expectedLabel: "Live Call", expectedColor: "green", pulsing: true },
      { status: "reconnecting", expectedLabel: "Reconnecting...", expectedColor: "orange", pulsing: true },
      { status: "error", expectedLabel: "Connection Error", expectedColor: "red", pulsing: false },
    ];

    for (const item of states) {
      const badge = getVoiceAssistantBadge(item.status);
      assert.equal(badge.label, item.expectedLabel);
      assert.equal(badge.color, item.expectedColor);
      assert.equal(badge.pulsing, item.pulsing);
    }
  });

  it("5.2: Mute button toggles local microphone audio track mute state", () => {
    assert.equal(stateMachine.isMuted, false);
    assert.equal(stateMachine.localTrack.isMuted, false);

    stateMachine.setMuted(true);
    assert.equal(stateMachine.isMuted, true);
    assert.equal(stateMachine.localTrack.isMuted, true);

    stateMachine.setMuted(false);
    assert.equal(stateMachine.isMuted, false);
    assert.equal(stateMachine.localTrack.isMuted, false);
  });

  it("5.3: Muting microphone resets local audio level telemetry to 0 immediately", () => {
    stateMachine.audioLevel.local = 75;
    stateMachine.setMuted(true);

    assert.equal(stateMachine.audioLevel.local, 0);
  });

  it("5.4: Disconnect button triggers full session teardown and resets state to disconnected", async () => {
    stateMachine.connectionStatus = "connected";
    stateMachine.isBotSpeaking = true;
    stateMachine.isUserSpeaking = true;

    await stateMachine.endCall();
    assert.equal(stateMachine.connectionStatus, "disconnected");
    assert.equal(stateMachine.isBotSpeaking, false);
    assert.equal(stateMachine.isUserSpeaking, false);
  });

  it("5.5: Transcript packets populate transcripts array with role and finalization status", () => {
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "assistant",
      text: "Hello! How can I help you?",
      is_final: true,
      timestamp: 1727610000000,
    });

    assert.equal(stateMachine.transcripts.length, 1);
    assert.equal(stateMachine.transcripts[0].role, "assistant");
    assert.equal(stateMachine.transcripts[0].text, "Hello! How can I help you?");
    assert.equal(stateMachine.transcripts[0].isFinal, true);
  });

  it("5.6: Error state correctly stores error code and message for UI error banner", async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ detail: "Internal Server Error" }),
    });

    await assert.rejects(async () => {
      await stateMachine.startCall({}, mockFetch);
    });

    assert.equal(stateMachine.connectionStatus, "error");
    assert.ok(stateMachine.error);
    assert.equal(stateMachine.error.message.includes("500"), true);
  });
});
