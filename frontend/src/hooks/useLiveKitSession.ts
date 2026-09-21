"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { ConnectionStatus, TranscriptMessage, TaskItem } from "@/lib/types";
import {
  activateAudioPlayback,
  getLiveKitConnectionStatus,
  isCurrentSessionGeneration,
} from "@/lib/livekitSessionRuntime";

export const useLiveKitSession = () => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isHandsFree, setIsHandsFree] = useState<boolean>(true);
  const [isBotSpeaking, _setIsBotSpeaking] = useState<boolean>(false);
  const isBotSpeakingRef = useRef<boolean>(false);
  const setIsBotSpeaking = useCallback((speaking: boolean) => {
    isBotSpeakingRef.current = speaking;
    _setIsBotSpeaking(speaking);
  }, []);

  const [isUserSpeaking, _setIsUserSpeaking] = useState<boolean>(false);
  const isUserSpeakingRef = useRef<boolean>(false);
  const setIsUserSpeaking = useCallback((speaking: boolean) => {
    isUserSpeakingRef.current = speaking;
    _setIsUserSpeaking(speaking);
  }, []);

  const [latencyMs, setLatencyMs] = useState<number>(380);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  // Reactive Web Audio nodes (ADR-005) - managed in useState so useClientVAD and AudioVisualizer re-render
  const [assistantGainNode, _setAssistantGainNode] = useState<GainNode | null>(null);
  const assistantGainNodeRef = useRef<GainNode | null>(null);
  const setAssistantGainNode = useCallback((node: GainNode | null) => {
    assistantGainNodeRef.current = node;
    _setAssistantGainNode(node);
  }, []);

  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const roomRef = useRef<Room | null>(null);
  const sessionGenerationRef = useRef<number>(0);
  const connectInFlightRef = useRef<number | null>(null);
  const intentionalDisconnectRef = useRef<boolean>(false);
  const [micStream, _setMicStream] = useState<MediaStream | null>(null);
  const setMicStream = useCallback((stream: MediaStream | null) => {
    _setMicStream(stream);
  }, []);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const assistantAudioElementRef = useRef<HTMLMediaElement | null>(null);
  const assistantSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const assistantTrackRef = useRef<Track | null>(null);
  const hasAssistantAudioRef = useRef<boolean>(false);
  const playbackRetryPendingRef = useRef<boolean>(false);

  const sendDataMessage = useCallback((data: Record<string, any>) => {
    if (roomRef.current && roomRef.current.state === "connected") {
      const payload = new TextEncoder().encode(JSON.stringify(data));
      roomRef.current.localParticipant.publishData(payload, { reliable: true });
    }
  }, []);

  const activateAssistantAudio = useCallback(async (): Promise<boolean> => {
    const activationGeneration = sessionGenerationRef.current;
    const gainNode = assistantGainNodeRef.current;
    const audioElement = assistantAudioElementRef.current;
    const audioContext = audioCtxRef.current;
    if (!gainNode || !audioElement || !audioContext || isUserSpeakingRef.current) {
      return false;
    }

    const activated = await activateAudioPlayback(audioContext, audioElement);
    if (
      !isCurrentSessionGeneration(activationGeneration, sessionGenerationRef.current) ||
      assistantAudioElementRef.current !== audioElement
    ) {
      return false;
    }
    playbackRetryPendingRef.current = !activated;

    if (activated) {
      try {
        gainNode.gain.cancelScheduledValues(gainNode.context.currentTime);
        gainNode.gain.setValueAtTime(1.0, gainNode.context.currentTime);
        gainNode.gain.value = 1.0;
      } catch {
        gainNode.gain.value = 1.0;
      }
      setConnectionStatus(getLiveKitConnectionStatus("audio_ready", true));
    } else if (hasAssistantAudioRef.current) {
      setConnectionStatus(getLiveKitConnectionStatus("audio_blocked", true));
    }

    return activated;
  }, []);

  const unmuteAssistant = useCallback(() => {
    // Guard: Never unmute assistant audio while user is actively speaking
    if (isUserSpeakingRef.current) {
      return;
    }
    if (assistantGainNodeRef.current) {
      const node = assistantGainNodeRef.current;
      const ctx = node.context;
      try {
        if (ctx) {
          if (ctx.state === "suspended" && typeof (ctx as any).resume === "function") {
            (ctx as any).resume().catch(console.warn);
          }
          if (typeof node.gain.cancelScheduledValues === "function") {
            node.gain.cancelScheduledValues(ctx.currentTime);
          }
          if (ctx.state === "running") {
            node.gain.setValueAtTime(1.0, ctx.currentTime);
          }
        }
        node.gain.value = 1.0;
      } catch {
        node.gain.value = 1.0;
      }
    }
    if (assistantAudioElementRef.current) {
      void activateAssistantAudio();
    }
  }, [activateAssistantAudio]);

  const handleSpeechStart = useCallback(() => {
    setIsUserSpeaking(true);
  }, [setIsUserSpeaking]);

  const handleSpeechEnd = useCallback(() => {
    setIsUserSpeaking(false);
    unmuteAssistant();

    // Reconcile bot speaking state: if the remote agent is currently speaking
    // when user speech ends, immediately update isBotSpeaking so interruption remains active
    if (roomRef.current && Array.isArray(roomRef.current.activeSpeakers)) {
      const isAgentSpeaking = roomRef.current.activeSpeakers.some((p) => !p.isLocal);
      if (isAgentSpeaking) {
        setIsBotSpeaking(true);
      }
    }
  }, [setIsUserSpeaking, unmuteAssistant, setIsBotSpeaking]);

  const handleInterruption = useCallback(() => {
    // R2: Guard Against Premature Interruption Cancellation Loops
    // ONLY publish response.cancel over DataChannel if assistant is currently speaking.
    // Do not send cancel signals when user is speaking their prompt to the assistant.
    if (!isBotSpeakingRef.current) {
      return;
    }

    // 1. Send immediate cancellation signal across DataChannel to agent
    sendDataMessage({ type: "response.cancel" });

    // 2. Mark current speaking assistant message as interrupted
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === "assistant" && !last.isInterrupted) {
        return [...prev.slice(0, -1), { ...last, isInterrupted: true }];
      }
      return prev;
    });
    setIsBotSpeaking(false);
  }, [sendDataMessage, setIsBotSpeaking]);

  // Browsers may reject the first remote-audio play() after an asynchronous room
  // connection. Retry only when a later trusted user gesture makes playback legal.
  useEffect(() => {
    const retryPlayback = () => {
      if (playbackRetryPendingRef.current && !isUserSpeakingRef.current) {
        void activateAssistantAudio();
      }
    };

    window.addEventListener("pointerdown", retryPlayback, true);
    window.addEventListener("keydown", retryPlayback, true);
    window.addEventListener("focus", retryPlayback);
    return () => {
      window.removeEventListener("pointerdown", retryPlayback, true);
      window.removeEventListener("keydown", retryPlayback, true);
      window.removeEventListener("focus", retryPlayback);
    };
  }, [activateAssistantAudio]);

  const resetMediaState = useCallback(() => {
    assistantAudioElementRef.current?.pause();
    assistantAudioElementRef.current = null;
    assistantSourceNodeRef.current?.disconnect();
    assistantSourceNodeRef.current = null;
    assistantTrackRef.current = null;
    hasAssistantAudioRef.current = false;
    playbackRetryPendingRef.current = false;
    setMicStream(null);
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(console.error);
    }
    audioCtxRef.current = null;
    setAssistantGainNode(null);
    setAnalyserNode(null);
    setIsBotSpeaking(false);
    setIsUserSpeaking(false);
    setIsMuted(false);
  }, [setAssistantGainNode, setIsBotSpeaking, setIsUserSpeaking, setMicStream]);

  const connect = useCallback(async () => {
    if (connectInFlightRef.current !== null || roomRef.current) {
      return;
    }

    const sessionGeneration = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = sessionGeneration;
    connectInFlightRef.current = sessionGeneration;
    intentionalDisconnectRef.current = false;
    const isCurrentSession = (room?: Room) =>
      isCurrentSessionGeneration(sessionGeneration, sessionGenerationRef.current) &&
      (!room || roomRef.current === room);
    try {
      setConnectionStatus("connecting");

      // 1. Fetch access token from Next.js route
      const res = await fetch("/api/livekit-token");
      if (!res.ok) {
        throw new Error("Failed to fetch LiveKit token. Check .env credentials.");
      }
      const { token, wsUrl } = await res.json();
      if (!isCurrentSession()) {
        return;
      }

      // 2. Instantiate Room with adaptive streaming
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      room.on(RoomEvent.Reconnecting, () => {
        if (!isCurrentSession(room)) return;
        setConnectionStatus(getLiveKitConnectionStatus("reconnecting"));
      });

      room.on(RoomEvent.Reconnected, () => {
        if (!isCurrentSession(room)) return;
        setConnectionStatus(
          getLiveKitConnectionStatus(
            "reconnected",
            hasAssistantAudioRef.current,
            playbackRetryPendingRef.current,
          ),
        );
        if (playbackRetryPendingRef.current) {
          void activateAssistantAudio();
        }
      });

      room.on(RoomEvent.Disconnected, () => {
        if (!isCurrentSession(room)) return;
        sessionGenerationRef.current += 1;
        connectInFlightRef.current = null;
        roomRef.current = null;
        resetMediaState();
        setConnectionStatus(
          intentionalDisconnectRef.current
            ? getLiveKitConnectionStatus("disconnected")
            : getLiveKitConnectionStatus("connection_error"),
        );
      });

      // 3. Handle DataChannel Messages
      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        if (!isCurrentSession(room)) return;
        try {
          const str = new TextDecoder().decode(payload);
          const event = JSON.parse(str);

          if (event.type === "transcript") {
            setMessages((prev) => [
              ...prev,
              {
                id: event.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                speaker: event.speaker || "assistant",
                text: event.text || "",
                isInterrupted: event.isInterrupted || false,
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              },
            ]);
          } else if (event.type === "task_update" && event.task) {
            const rawTask = event.task;
            const normalizedTask: TaskItem = {
              id: rawTask.id || `task_${Date.now()}`,
              title: rawTask.title || "Voice Action",
              toolName: rawTask.tool_name || rawTask.toolName || "tool",
              status: rawTask.status || "completed",
              output: rawTask.output || null,
              errorMessage: rawTask.errorMessage || rawTask.error_message || null,
              executionTimeMs: rawTask.executionTimeMs || rawTask.execution_time_ms || 0,
              idempotencyKey: rawTask.idempotencyKey || rawTask.idempotency_key || null,
              updatedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            };

            setTasks((prev) => {
              const existingIdx = prev.findIndex((t) => t.id === normalizedTask.id);
              if (existingIdx >= 0) {
                const copy = [...prev];
                copy[existingIdx] = normalizedTask;
                return copy;
              }
              return [normalizedTask, ...prev];
            });
          }
        } catch (e) {
          console.error("Failed to parse LiveKit DataPacket:", e);
        }
      });

      // 4. Handle Incoming Audio Track (Agent's Voice)
      room.on(RoomEvent.TrackSubscribed, async (track: Track) => {
        if (!isCurrentSession(room)) return;
        if (track.kind === Track.Kind.Audio) {
          const audioElement = track.attach();
          audioElement.autoplay = true;
          const previousAudioElement = assistantAudioElementRef.current;
          if (previousAudioElement && previousAudioElement !== audioElement) {
            previousAudioElement.pause();
          }
          assistantAudioElementRef.current = audioElement;
          assistantTrackRef.current = track;
          hasAssistantAudioRef.current = true;

          // Initialize Web Audio API graph
          let audioCtx = audioCtxRef.current;
          if (!audioCtx || audioCtx.state === "closed") {
            audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioCtxRef.current = audioCtx;
          }
          if (audioCtx.state === "suspended") {
            try {
              await audioCtx.resume();
            } catch (err) {
              console.warn("AudioContext resume deferred until user gesture:", err);
            }
          }
          if (!isCurrentSession(room) || assistantTrackRef.current !== track) {
            audioElement.pause();
            track.detach(audioElement);
            return;
          }

          let source = assistantSourceNodeRef.current;
          if (!source || previousAudioElement !== audioElement) {
            source?.disconnect();
            source = audioCtx.createMediaElementSource(audioElement);
            assistantSourceNodeRef.current = source;
          }
          const gainNode = audioCtx.createGain();
          const analyser = audioCtx.createAnalyser();

          // R1: Ensure assistantGainNode.gain is verified and cleanly unmuted to 1.0
          try {
            if (typeof gainNode.gain.cancelScheduledValues === "function") {
              gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
            }
            if (audioCtx.state === "running") {
              gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
            }
            gainNode.gain.value = 1.0;
          } catch {
            gainNode.gain.value = 1.0;
          }

          // Restore gain back to 1.0 whenever playback resumes on incoming track
          audioElement.onplay = () => {
            if (!isCurrentSession(room) || assistantTrackRef.current !== track) {
              return;
            }
            // Guard: Never unmute assistant audio while user is actively speaking/interrupting
            if (isUserSpeakingRef.current) {
              return;
            }
            const ctx = gainNode.context;
            try {
              if (ctx) {
                if (ctx.state === "suspended" && typeof (ctx as any).resume === "function") {
                  (ctx as any).resume().catch(console.warn);
                }
                if (typeof gainNode.gain.cancelScheduledValues === "function") {
                  gainNode.gain.cancelScheduledValues(ctx.currentTime);
                }
                if (ctx.state === "running") {
                  gainNode.gain.setValueAtTime(1.0, ctx.currentTime);
                }
              }
              gainNode.gain.value = 1.0;
            } catch {
              gainNode.gain.value = 1.0;
            }
            // NOTE: Do not set isBotSpeaking(true) here! Playing a remote WebRTC
            // stream starts immediately upon attachment and plays silence between turns.
            // Active speech is detected strictly via RoomEvent.ActiveSpeakersChanged.
          };

          audioElement.onpause = () => {
            if (!isCurrentSession(room) || assistantTrackRef.current !== track) return;
            setIsBotSpeaking(false);
          };

          audioElement.onended = () => {
            if (!isCurrentSession(room) || assistantTrackRef.current !== track) return;
            setIsBotSpeaking(false);
          };

          analyser.fftSize = 128;
          source.connect(gainNode);
          gainNode.connect(analyser);
          analyser.connect(audioCtx.destination);

          // Update React state so useClientVAD and AudioVisualizer receive active nodes
          setAssistantGainNode(gainNode);
          setAnalyserNode(analyser);

          const activated = await activateAssistantAudio();
          if (!isCurrentSession(room) || assistantTrackRef.current !== track) {
            return;
          }
          if (!activated) {
            console.warn(
              "Assistant audio is ready but browser playback is blocked. Waiting for a user gesture to retry.",
            );
          }
          // Initial track subscription is silent; isBotSpeaking remains false
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track: Track) => {
        if (!isCurrentSession(room)) return;
        if (track.kind === Track.Kind.Audio) {
          track.detach();
          if (assistantTrackRef.current !== track) {
            return;
          }
          assistantAudioElementRef.current?.pause();
          assistantAudioElementRef.current = null;
          assistantSourceNodeRef.current?.disconnect();
          assistantSourceNodeRef.current = null;
          assistantTrackRef.current = null;
          hasAssistantAudioRef.current = false;
          playbackRetryPendingRef.current = false;
          setIsBotSpeaking(false);
          setAssistantGainNode(null);
          setAnalyserNode(null);
          if (roomRef.current?.state === "connected") {
            setConnectionStatus(getLiveKitConnectionStatus("agent_unavailable"));
          }
        }
      });

      // R1/R2: Active speaker tracking to accurately detect bot speaking state and restore gain
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        if (!isCurrentSession(room)) return;
        const isAgentSpeaking = speakers.some((p) => !p.isLocal);

        // Guard against residual SFU packets during user interruption:
        // If the user is currently speaking, do not resurrect isBotSpeaking or unmute gain!
        if (isUserSpeakingRef.current) {
          return;
        }

        setIsBotSpeaking(isAgentSpeaking);

        if (isAgentSpeaking && assistantGainNodeRef.current) {
          const node = assistantGainNodeRef.current;
          const ctx = node.context;
          try {
            if (ctx) {
              if (ctx.state === "suspended" && typeof (ctx as any).resume === "function") {
                (ctx as any).resume().catch(console.warn);
              }
              if (typeof node.gain.cancelScheduledValues === "function") {
                node.gain.cancelScheduledValues(ctx.currentTime);
              }
              if (ctx.state === "running") {
                node.gain.setValueAtTime(1.0, ctx.currentTime);
              }
            }
            node.gain.value = 1.0;
          } catch {
            node.gain.value = 1.0;
          }
        }

        if (isAgentSpeaking && playbackRetryPendingRef.current) {
          void activateAssistantAudio();
        }
      });

      // 5. Connect to LiveKit SFU Room
      await room.connect(wsUrl, token);
      if (!isCurrentSession(room)) {
        room.disconnect();
        return;
      }

      if (!hasAssistantAudioRef.current) {
        setConnectionStatus(getLiveKitConnectionStatus("room_connected"));
      }

      // 6. Capture and publish one LiveKit-owned microphone track, then reuse that
      // same track for local VAD. This avoids competing duplicate microphone streams.
      const microphonePublication = await room.localParticipant.setMicrophoneEnabled(true);
      if (!isCurrentSession(room)) {
        room.disconnect();
        return;
      }
      const microphoneTrack = microphonePublication?.track?.mediaStreamTrack;
      if (!microphoneTrack) {
        throw new Error("LiveKit connected but did not publish a microphone track.");
      }
      setMicStream(new MediaStream([microphoneTrack]));

    } catch (err) {
      if (!isCurrentSessionGeneration(sessionGeneration, sessionGenerationRef.current)) {
        return;
      }
      console.error("LiveKit room connection error:", err);
      const failedRoom = roomRef.current;
      roomRef.current = null;
      intentionalDisconnectRef.current = true;
      connectInFlightRef.current = null;
      sessionGenerationRef.current += 1;
      resetMediaState();
      failedRoom?.disconnect();
      setConnectionStatus(getLiveKitConnectionStatus("connection_error"));
    } finally {
      if (connectInFlightRef.current === sessionGeneration) {
        connectInFlightRef.current = null;
      }
    }
  }, [activateAssistantAudio, resetMediaState, setIsBotSpeaking, setAssistantGainNode, setMicStream]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    sessionGenerationRef.current += 1;
    connectInFlightRef.current = null;
    const room = roomRef.current;
    roomRef.current = null;
    room?.disconnect();
    resetMediaState();
    setConnectionStatus(getLiveKitConnectionStatus("disconnected"));
  }, [resetMediaState]);

  // Clean up media streams, Web Audio contexts, and room connections on component unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const toggleMute = useCallback(() => {
    if (roomRef.current) {
      const nextMuted = !isMuted;
      roomRef.current.localParticipant.setMicrophoneEnabled(!nextMuted);
      setIsMuted(nextMuted);
    }
  }, [isMuted]);

  return {
    connectionStatus,
    isMuted,
    isHandsFree,
    isBotSpeaking,
    isUserSpeaking,
    latencyMs,
    messages,
    tasks,
    analyserNode,
    assistantGainNode,
    micStream,
    connect,
    disconnect,
    toggleMute,
    toggleHandsFree: () => setIsHandsFree((h) => !h),
    handleInterruption,
    handleSpeechStart,
    handleSpeechEnd,
    unmuteAssistant,
  };
};
