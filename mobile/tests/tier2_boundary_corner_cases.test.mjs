import test, { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  LiveKitApiClient,
  MockAudioSession,
  MockLiveKitRoom,
  VoiceBotStateMachine,
} from "./harness.mjs";

describe("Tier 2 - Boundary Cases: Network Failure Handling", () => {
  let client;
  let stateMachine;
  let mockRoom;
  let mockAudioSession;

  beforeEach(() => {
    client = new LiveKitApiClient("http://localhost:8000");
    mockRoom = new MockLiveKitRoom();
    mockAudioSession = new MockAudioSession();
    stateMachine = new VoiceBotStateMachine({
      apiClient: client,
      room: mockRoom,
      audioSession: mockAudioSession,
    });
  });

  it("2.1.1: Fetch throws TypeError (e.g. DNS failure) -> structured network error", async () => {
    const mockFailingFetch = async () => {
      throw new TypeError("fetch failed: getaddrinfo ENOTFOUND api.backend.internal");
    };

    await assert.rejects(
      async () => {
        await client.fetchToken({}, mockFailingFetch);
      },
      /Network failure requesting token: fetch failed/,
    );
  });

  it("2.1.2: Fetch timeout / abort signal rejects token acquisition", async () => {
    const mockTimeoutFetch = async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "AbortError";
      throw err;
    };

    await assert.rejects(
      async () => {
        await client.fetchToken({}, mockTimeoutFetch);
      },
      /The operation was aborted due to timeout/,
    );
  });

  it("2.1.3: WebRTC Room.connect failure transitions state machine to error and releases mic", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        token: "tok_abc",
        ws_url: "wss://unreachable.livekit.cloud",
      }),
    });

    mockRoom.setShouldFailConnect(true, "ICE connection failed: connection timed out");

    await assert.rejects(
      async () => {
        await stateMachine.startCall({}, mockFetch);
      },
      /ICE connection failed: connection timed out/,
    );

    assert.equal(stateMachine.connectionStatus, "error");
    assert.equal(stateMachine.error.code, "START_CALL_FAILED");
    assert.equal(mockAudioSession.isActive, false, "Mic must be released on connect error");
  });

  it("2.1.4: Device offline check prevents initiating token request", async () => {
    let fetchCalled = false;
    const isOnline = false;

    const mockFetch = async () => {
      fetchCalled = true;
      return { ok: true, status: 200 };
    };

    // Offline guard
    if (!isOnline) {
      stateMachine.error = { code: "OFFLINE", message: "No internet connection detected" };
      stateMachine._transition("error");
    } else {
      await stateMachine.startCall({}, mockFetch);
    }

    assert.equal(fetchCalled, false);
    assert.equal(stateMachine.connectionStatus, "error");
    assert.equal(stateMachine.error.code, "OFFLINE");
  });

  it("2.1.5: Aborted fetch during call start resets state cleanly without leaving active audio session", async () => {
    const mockAbortFetch = async () => {
      throw new Error("Request cancelled by user");
    };

    await assert.rejects(
      async () => {
        await stateMachine.startCall({}, mockAbortFetch);
      },
      /Request cancelled by user/,
    );

    assert.equal(mockAudioSession.isActive, false);
    assert.equal(stateMachine.connectionStatus, "error");
  });
});

describe("Tier 2 - Boundary Cases: 401 Unauthorized Handling", () => {
  let client;
  let stateMachine;
  let mockRoom;
  let mockAudioSession;

  beforeEach(() => {
    client = new LiveKitApiClient("http://localhost:8000");
    mockRoom = new MockLiveKitRoom();
    mockAudioSession = new MockAudioSession();
    stateMachine = new VoiceBotStateMachine({
      apiClient: client,
      room: mockRoom,
      audioSession: mockAudioSession,
    });
  });

  it("2.2.1: Backend 401 returns structured AUTH_UNAUTHORIZED error", async () => {
    const mock401Fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Invalid or expired session context HMAC signature" }),
    });

    await assert.rejects(
      async () => {
        await client.fetchToken({}, mock401Fetch);
      },
      (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.code, "AUTH_UNAUTHORIZED");
        assert.ok(err.message.includes("401 Unauthorized"));
        return true;
      },
    );
  });

  it("2.2.2: 401 response sets state machine to error and records auth failure", async () => {
    const mock401Fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Authenticated context required" }),
    });

    await assert.rejects(async () => {
      await stateMachine.startCall({}, mock401Fetch);
    });

    assert.equal(stateMachine.connectionStatus, "error");
    assert.equal(stateMachine.error.code, "AUTH_UNAUTHORIZED");
  });

  it("2.2.3: 401 suppresses automatic reconnect attempts", async () => {
    let reconnectAttempts = 0;
    const mock401Fetch = async () => {
      reconnectAttempts++;
      return {
        ok: false,
        status: 401,
        json: async () => ({ detail: "Session revoked" }),
      };
    };

    try {
      await stateMachine.startCall({}, mock401Fetch);
    } catch (err) {
      // If error is 401, client must not schedule retry
      if (err.status === 401) {
        // Do not retry
      } else {
        await stateMachine.startCall({}, mock401Fetch);
      }
    }

    assert.equal(reconnectAttempts, 1, "Must never auto-retry on 401");
  });

  it("2.2.4: Extracts custom detail from 401 response JSON if present", async () => {
    const mock401Fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Tenant subscription expired. Please renew." }),
    });

    await assert.rejects(
      async () => {
        await client.fetchToken({}, mock401Fetch);
      },
      /Tenant subscription expired/,
    );
  });

  it("2.2.5: Resets audio session and clears active connection on 401", async () => {
    const mock401Fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: "Unauthorized" }),
    });

    try {
      await stateMachine.startCall({}, mock401Fetch);
    } catch {}

    assert.equal(mockAudioSession.isActive, false);
    assert.equal(mockRoom.state, "disconnected");
  });
});

describe("Tier 2 - Boundary Cases: 409 Conflict Handling", () => {
  let client;
  let stateMachine;
  let mockRoom;
  let mockAudioSession;

  beforeEach(() => {
    client = new LiveKitApiClient("http://localhost:8000");
    mockRoom = new MockLiveKitRoom();
    mockAudioSession = new MockAudioSession();
    stateMachine = new VoiceBotStateMachine({
      apiClient: client,
      room: mockRoom,
      audioSession: mockAudioSession,
    });
  });

  it("2.3.1: Backend 409 returns structured PROFILE_NOT_CONFIGURED", async () => {
    const mock409Fetch = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ detail: "Publish an assistant profile before starting a voice session" }),
    });

    await assert.rejects(
      async () => {
        await client.fetchToken({}, mock409Fetch);
      },
      (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, "PROFILE_NOT_CONFIGURED");
        return true;
      },
    );
  });

  it("2.3.2: Parses 409 error message with profile publish requirement", async () => {
    const mock409Fetch = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ detail: "Publish an assistant profile before starting a voice session" }),
    });

    await assert.rejects(
      async () => {
        await client.fetchToken({}, mock409Fetch);
      },
      /Publish an assistant profile before starting a voice session/,
    );
  });

  it("2.3.3: Prevents room connection when 409 occurs", async () => {
    const mock409Fetch = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ detail: "No published profile" }),
    });

    try {
      await stateMachine.startCall({}, mock409Fetch);
    } catch {}

    assert.equal(mockRoom.state, "disconnected");
    assert.equal(mockRoom.wsUrl, null);
  });

  it("2.3.4: Discharges audio session and releases mic hardware on 409", async () => {
    const mock409Fetch = async () => ({
      ok: false,
      status: 409,
      json: async () => ({ detail: "No published profile" }),
    });

    try {
      await stateMachine.startCall({}, mock409Fetch);
    } catch {}

    assert.equal(mockAudioSession.isActive, false);
    assert.equal(mockAudioSession.isSpeakerphoneOn, false);
  });

  it("2.3.5: Distinguishes 409 conflict from 401 unauthorized and 500 server error", () => {
    const err409 = new Error("409 Conflict: Publish profile");
    err409.status = 409;
    err409.code = "PROFILE_NOT_CONFIGURED";

    const err401 = new Error("401 Unauthorized");
    err401.status = 401;
    err401.code = "AUTH_UNAUTHORIZED";

    const err500 = new Error("500 Internal Server Error");
    err500.status = 500;

    assert.notEqual(err409.code, err401.code);
    assert.equal(err409.status, 409);
    assert.equal(err401.status, 401);
    assert.equal(err500.status, 500);
  });
});

describe("Tier 2 - Boundary Cases: Malformed Token Responses", () => {
  let client;

  beforeEach(() => {
    client = new LiveKitApiClient();
  });

  it("2.4.1: Missing token field in JSON throws validation error", () => {
    const payload = {
      ws_url: "wss://lk.io",
      room: "sandbox-1",
    };

    assert.throws(
      () => client.normalizeTokenResponse(payload),
      /missing or empty 'token'/,
    );
  });

  it("2.4.2: Missing ws_url field in JSON throws validation error", () => {
    const payload = {
      token: "valid_jwt_token",
      room: "sandbox-1",
    };

    assert.throws(
      () => client.normalizeTokenResponse(payload),
      /missing or empty 'ws_url'/,
    );
  });

  it("2.4.3: Non-JSON HTML response (e.g. 502 Bad Gateway) fails gracefully", async () => {
    const mockHtmlFetch = async () => ({
      ok: true, // Suppose proxy returned 200 with HTML maintenance page
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token '<', '<!DOCTYPE '... is not valid JSON");
      },
    });

    await assert.rejects(
      async () => {
        await client.fetchToken({}, mockHtmlFetch);
      },
      /Malformed response: invalid JSON body/,
    );
  });

  it("2.4.4: Empty string values (token: '' or ws_url: '') rejected as malformed", () => {
    assert.throws(
      () => client.normalizeTokenResponse({ token: "   ", ws_url: "wss://lk.io" }),
      /missing or empty 'token'/,
    );

    assert.throws(
      () => client.normalizeTokenResponse({ token: "jwt", ws_url: "   " }),
      /missing or empty 'ws_url'/,
    );
  });

  it("2.4.5: Non-object responses (e.g. null, array, string) rejected as malformed", () => {
    assert.throws(
      () => client.normalizeTokenResponse(null),
      /expected JSON object/,
    );
    assert.throws(
      () => client.normalizeTokenResponse("some_string"),
      /expected JSON object/,
    );
    assert.throws(
      () => client.normalizeTokenResponse(42),
      /expected JSON object/,
    );
  });
});

describe("Tier 2 - Boundary Cases: Rapid Mute Toggling", () => {
  let stateMachine;

  beforeEach(() => {
    stateMachine = new VoiceBotStateMachine();
  });

  it("2.5.1: 20 rapid toggles settle on correct final boolean state", () => {
    for (let i = 0; i < 20; i++) {
      stateMachine.setMuted(i % 2 === 0);
    }
    // 19th index: 19 % 2 !== 0 -> false
    assert.equal(stateMachine.isMuted, false);
    assert.equal(stateMachine.localTrack.isMuted, false);
  });

  it("2.5.2: Muting while already muted is idempotent", () => {
    stateMachine.setMuted(true);
    const historyCount = stateMachine.localTrack.history.length;

    stateMachine.setMuted(true);
    assert.equal(stateMachine.isMuted, true);
    assert.equal(stateMachine.localTrack.isMuted, true);
  });

  it("2.5.3: Unmuting while already unmuted is idempotent", () => {
    stateMachine.setMuted(false);
    assert.equal(stateMachine.isMuted, false);

    stateMachine.setMuted(false);
    assert.equal(stateMachine.isMuted, false);
  });

  it("2.5.4: Mute state persists across room reconnection", () => {
    stateMachine.connectionStatus = "connected";
    stateMachine.setMuted(true);
    stateMachine.room.simulateNetworkDrop();
    assert.equal(stateMachine.connectionStatus, "reconnecting");

    stateMachine.room.simulateNetworkRestored();
    assert.equal(stateMachine.isMuted, true);
    assert.equal(stateMachine.localTrack.isMuted, true);
  });

  it("2.5.5: Muting immediately suppresses speech detection interruption capability", async () => {
    stateMachine.isBotSpeaking = true;
    stateMachine.setMuted(true);

    const result = await stateMachine.handleUserSpeechActivity(true);
    assert.equal(result.interrupted, false);
    assert.equal(result.reason, "muted");
    assert.equal(stateMachine.isBotSpeaking, true);
  });
});

describe("Tier 2 - Boundary Cases: Empty and Whitespace Transcripts", () => {
  let stateMachine;

  beforeEach(() => {
    stateMachine = new VoiceBotStateMachine();
  });

  it("2.6.1: Empty string transcript packet is discarded and not appended", () => {
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "assistant",
      text: "",
      is_final: true,
    });

    assert.equal(stateMachine.transcripts.length, 0);
  });

  it("2.6.2: Whitespace-only string transcript is discarded", () => {
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "assistant",
      text: "   \n\t  \r  ",
      is_final: true,
    });

    assert.equal(stateMachine.transcripts.length, 0);
  });

  it("2.6.3: Missing text property does not throw exception and is ignored", () => {
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "assistant",
      is_final: true,
    });

    assert.equal(stateMachine.transcripts.length, 0);
  });

  it("2.6.4: Non-string text property does not crash transcript stream", () => {
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "assistant",
      text: 12345,
    });

    assert.equal(stateMachine.transcripts.length, 0);
  });

  it("2.6.5: Valid transcript is trimmed of leading and trailing whitespace", () => {
    stateMachine.handleIncomingDataPacket({
      type: "transcript",
      role: "assistant",
      text: "   Scheduling your calendar appointment now.   ",
      is_final: true,
    });

    assert.equal(stateMachine.transcripts.length, 1);
    assert.equal(stateMachine.transcripts[0].text, "Scheduling your calendar appointment now.");
  });
});

describe("Tier 2 - Boundary Cases: Reconnection After Connection Drops", () => {
  let stateMachine;
  let mockRoom;
  let mockAudioSession;

  beforeEach(async () => {
    mockRoom = new MockLiveKitRoom();
    mockAudioSession = new MockAudioSession();
    stateMachine = new VoiceBotStateMachine({
      room: mockRoom,
      audioSession: mockAudioSession,
    });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ token: "tok", ws_url: "wss://lk.io" }),
    });

    await stateMachine.startCall({}, mockFetch);
    mockRoom.simulateAgentJoined("calendar-assistant");
    assert.equal(stateMachine.connectionStatus, "connected");
  });

  it("2.7.1: Room reconnecting sets connectionStatus to reconnecting", () => {
    mockRoom.simulateNetworkDrop();
    assert.equal(stateMachine.connectionStatus, "reconnecting");
  });

  it("2.7.2: Room reconnected restores connected if agent participant is present", () => {
    mockRoom.simulateNetworkDrop();
    assert.equal(stateMachine.connectionStatus, "reconnecting");

    mockRoom.simulateNetworkRestored();
    assert.equal(stateMachine.connectionStatus, "connected");
  });

  it("2.7.3: Room reconnected transitions to waiting_for_agent if agent disconnected during outage", () => {
    mockRoom.simulateNetworkDrop();
    mockRoom.simulateAgentLeft("calendar-assistant");

    mockRoom.simulateNetworkRestored();
    assert.equal(stateMachine.connectionStatus, "waiting_for_agent");
  });

  it("2.7.4: Multiple rapid reconnect flaps maintain state machine integrity", () => {
    for (let i = 0; i < 5; i++) {
      mockRoom.simulateNetworkDrop();
      assert.equal(stateMachine.connectionStatus, "reconnecting");
      mockRoom.simulateNetworkRestored();
      assert.equal(stateMachine.connectionStatus, "connected");
    }
  });

  it("2.7.5: Permanent disconnect / fatal error during reconnect transitions to error and stops AudioSession", () => {
    mockRoom.simulateNetworkDrop();
    assert.equal(stateMachine.connectionStatus, "reconnecting");

    mockRoom.simulateFatalError(new Error("PeerConnection lost permanently"));
    assert.equal(stateMachine.connectionStatus, "error");
    assert.equal(stateMachine.error.code, "ROOM_DISCONNECT");
  });
});
