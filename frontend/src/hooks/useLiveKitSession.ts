"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Room, RoomEvent, Track, RemoteTrackPublication, RemoteParticipant } from "livekit-client";
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

  const roomRef = useRef<Room | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const assistantGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const sendDataMessage = useCallback((data: Record<string, any>) => {
    if (roomRef.current && roomRef.current.state === "connected") {
      const payload = new TextEncoder().encode(JSON.stringify(data));
      roomRef.current.localParticipant.publishData(payload, { reliable: true });
    }
  }, []);

  const handleInterruption = useCallback(() => {
    // Send immediate cancellation to voice server
    sendDataMessage({ type: "response.cancel" });

    // Mark current speaking assistant message as interrupted
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

      // 2. Instantiate Room
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;

      // Handle Data Channel Messages
      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const str = new TextDecoder().decode(payload);
          const event = JSON.parse(str);

          if (event.type === "transcript") {
            setMessages((prev) => [
              ...prev,
              {
                id: `msg_${Date.now()}`,
                speaker: event.speaker,
                text: event.text,
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              },
            ]);
          } else if (event.type === "task_update") {
            setTasks((prev) => {
              const existingIdx = prev.findIndex((t) => t.id === event.task.id);
              if (existingIdx >= 0) {
                const copy = [...prev];
                copy[existingIdx] = event.task;
                return copy;
              }
              return [event.task, ...prev];
            });
          }
        } catch (e) {
          console.error("Failed to parse LiveKit data message", e);
        }
      });

      // Handle Incoming Audio Track (Bot's Voice)
      room.on(RoomEvent.TrackSubscribed, (track: Track) => {
        if (track.kind === Track.Kind.Audio) {
          const audioElement = track.attach();
          audioElement.play().catch(console.error);

          // Connect Web Audio API gain & analyser
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const source = audioCtx.createMediaElementSource(audioElement);
          const gainNode = audioCtx.createGain();
          const analyser = audioCtx.createAnalyser();

          analyser.fftSize = 128;
          source.connect(gainNode);
          gainNode.connect(analyser);
          analyser.connect(audioCtx.destination);

          assistantGainRef.current = gainNode;
          analyserRef.current = analyser;

          setIsBotSpeaking(true);
        }
      });

      // Connect to LiveKit Room
      await room.connect(wsUrl, token);

      // Publish Local Microphone
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = localStream;
      await room.localParticipant.setMicrophoneEnabled(true);

      setConnectionStatus("connected");
    } catch (err) {
      console.error("LiveKit connection error:", err);
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
    setConnectionStatus("disconnected");
    setIsBotSpeaking(false);
    setIsUserSpeaking(false);
  }, []);

  const toggleMute = useCallback(() => {
    if (roomRef.current) {
      const current = !isMuted;
      roomRef.current.localParticipant.setMicrophoneEnabled(!current);
      setIsMuted(current);
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
    analyserNode: analyserRef.current,
    assistantGainNode: assistantGainRef.current,
    micStream: micStreamRef.current,
    connect,
    disconnect,
    toggleMute,
    toggleHandsFree: () => setIsHandsFree((h) => !h),
    handleInterruption,
  };
};
