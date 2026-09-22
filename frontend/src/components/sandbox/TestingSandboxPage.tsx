import { useState, useEffect, useRef, useCallback } from "react";
import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import { logSafeFailure } from "@/lib/safeLogging";

interface TestingSandboxProps {
  onBack: () => void;
  profileVersion?: number | null;
}

interface Message {
  id: string;
  sender: "assistant" | "user" | "system";
  text: string;
  timestamp: string;
}

export function TestingSandboxPage({ onBack, profileVersion = null }: TestingSandboxProps) {
  // Session configuration from database
  const [assistantConfig, setAssistantConfig] = useState<{
    assistant_name: string;
    voice_engine: string;
    inbound_greeting: string;
    system_prompt: string;
  }>({
    assistant_name: "",
    voice_engine: "Aoede",
    inbound_greeting: "",
    system_prompt: "",
  });

  const [companyProfile, setCompanyProfile] = useState<{
    company_name: string;
    timezone: string;
  }>({
    company_name: "",
    timezone: "Indian/Mauritius",
  });

  // Call state
  const [sessionStatus, setSessionStatus] = useState<"disconnected" | "connecting" | "connected" | "speaking" | "listening">("disconnected");
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // References
  const roomRef = useRef<Room | null>(null);
  const localAudioTrackRef = useRef<any>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const assistantAudioTrackRef = useRef<RemoteTrack | null>(null);
  const assistantParticipantIdentityRef = useRef<string | null>(null);
  const timerRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const connectInFlightRef = useRef<Promise<void> | null>(null);
  const voiceSessionLockReleaseRef = useRef<(() => void) | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const transcriptIdsRef = useRef<Set<string>>(new Set());
  const [roomName, setRoomName] = useState<string | null>(null);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const cleanupAssistantAudio = useCallback(() => {
    const element = audioElementRef.current;
    const track = assistantAudioTrackRef.current;
    if (element) {
      element.pause();
      element.onplay = null;
      element.onpause = null;
      element.onended = null;
      if (track) {
        try { track.detach(element); } catch {}
      }
      element.srcObject = null;
    }
    audioElementRef.current = null;
    assistantAudioTrackRef.current = null;
  }, []);

  const releaseVoiceSessionLock = useCallback(() => {
    const release = voiceSessionLockReleaseRef.current;
    voiceSessionLockReleaseRef.current = null;
    release?.();
  }, []);

  const acquireVoiceSessionLock = useCallback(async (): Promise<boolean> => {
    if (!("locks" in navigator)) return true;

    return new Promise<boolean>((resolve) => {
      let acquisitionSettled = false;
      navigator.locks.request(
        "vocalist-livekit-voice-session",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            acquisitionSettled = true;
            resolve(false);
            return;
          }

          let releaseLock!: () => void;
          const holdLock = new Promise<void>((release) => {
            releaseLock = release;
          });
          voiceSessionLockReleaseRef.current = releaseLock;
          acquisitionSettled = true;
          resolve(true);
          await holdLock;
        },
      ).catch(() => {
        if (!acquisitionSettled) resolve(false);
      });
    });
  }, []);

  // Load database settings for Assistant and Company
  useEffect(() => {
    async function loadSettings() {
      try {
        const asstRes = await fetch("/api/assistant-config", { cache: "no-store" });
        if (asstRes.ok) {
          const json = await asstRes.json();
          if (json.data) {
            setAssistantConfig({
              assistant_name: json.data.assistant_name || "",
              voice_engine: json.data.voice_engine || "Aoede",
              inbound_greeting: json.data.inbound_greeting || "",
              system_prompt: json.data.system_prompt || "",
            });
          }
        }
      } catch (err) {
        logSafeFailure("Assistant configuration load failed", err, "warn");
      }

      try {
        const compRes = await fetch("/api/company-profile", { cache: "no-store" });
        if (compRes.ok) {
          const json = await compRes.json();
          if (json.data) {
            setCompanyProfile({
              company_name: json.data.company_name || "",
              timezone: json.data.timezone || "Indian/Mauritius",
            });
          }
        }
      } catch (err) {
        logSafeFailure("Company profile load failed", err, "warn");
      }
    }
    loadSettings();
  }, []);

  // Call duration timer
  useEffect(() => {
    if (sessionStatus === "connected" || sessionStatus === "speaking" || sessionStatus === "listening") {
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setDuration(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sessionStatus]);

  // Canvas visualizer animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dataArray = new Uint8Array(64);

    const draw = () => {
      animationFrameRef.current = requestAnimationFrame(draw);
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      if (analyserRef.current) {
        analyserRef.current.getByteFrequencyData(dataArray);
      } else {
        // Simulated breathing wave when connected
        for (let i = 0; i < dataArray.length; i++) {
          if (sessionStatus !== "disconnected" && sessionStatus !== "connecting") {
            const time = Date.now() / 300;
            dataArray[i] = Math.max(12, Math.sin(time + i * 0.2) * 45 + 50);
          } else {
            dataArray[i] = 0;
          }
        }
      }

      // Draw radial gradient background
      const baseRadius = 54;
      const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.4, centerX, centerY, baseRadius * 1.8);
      if (sessionStatus === "speaking") {
        gradient.addColorStop(0, "rgba(99, 102, 241, 0.45)");
        gradient.addColorStop(1, "rgba(99, 102, 241, 0.0)");
      } else if (sessionStatus === "listening") {
        gradient.addColorStop(0, "rgba(59, 130, 246, 0.45)");
        gradient.addColorStop(1, "rgba(59, 130, 246, 0.0)");
      } else if (sessionStatus === "connected") {
        gradient.addColorStop(0, "rgba(34, 197, 94, 0.35)");
        gradient.addColorStop(1, "rgba(34, 197, 94, 0.0)");
      } else {
        gradient.addColorStop(0, "rgba(148, 163, 184, 0.15)");
        gradient.addColorStop(1, "rgba(148, 163, 184, 0.0)");
      }
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Draw frequency spectrum bars around the orb
      const barsCount = 36;
      for (let i = 0; i < barsCount; i++) {
        const angle = (i * 2 * Math.PI) / barsCount;
        const val = dataArray[i % dataArray.length] / 255;
        const barLength = Math.max(4, val * 34);

        const x1 = centerX + Math.cos(angle) * (baseRadius + 2);
        const y1 = centerY + Math.sin(angle) * (baseRadius + 2);
        const x2 = centerX + Math.cos(angle) * (baseRadius + barLength);
        const y2 = centerY + Math.sin(angle) * (baseRadius + barLength);

        ctx.strokeStyle = sessionStatus === "speaking" ? "#818CF8" : sessionStatus === "listening" ? "#60A5FA" : "#CBD5E1";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    };

    draw();

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [sessionStatus]);

  // Connect to LiveKit Room
  const startSession = useCallback(async () => {
    if (connectInFlightRef.current || roomRef.current) return;

    const run = (async () => {
    setErrorMessage(null);
    setSessionStatus("connecting");
    const ownsVoiceSession = await acquireVoiceSessionLock();
    if (!ownsVoiceSession) {
      setSessionStatus("disconnected");
      setErrorMessage("A voice session is already active in another browser tab. End it there before starting a new one.");
      return;
    }
    const sessionId = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    sessionIdRef.current = sessionId;
    transcriptIdsRef.current.clear();

    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages([
      {
        id: "msg-init",
        sender: "system",
        text: `Initiating session with ${assistantConfig.assistant_name} (${assistantConfig.voice_engine} voice)...`,
        timestamp: timeStr,
      },
    ]);

    try {
      // 1. Fetch authenticated token from FastAPI backend
      const params = new URLSearchParams({ session_id: sessionId });
      if (profileVersion !== null) params.set("profile_version", String(profileVersion));
      const res = await fetch(`/api/livekit/token?${params.toString()}`);
      if (!res.ok) {
        const errorBody = await res.json().catch(() => null) as
          | { error_message?: string; detail?: string }
          | null;
        throw new Error(
          errorBody?.error_message ||
          errorBody?.detail ||
          `Failed to obtain LiveKit token: HTTP ${res.status}`,
        );
      }
      const data = await res.json();
      const { token, ws_url, room: resolvedRoom } = data;
      if (!token || !ws_url || !resolvedRoom) throw new Error("LiveKit token response was incomplete.");
      setRoomName(resolvedRoom);

      // 2. Instantiate LiveKit Room
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      // The agent's custom DataChannel transcript is the only UI source. Still
      // consume LiveKit's native stream so the SDK does not report an
      // unhandled lk.transcription stream or leave its reader open.
      room.registerTextStreamHandler("lk.transcription", (reader) => {
        void reader.readAll().catch(() => undefined);
      });

      // 3. Handle incoming audio track from Gemini Live agent
      room.on(RoomEvent.TrackSubscribed, async (
        track: RemoteTrack,
        _publication: RemoteTrackPublication,
        participant: RemoteParticipant,
      ) => {
        if (track.kind === Track.Kind.Audio) {
          const acceptedIdentity = assistantParticipantIdentityRef.current;
          if (acceptedIdentity && acceptedIdentity !== participant.identity) {
            console.warn("Ignoring audio from an additional LiveKit assistant participant.");
            track.detach();
            return;
          }
          if (assistantAudioTrackRef.current === track && audioElementRef.current) {
            return;
          }

          assistantParticipantIdentityRef.current = participant.identity;
          cleanupAssistantAudio();
          const element = document.createElement("audio");
          element.autoplay = false;
          track.attach(element);
          audioElementRef.current = element;
          assistantAudioTrackRef.current = track;
          setSessionStatus("speaking");
          try {
            await element.play();
          } catch (playErr) {
            logSafeFailure("Assistant audio playback is blocked", playErr, "warn");
            setErrorMessage("Microphone connected, but browser audio playback is blocked. Click the page to retry audio.");
          }
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
        if (assistantAudioTrackRef.current === track) {
          cleanupAssistantAudio();
        }
      });

      room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
        if (assistantParticipantIdentityRef.current === participant.identity) {
          cleanupAssistantAudio();
          assistantParticipantIdentityRef.current = null;
        }
      });

      // 4. Handle incoming text / transcripts over DataChannel
      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const str = new TextDecoder().decode(payload);
          const packet = JSON.parse(str);
          if (packet.type === "transcript" && packet.text?.trim()) {
            const messageId = packet.id || packet.message_id || `${packet.role}:${packet.timestamp}:${packet.text}`;
            if (transcriptIdsRef.current.has(messageId)) return;
            transcriptIdsRef.current.add(messageId);
            setMessages((prev) => [
              ...prev,
              {
                id: messageId,
                sender: packet.role === "assistant" ? "assistant" : "user",
                text: packet.text,
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              },
            ]);
          }
        } catch (e) {
          logSafeFailure("LiveKit data packet could not be decoded", e, "warn");
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) return;
        roomRef.current = null;
        cleanupAssistantAudio();
        assistantParticipantIdentityRef.current = null;
        releaseVoiceSessionLock();
        if (localAudioTrackRef.current) {
          try { localAudioTrackRef.current.stop(); } catch {}
          localAudioTrackRef.current = null;
        }
        if (audioContextRef.current) {
          void audioContextRef.current.close().catch(() => undefined);
          audioContextRef.current = null;
        }
        analyserRef.current = null;
        room.unregisterTextStreamHandler("lk.transcription");
        setRoomName(null);
        setSessionStatus("disconnected");
      });

      // 5. Connect room to LiveKit Cloud
      await room.connect(ws_url, token);

      // 6. Request and publish local microphone
      const localTrack = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      localAudioTrackRef.current = localTrack;
      await room.localParticipant.publishTrack(localTrack);

      // 7. Setup AudioContext and AnalyserNode for reactive visuals
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 128;
          analyserRef.current = analyser;

          const mediaStream = new MediaStream([localTrack.mediaStreamTrack]);
          const source = audioCtx.createMediaStreamSource(mediaStream);
          source.connect(analyser);
        }
      } catch (audioErr) {
        logSafeFailure("Visualizer audio context unavailable", audioErr, "warn");
      }

      setSessionStatus("connected");
    } catch (err: any) {
      logSafeFailure("LiveKit connection failed", err);
      const failedRoom = roomRef.current;
      roomRef.current = null;
      cleanupAssistantAudio();
      assistantParticipantIdentityRef.current = null;
      releaseVoiceSessionLock();
      try { failedRoom?.disconnect(); } catch {}
      if (localAudioTrackRef.current) {
        try { localAudioTrackRef.current.stop(); } catch {}
        localAudioTrackRef.current = null;
      }
      if (audioContextRef.current) {
        try { await audioContextRef.current.close(); } catch {}
        audioContextRef.current = null;
      }
      analyserRef.current = null;
      setRoomName(null);
      setSessionStatus("disconnected");
      setErrorMessage(err?.message || "Could not connect to the LiveKit voice session.");
    }
    })();

    connectInFlightRef.current = run;
    try { await run; } finally { connectInFlightRef.current = null; }
  }, [
    acquireVoiceSessionLock,
    assistantConfig.assistant_name,
    assistantConfig.voice_engine,
    cleanupAssistantAudio,
    profileVersion,
    releaseVoiceSessionLock,
  ]);

  // Disconnect session
  const stopSession = useCallback(() => {
    if (connectInFlightRef.current) return;
    cleanupAssistantAudio();
    assistantParticipantIdentityRef.current = null;
    releaseVoiceSessionLock();
    if (localAudioTrackRef.current) {
      try {
        localAudioTrackRef.current.stop();
      } catch {}
      localAudioTrackRef.current = null;
    }
    if (roomRef.current) {
      try {
        roomRef.current.disconnect();
      } catch {}
      roomRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    sessionIdRef.current = null;
    transcriptIdsRef.current.clear();
    setRoomName(null);
    setSessionStatus("disconnected");
    setMessages((prev) => [
      ...prev,
      {
        id: `msg-end-${Date.now()}`,
        sender: "system",
        text: "Voice session concluded.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  }, [cleanupAssistantAudio, releaseVoiceSessionLock]);

  // Toggle Mute
  const toggleMute = () => {
    if (localAudioTrackRef.current) {
      if (isMuted) {
        localAudioTrackRef.current.unmute();
        setIsMuted(false);
      } else {
        localAudioTrackRef.current.mute();
        setIsMuted(true);
      }
    } else {
      setIsMuted(!isMuted);
    }
  };

  // Format call duration
  const formatDuration = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
  };

  const isLive = sessionStatus !== "disconnected" && sessionStatus !== "connecting";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "calc(100vh - 112px)" }}>
      {/* Top Header Bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "white",
          padding: "16px 24px",
          borderRadius: 12,
          border: "1px solid #E8ECF4",
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            onClick={onBack}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#F1F5F9",
              border: "1px solid #CBD5E1",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              color: "#334155",
              cursor: "pointer",
              fontFamily: "Inter",
            }}
          >
            <span>← Back to AI Assistant</span>
          </button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526" }}>
              Interactive Voice Testing Sandbox
            </div>
            <div style={{ fontSize: 12, color: "#64748B", fontFamily: "Inter" }}>
              Live real-time session testing <strong style={{ color: "#3B5BDB" }}>{assistantConfig.assistant_name}</strong> for <strong style={{ color: "#0D1526" }}>{companyProfile.company_name}</strong>
            </div>
            {profileVersion !== null && <div role="status" style={{ marginTop: 4, fontSize: 11, color: "#92400E" }}>Testing unpublished draft profile version {profileVersion}; this does not publish it.</div>}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Status Badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 100,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "Inter",
              background:
                sessionStatus === "connected"
                  ? "#DCFCE7"
                  : sessionStatus === "speaking"
                  ? "#EEF2FF"
                  : sessionStatus === "listening"
                  ? "#E0F2FE"
                  : sessionStatus === "connecting"
                  ? "#FEF3C7"
                  : "#F1F5F9",
              color:
                sessionStatus === "connected"
                  ? "#166534"
                  : sessionStatus === "speaking"
                  ? "#4338CA"
                  : sessionStatus === "listening"
                  ? "#0369A1"
                  : sessionStatus === "connecting"
                  ? "#92400E"
                  : "#64748B",
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background:
                  sessionStatus === "connected"
                    ? "#22C55E"
                    : sessionStatus === "speaking"
                    ? "#6366F1"
                    : sessionStatus === "listening"
                    ? "#38BDF8"
                    : sessionStatus === "connecting"
                    ? "#F59E0B"
                    : "#94A3B8",
              }}
            />
            <span>
              {sessionStatus === "connected"
                ? "LIVE • GEMINI ACTIVE"
                : sessionStatus === "speaking"
                ? "AI BOT SPEAKING"
                : sessionStatus === "listening"
                ? "LISTENING TO YOU"
                : sessionStatus === "connecting"
                ? "CONNECTING..."
                : "READY TO TEST"}
            </span>
          </div>

          {/* Call Timer */}
          {isLive && (
            <div
              style={{
                fontSize: 13,
                fontFamily: "monospace",
                fontWeight: 700,
                color: "#0D1526",
                background: "#F8FAFC",
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid #E2E8F0",
              }}
            >
              {formatDuration(duration)}
            </div>
          )}
        </div>
      </div>

      {errorMessage && (
        <div style={{ background: "#FEE2E2", color: "#991B1B", padding: "10px 16px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
          {errorMessage}
        </div>
      )}

      {/* Main Sandbox Grid: Left Voice Console | Right Transcript Feed */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, flex: 1 }}>
        {/* Left Card: Audio Orb & Controls */}
        <div
          style={{
            background: "white",
            borderRadius: 16,
            border: "1px solid #E8ECF4",
            padding: 32,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 20px rgba(13,21,38,0.03)",
          }}
        >
          {/* Assistant Info Pill */}
          <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
            <span style={{ fontSize: 12, background: "#EEF2FF", color: "#3B5BDB", padding: "4px 10px", borderRadius: 6, fontWeight: 600 }}>
              Voice: {assistantConfig.voice_engine}
            </span>
            <span style={{ fontSize: 12, background: "#F0FDF4", color: "#16A34A", padding: "4px 10px", borderRadius: 6, fontWeight: 600 }}>
              Model: Gemini 2.0 Flash Live
            </span>
            <span style={{ fontSize: 12, background: "#F8FAFC", color: "#475569", padding: "4px 10px", borderRadius: 6, fontWeight: 500 }}>
              {companyProfile.timezone}
            </span>
          </div>

          {/* Interactive Canvas Orb */}
          <div style={{ position: "relative", width: 220, height: 220, marginBottom: 28 }}>
            <canvas ref={canvasRef} width={220} height={220} style={{ width: "100%", height: "100%" }} />
            <button
              onClick={isLive ? stopSession : startSession}
              disabled={sessionStatus === "connecting"}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: 90,
                height: 90,
                borderRadius: "50%",
                background: isLive ? "#EF4444" : "#3B5BDB",
                border: "none",
                color: "white",
                cursor: sessionStatus === "connecting" ? "wait" : "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: isLive
                  ? "0 0 25px rgba(239, 68, 68, 0.5)"
                  : "0 0 25px rgba(59, 91, 219, 0.4)",
                transition: "all 0.2s ease",
              }}
            >
              {isLive ? (
                <>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <rect x="6" y="6" width="12" height="12" rx="2" fill="white" />
                  </svg>
                  <span style={{ fontSize: 10, fontWeight: 700, marginTop: 4, letterSpacing: "0.05em" }}>END CALL</span>
                </>
              ) : sessionStatus === "connecting" ? (
                <span style={{ fontSize: 11, fontWeight: 600 }}>SYNCING...</span>
              ) : (
                <>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z" fill="white" />
                    <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" stroke="white" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span style={{ fontSize: 10, fontWeight: 700, marginTop: 4, letterSpacing: "0.05em" }}>START</span>
                </>
              )}
            </button>
          </div>

          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0D1526", fontFamily: "Bricolage Grotesque", marginBottom: 4 }}>
              {isLive ? "Voice session active" : "Tap microphone to begin testing"}
            </div>
            <div style={{ fontSize: 13, color: "#64748B", maxWidth: 300, lineHeight: 1.5 }}>
              {isLive
                ? "Speak naturally into your microphone. Gemini Live analyzes inflections and responds with low latency."
                : "Tests your saved company context, prompt instructions, and voice synthesis end-to-end."}
            </div>
          </div>

          {/* Controls Bar */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              onClick={toggleMute}
              disabled={!isLive}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 18px",
                borderRadius: 8,
                border: "1.5px solid #CBD5E1",
                background: isMuted ? "#FEE2E2" : "white",
                color: isMuted ? "#DC2626" : "#334155",
                fontSize: 13,
                fontWeight: 600,
                cursor: isLive ? "pointer" : "not-allowed",
                fontFamily: "Inter",
                opacity: isLive ? 1 : 0.6,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {isMuted ? (
                  <>
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V5a3 3 0 00-5.94-.6" />
                    <path d="M17 16.95A7 7 0 015 12v-2m14 0v2a7 7 0 01-.11 1.23" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                    <path d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
                  </>
                )}
              </svg>
              <span>{isMuted ? "Unmute Mic" : "Mute Mic"}</span>
            </button>

            {isLive && (
              <button
                onClick={stopSession}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 18px",
                  borderRadius: 8,
                  background: "#EF4444",
                  border: "none",
                  color: "white",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "Inter",
                }}
              >
                <span>Hang Up</span>
              </button>
            )}
          </div>
        </div>

        {/* Right Card: Real-Time Conversation Transcript */}
        <div
          style={{
            background: "white",
            borderRadius: 16,
            border: "1px solid #E8ECF4",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 4px 20px rgba(13,21,38,0.03)",
          }}
        >
          <div
            style={{
              padding: "18px 24px",
              borderBottom: "1px solid #E8ECF4",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              background: "#F8FAFC",
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "Bricolage Grotesque", color: "#0D1526" }}>
                Live Conversational Transcript
              </div>
              <div style={{ fontSize: 12, color: "#64748B", fontFamily: "Inter" }}>
                Synchronized turn-taking streamed from Gemini Live
              </div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: 12,
                  color: "#64748B",
                  cursor: "pointer",
                  fontFamily: "Inter",
                  textDecoration: "underline",
                }}
              >
                Clear
              </button>
            )}
          </div>

          <div
            style={{
              flex: 1,
              padding: 24,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minHeight: 360,
              maxHeight: 520,
              background: "#FFFFFF",
            }}
          >
            {messages.length === 0 ? (
              <div style={{ margin: "auto", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>💬</div>
                No conversational turns yet. Start the session to begin dialogue.
              </div>
            ) : (
              messages.map((msg) => {
                const isAssistant = msg.sender === "assistant";
                const isSystem = msg.sender === "system";

                if (isSystem) {
                  return (
                    <div key={msg.id} style={{ textAlign: "center", margin: "4px 0" }}>
                      <span style={{ fontSize: 11, background: "#F1F5F9", color: "#64748B", padding: "3px 10px", borderRadius: 100 }}>
                        {msg.text}
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={msg.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: isAssistant ? "flex-start" : "flex-end",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: isAssistant ? "#3B5BDB" : "#0D1526",
                        marginBottom: 4,
                        display: "flex",
                        gap: 6,
                        alignItems: "center",
                      }}
                    >
                      <span>{isAssistant ? assistantConfig.assistant_name : "You (Microphone)"}</span>
                      <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 400 }}>{msg.timestamp}</span>
                    </div>
                    <div
                      style={{
                        maxWidth: "85%",
                        padding: "12px 16px",
                        borderRadius: 12,
                        borderBottomLeftRadius: isAssistant ? 2 : 12,
                        borderBottomRightRadius: isAssistant ? 12 : 2,
                        background: isAssistant ? "#EEF2FF" : "#0D1526",
                        color: isAssistant ? "#0D1526" : "white",
                        fontSize: 13.5,
                        lineHeight: 1.5,
                        fontFamily: "Inter",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                      }}
                    >
                      {msg.text}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={transcriptEndRef} />
          </div>

          {/* Footer Instruction Note */}
          <div
            style={{
              padding: "12px 20px",
              borderTop: "1px solid #E8ECF4",
              background: "#F8FAFC",
              fontSize: 12,
              color: "#64748B",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>LiveKit Room: <code>{roomName || "not connected"}</code></span>
            <span>Grounding Policy: ADR-008 Enforced</span>
          </div>
        </div>
      </div>
    </div>
  );
}
