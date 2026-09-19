"use client";

import { useState, useCallback, useRef } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import { ConnectionStatus, TranscriptMessage, TaskItem } from "@/lib/types";

export const useLiveKitSession = () => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isHandsFree, setIsHandsFree] = useState<boolean>(true);
  const [isBotSpeaking, setIsBotSpeaking] = useState<boolean>(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState<boolean>(false);
  const [latencyMs, setLatencyMs] = useState<number>(380);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);

  // Reactive Web Audio nodes (ADR-005) - managed in useState so useClientVAD and AudioVisualizer re-render
  const [assistantGainNode, setAssistantGainNode] = useState<GainNode | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const roomRef = useRef<Room | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const sendDataMessage = useCallback((data: Record<string, any>) => {
    if (roomRef.current && roomRef.current.state === "connected") {
      const payload = new TextEncoder().encode(JSON.stringify(data));
      roomRef.current.localParticipant.publishData(payload, { reliable: true });
    }
  }, []);

  const handleInterruption = useCallback(() => {
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
  }, [sendDataMessage]);

  const connect = useCallback(async () => {
    try {
      setConnectionStatus("connecting");

      // 1. Fetch access token from Next.js route
      const res = await fetch("/api/livekit-token");
      if (!res.ok) {
        throw new Error("Failed to fetch LiveKit token. Check .env credentials.");
      }
      const { token, wsUrl } = await res.json();

      // 2. Instantiate Room with adaptive streaming
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      // 3. Handle DataChannel Messages
      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
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
        if (track.kind === Track.Kind.Audio) {
          const audioElement = track.attach();
          try {
            await audioElement.play();
          } catch (e) {
            console.warn("Audio element play error:", e);
          }

          // Initialize Web Audio API graph
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          audioCtxRef.current = audioCtx;
          if (audioCtx.state === "suspended") {
            await audioCtx.resume();
          }

          const source = audioCtx.createMediaElementSource(audioElement);
          const gainNode = audioCtx.createGain();
          const analyser = audioCtx.createAnalyser();

          analyser.fftSize = 128;
          source.connect(gainNode);
          gainNode.connect(analyser);
          analyser.connect(audioCtx.destination);

          // Update React state so useClientVAD and AudioVisualizer receive active nodes
          setAssistantGainNode(gainNode);
          setAnalyserNode(analyser);
          setIsBotSpeaking(true);
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track: Track) => {
        if (track.kind === Track.Kind.Audio) {
          track.detach();
          setIsBotSpeaking(false);
        }
      });

      // 5. Connect to LiveKit SFU Room
      await room.connect(wsUrl, token);

      // 6. Capture and Publish Local Microphone
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = localStream;
      await room.localParticipant.setMicrophoneEnabled(true);

      setConnectionStatus("connected");
    } catch (err) {
      console.error("LiveKit room connection error:", err);
      setConnectionStatus("error");
    }
  }, []);

  const disconnect = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(console.error);
      audioCtxRef.current = null;
    }
    setAssistantGainNode(null);
    setAnalyserNode(null);
    setConnectionStatus("disconnected");
    setIsBotSpeaking(false);
    setIsUserSpeaking(false);
  }, []);

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
    micStream: micStreamRef.current,
    connect,
    disconnect,
    toggleMute,
    toggleHandsFree: () => setIsHandsFree((h) => !h),
    handleInterruption,
  };
};
