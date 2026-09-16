"use client";

import { useEffect, useRef, useCallback } from "react";

interface UseClientVADOptions {
  micStream: MediaStream | null;
  assistantGainNode: GainNode | null;
  onInterruption: () => void;
  onSpeechEnd?: () => void;
}

/**
 * useClientVAD
 * Implements ADR-005: Client-side AudioWorklet VAD that mutes speaker playback buffer in <20ms
 * upon detecting user voice energy, and sends an interruption cancellation signal to the server.
 */
export const useClientVAD = ({
  micStream,
  assistantGainNode,
  onInterruption,
  onSpeechEnd,
}: UseClientVADOptions) => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  const setupVAD = useCallback(async () => {
    if (!micStream) return;

    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
        latencyHint: "interactive",
      });
      audioContextRef.current = audioCtx;

      // Register the zero-latency VAD processor AudioWorklet
      await audioCtx.audioWorklet.addModule("/worklets/vad-processor.js");

      const sourceNode = audioCtx.createMediaStreamSource(micStream);
      const vadNode = new AudioWorkletNode(audioCtx, "vad-processor");
      workletNodeRef.current = vadNode;

      vadNode.port.onmessage = (event) => {
        const { type } = event.data;

        if (type === "speech_start") {
          // Instant interruption muting (<20ms)
          if (assistantGainNode && audioCtx.state === "running") {
            assistantGainNode.gain.setValueAtTime(0.0, audioCtx.currentTime);
          }
          onInterruption();
        } else if (type === "speech_end") {
          if (onSpeechEnd) onSpeechEnd();
        }
      };

      sourceNode.connect(vadNode);
      // vadNode does not connect to destination to avoid self-monitoring feedback
    } catch (err) {
      console.warn("Client-side AudioWorklet VAD initialization bypassed or unsupported:", err);
    }
  }, [micStream, assistantGainNode, onInterruption, onSpeechEnd]);

  useEffect(() => {
    if (micStream) {
      setupVAD();
    }

    return () => {
      if (workletNodeRef.current) {
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close();
      }
    };
  }, [micStream, setupVAD]);
};
