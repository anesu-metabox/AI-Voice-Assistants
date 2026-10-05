import { EventEmitter } from "node:events";

/**
 * Mock Native AudioSession for React Native
 * Simulates @livekit/react-native AudioSession hardware management
 */
export class MockAudioSession {
  constructor() {
    this.isActive = false;
    this.isSpeakerphoneOn = false;
    this.category = "";
    this.mode = "";
    this.history = [];
    this.permissionGranted = true;
  }

  setPermission(granted) {
    this.permissionGranted = Boolean(granted);
  }

  async startAudioSession(options = {}) {
    this.history.push({ method: "startAudioSession", options, time: Date.now() });
    if (!this.permissionGranted) {
      throw new Error("Microphone permission denied by system");
    }
    if (this.isActive) {
      // Idempotent or warning
      return;
    }
    this.isActive = true;
    this.category = options.category || "AVAudioSessionCategoryPlayAndRecord";
    this.mode = options.mode || "AVAudioSessionModeVoiceChat";
  }

  async setSpeakerphoneOn(enabled) {
    this.history.push({ method: "setSpeakerphoneOn", enabled, time: Date.now() });
    this.isSpeakerphoneOn = Boolean(enabled);
  }

  async stopAudioSession() {
    this.history.push({ method: "stopAudioSession", time: Date.now() });
    this.isActive = false;
    this.isSpeakerphoneOn = false;
    this.category = "";
    this.mode = "";
  }

  reset() {
    this.isActive = false;
    this.isSpeakerphoneOn = false;
    this.category = "";
    this.mode = "";
    this.history = [];
    this.permissionGranted = true;
  }
}

/**
 * Mock LiveKit WebRTC Track
 */
export class MockTrack {
  constructor(kind = "audio", name = "audio_track") {
    this.kind = kind;
    this.name = name;
    this.isMuted = false;
    this.history = [];
  }

  mute() {
    this.isMuted = true;
    this.history.push({ action: "mute", time: Date.now() });
  }

  unmute() {
    this.isMuted = false;
    this.history.push({ action: "unmute", time: Date.now() });
  }
}

/**
 * Mock LiveKit Room
 * Simulates WebRTC room, participants, tracks, and reliable DataChannel
 */
export class MockLiveKitRoom extends EventEmitter {
  constructor() {
    super();
    this.state = "disconnected";
    this.wsUrl = null;
    this.token = null;
    this.localParticipant = {
      identity: "user-test",
      isSpeaking: false,
      audioTracks: new Map(),
      publishData: (data, options) => this.sendData(data, options),
    };
    this.remoteParticipants = new Map();
    this.sentPackets = [];
    this.connectDelayMs = 0;
    this.shouldFailConnect = false;
    this.connectErrorMessage = "WebRTC connection failed";
  }

  setConnectDelay(delayMs) {
    this.connectDelayMs = delayMs;
  }

  setShouldFailConnect(shouldFail, message = "WebRTC connection failed") {
    this.shouldFailConnect = shouldFail;
    this.connectErrorMessage = message;
  }

  async connect(wsUrl, token) {
    if (!wsUrl || typeof wsUrl !== "string") {
      throw new Error("Invalid wsUrl: must be a non-empty string");
    }
    if (!token || typeof token !== "string") {
      throw new Error("Invalid token: must be a non-empty string");
    }
    if (this.connectDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.connectDelayMs));
    }
    if (this.shouldFailConnect) {
      this.state = "disconnected";
      throw new Error(this.connectErrorMessage);
    }
    this.state = "connected";
    this.wsUrl = wsUrl;
    this.token = token;
    this.emit("connected");
  }

  async disconnect() {
    this.state = "disconnected";
    this.wsUrl = null;
    this.token = null;
    this.remoteParticipants.clear();
    this.emit("disconnected");
  }

  simulateAgentJoined(identity = "agent-calendar-assistant", track = new MockTrack("audio", "agent_audio")) {
    const participant = {
      identity,
      audioTracks: new Map([["agent_audio", track]]),
    };
    this.remoteParticipants.set(identity, participant);
    this.emit("participantConnected", participant);
    this.emit("trackSubscribed", track, null, participant);
    return { participant, track };
  }

  simulateAgentLeft(identity = "agent-calendar-assistant") {
    const participant = this.remoteParticipants.get(identity);
    if (participant) {
      this.remoteParticipants.delete(identity);
      this.emit("participantDisconnected", participant);
    }
  }

  simulateNetworkDrop() {
    this.state = "reconnecting";
    this.emit("reconnecting");
  }

  simulateNetworkRestored() {
    this.state = "connected";
    this.emit("reconnected");
  }

  simulateFatalError(err = new Error("Connection dropped permanently")) {
    this.state = "disconnected";
    this.emit("disconnected", err);
  }

  async sendData(data, options = {}) {
    const start = performance.now();
    let parsedPayload;
    if (typeof data === "string") {
      try {
        parsedPayload = JSON.parse(data);
      } catch {
        parsedPayload = data;
      }
    } else if (data instanceof Uint8Array) {
      const decoder = new TextDecoder();
      const text = decoder.decode(data);
      try {
        parsedPayload = JSON.parse(text);
      } catch {
        parsedPayload = text;
      }
    } else {
      parsedPayload = data;
    }

    const elapsedMs = performance.now() - start;
    const packet = {
      payload: parsedPayload,
      reliable: options.reliable !== false,
      topic: options.topic || "default",
      elapsedMs,
      timestamp: Date.now(),
    };
    this.sentPackets.push(packet);
    return packet;
  }

  simulateIncomingDataPacket(payload, topic = "default") {
    const encoded = new TextEncoder().encode(JSON.stringify(payload));
    this.emit("dataReceived", encoded, null, null, topic);
  }

  reset() {
    this.state = "disconnected";
    this.wsUrl = null;
    this.token = null;
    this.remoteParticipants.clear();
    this.sentPackets = [];
    this.connectDelayMs = 0;
    this.shouldFailConnect = false;
    this.removeAllListeners();
  }
}

/**
 * Token API Client Specification & Implementation Reference
 */
export class LiveKitApiClient {
  constructor(baseUrl = "http://localhost:8000") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  buildTokenUrl(options = {}) {
    const url = new URL(`${this.baseUrl}/api/livekit/token`);
    if (options.sessionId) {
      url.searchParams.set("session_id", options.sessionId);
    }
    if (options.participantName) {
      url.searchParams.set("participant_name", options.participantName);
    }
    if (options.profileVersion !== undefined && options.profileVersion !== null) {
      url.searchParams.set("profile_version", String(options.profileVersion));
    }
    return url.toString();
  }

  buildHeaders() {
    return { Accept: "application/json" };
  }

  normalizeTokenResponse(raw) {
    if (!raw || typeof raw !== "object") {
      throw new Error("Malformed token response: expected JSON object");
    }
    if (!raw.token || typeof raw.token !== "string" || raw.token.trim() === "") {
      throw new Error("Malformed token response: missing or empty 'token'");
    }
    if (!raw.ws_url || typeof raw.ws_url !== "string" || raw.ws_url.trim() === "") {
      throw new Error("Malformed token response: missing or empty 'ws_url'");
    }

    return {
      token: raw.token,
      wsUrl: raw.ws_url,
      room: raw.room || `sandbox-${raw.session_id || "default"}`,
      identity: raw.identity || "user-unknown",
      sessionId: raw.session_id || raw.sessionId || null,
    };
  }

  async fetchToken(options = {}, fetchFn = fetch) {
    const sessionId = options.sessionId || this.generateSessionId();
    const url = this.buildTokenUrl({ ...options, sessionId });
    const headers = this.buildHeaders();

    let response;
    try {
      response = await fetchFn(url, {
        method: "GET",
        headers,
        credentials: "include",
      });
    } catch (netErr) {
      throw new Error(`Network failure requesting token: ${netErr.message}`);
    }

    if (response.status === 401) {
      let detail = "Authenticated context required";
      try {
        const body = await response.json();
        if (body.detail) detail = body.detail;
      } catch {}
      const err = new Error(`401 Unauthorized: ${detail}`);
      err.status = 401;
      err.code = "AUTH_UNAUTHORIZED";
      throw err;
    }

    if (response.status === 409) {
      let detail = "Publish an assistant profile before starting a voice session";
      try {
        const body = await response.json();
        if (body.detail) detail = body.detail;
      } catch {}
      const err = new Error(`409 Conflict: ${detail}`);
      err.status = 409;
      err.code = "PROFILE_NOT_CONFIGURED";
      throw err;
    }

    if (!response.ok) {
      const err = new Error(`Token request failed with HTTP ${response.status}`);
      err.status = response.status;
      throw err;
    }

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      throw new Error(`Malformed response: invalid JSON body (${parseErr.message})`);
    }

    const normalized = this.normalizeTokenResponse(data);
    if (!normalized.sessionId) {
      normalized.sessionId = sessionId;
    }
    return normalized;
  }

  generateSessionId() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let id = "sess_";
    for (let i = 0; i < 16; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }
}

/**
 * Bi-directional Voice State Machine & Interruption Controller
 */
export class VoiceBotStateMachine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.apiClient = options.apiClient || new LiveKitApiClient();
    this.room = options.room || new MockLiveKitRoom();
    this.audioSession = options.audioSession || new MockAudioSession();

    this.connectionStatus = "disconnected";
    this.isMuted = false;
    this.isSpeakerphone = true;
    this.isBotSpeaking = false;
    this.isUserSpeaking = false;
    this.transcripts = [];
    this.tasks = [];
    this.error = null;

    this.interruptionHistory = [];
    this.audioLevel = { local: 0, remote: 0 };
    this.localTrack = new MockTrack("audio", "microphone");

    this.sessionGeneration = 0;
    this._bindRoomEvents();
  }

  _bindRoomEvents() {
    this.room.on("connected", () => {
      if (this.connectionStatus === "connecting") {
        this._transition("waiting_for_agent");
      }
    });

    this.room.on("trackSubscribed", (track) => {
      if (track.kind === "audio" && (this.connectionStatus === "waiting_for_agent" || this.connectionStatus === "connected")) {
        this._transition("connected");
      }
    });

    this.room.on("reconnecting", () => {
      if (this.connectionStatus === "connected" || this.connectionStatus === "waiting_for_agent") {
        this._transition("reconnecting");
      }
    });

    this.room.on("reconnected", () => {
      if (this.connectionStatus === "reconnecting") {
        if (this.room.remoteParticipants.size > 0) {
          this._transition("connected");
        } else {
          this._transition("waiting_for_agent");
        }
      }
    });

    this.room.on("disconnected", (err) => {
      if (err) {
        this.error = { code: "ROOM_DISCONNECT", message: err.message };
        this._transition("error");
      } else {
        this._transition("disconnected");
      }
    });

    this.room.on("dataReceived", (data) => {
      let packet;
      try {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        packet = JSON.parse(text);
      } catch {
        return;
      }
      this.handleIncomingDataPacket(packet);
    });
  }

  _transition(nextStatus) {
    const prev = this.connectionStatus;
    if (prev === nextStatus) return;
    this.connectionStatus = nextStatus;
    this.emit("statusChanged", nextStatus, prev);
  }

  async startCall(callOptions = {}, fetchFn = fetch) {
    const gen = ++this.sessionGeneration;
    this.error = null;
    this._transition("connecting");

    try {
      // 1. Fetch LiveKit access token
      const tokenData = await this.apiClient.fetchToken(callOptions, fetchFn);
      if (this.sessionGeneration !== gen) {
        throw new Error("Call aborted");
      }

      // 2. Activate native AudioSession in VoIP mode
      await this.audioSession.startAudioSession({
        category: "AVAudioSessionCategoryPlayAndRecord",
        mode: "AVAudioSessionModeVoiceChat",
      });
      if (this.sessionGeneration !== gen) {
        await this.audioSession.stopAudioSession();
        throw new Error("Call aborted");
      }

      await this.audioSession.setSpeakerphoneOn(this.isSpeakerphone);

      // 3. Connect to WebRTC room
      await this.room.connect(tokenData.wsUrl, tokenData.token);
      if (this.sessionGeneration !== gen) {
        await this.room.disconnect();
        await this.audioSession.stopAudioSession();
        throw new Error("Call aborted");
      }
      return tokenData;
    } catch (err) {
      if (this.sessionGeneration !== gen) {
        return null;
      }
      this.error = { code: err.code || "START_CALL_FAILED", message: err.message };
      await this.cleanup();
      this._transition("error");
      throw err;
    }
  }

  async endCall() {
    this.sessionGeneration++;
    await this.cleanup();
    this._transition("disconnected");
  }

  async cleanup() {
    this.isBotSpeaking = false;
    this.isUserSpeaking = false;
    try {
      await this.room.disconnect();
    } catch {}
    try {
      await this.audioSession.stopAudioSession();
    } catch {}
  }

  setMuted(muted) {
    this.isMuted = Boolean(muted);
    if (this.isMuted) {
      this.localTrack.mute();
      this.audioLevel.local = 0;
    } else {
      this.localTrack.unmute();
    }
    this.emit("muteChanged", this.isMuted);
  }

  setSpeakerphone(enabled) {
    this.isSpeakerphone = Boolean(enabled);
    if (this.audioSession.isActive) {
      this.audioSession.setSpeakerphoneOn(this.isSpeakerphone);
    }
  }

  /**
   * Sub-20ms Interruption Protocol
   * Dispatches { type: "response.cancel" } strictly when isBotSpeaking === true
   */
  async handleUserSpeechActivity(detectedSpeaking) {
    const startTime = performance.now();
    this.isUserSpeaking = Boolean(detectedSpeaking);

    if (this.isMuted) {
      // If user is muted, local mic energy should never trigger interruption
      return { interrupted: false, reason: "muted" };
    }

    if (!this.isUserSpeaking) {
      return { interrupted: false, reason: "speech_ended" };
    }

    // Interruption Rule: ONLY publish response.cancel when bot is currently speaking
    if (this.isBotSpeaking) {
      // Clamp bot speech immediately
      this.isBotSpeaking = false;
      const packet = { type: "response.cancel" };
      await this.room.sendData(JSON.stringify(packet), { reliable: true });

      const elapsedMs = performance.now() - startTime;
      const record = {
        timestamp: Date.now(),
        elapsedMs,
        success: true,
      };
      this.interruptionHistory.push(record);
      this.emit("interrupted", record);
      return { interrupted: true, elapsedMs };
    }

    // Bot is NOT speaking -> suppress cancel signal
    return { interrupted: false, reason: "bot_not_speaking" };
  }

  handleIncomingDataPacket(packet) {
    if (!packet || typeof packet !== "object") return;

    if (packet.type === "transcript") {
      const text = typeof packet.text === "string" ? packet.text.trim() : "";
      if (!text) return; // Suppress empty/whitespace transcripts

      const transcriptItem = {
        id: packet.id || `tr_${Date.now()}_${Math.random()}`,
        role: packet.role || "assistant",
        text,
        isFinal: packet.is_final !== false,
        timestamp: packet.timestamp || Date.now(),
      };

      if (transcriptItem.role === "assistant") {
        if (!transcriptItem.isFinal) {
          this.isBotSpeaking = true;
        } else {
          // Final transcript seals phrase
        }
      }

      this.transcripts.push(transcriptItem);
      this.emit("transcript", transcriptItem);
    } else if (packet.type === "task_update") {
      this.tasks.push(packet.task);
      this.emit("taskUpdate", packet.task);
    } else if (packet.type === "quota_exhausted") {
      this.error = {
        code: packet.error || "RESOURCE_EXHAUSTED",
        message: packet.message || "Gemini Live daily quota exceeded on Google API key. Please check AI Studio billing.",
      };
      this._transition("error");
    }
  }
}

/**
 * UI State and Indicator Helper
 */
export function getVoiceAssistantBadge(status) {
  switch (status) {
    case "disconnected":
      return { label: "Offline", color: "gray", pulsing: false };
    case "connecting":
      return { label: "Connecting...", color: "yellow", pulsing: true };
    case "waiting_for_agent":
      return { label: "Waiting for Agent...", color: "blue", pulsing: true };
    case "connected":
      return { label: "Live Call", color: "green", pulsing: true };
    case "reconnecting":
      return { label: "Reconnecting...", color: "orange", pulsing: true };
    case "error":
      return { label: "Connection Error", color: "red", pulsing: false };
    default:
      return { label: "Unknown", color: "gray", pulsing: false };
  }
}
