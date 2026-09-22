"use client";

import { useEffect, useRef, useCallback } from "react";
import { logSafeFailure } from "@/lib/safeLogging";

interface UseClientVADOptions {
  micStream: MediaStream | null;
  assistantGainNode: GainNode | null;
  isBotSpeaking?: boolean;
  onInterruption: () => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
}

/**
 * useClientVAD
 * Implements ADR-005: Client-side AudioWorklet VAD that mutes speaker playback buffer in <20ms
 * upon detecting user voice energy, and sends an interruption cancellation signal to the server.
 * Guarded against premature interruption loops (R2) and permanent gain muting (R1).
 */
export const useClientVAD = ({
  micStream,
  assistantGainNode,
  isBotSpeaking = false,
  onInterruption,
  onSpeechStart,
  onSpeechEnd,
}: UseClientVADOptions) => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  const assistantGainNodeRef = useRef<GainNode | null>(assistantGainNode);
  assistantGainNodeRef.current = assistantGainNode;

  const isBotSpeakingRef = useRef<boolean>(!!isBotSpeaking);
  isBotSpeakingRef.current = !!isBotSpeaking;

  const onInterruptionRef = useRef(onInterruption);
  onInterruptionRef.current = onInterruption;

  const onSpeechStartRef = useRef(onSpeechStart);
  onSpeechStartRef.current = onSpeechStart;

  const onSpeechEndRef = useRef(onSpeechEnd);
  onSpeechEndRef.current = onSpeechEnd;

  useEffect(() => {
    let isCancelled = false;

    if (!micStream) {
      return;
    }

    const initVAD = async () => {
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
          latencyHint: "interactive",
        });
        audioContextRef.current = audioCtx;

        if (audioCtx.state === "suspended") {
          try {
            await audioCtx.resume();
          } catch (err) {
            logSafeFailure("AudioContext resume deferred in useClientVAD", err, "warn");
          }
        }

        // Register the zero-latency VAD processor AudioWorklet
        await audioCtx.audioWorklet.addModule("/worklets/vad-processor.js");

        if (isCancelled || audioCtx.state === "closed") {
          return;
        }

        const sourceNode = audioCtx.createMediaStreamSource(micStream);
        const vadNode = new AudioWorkletNode(audioCtx, "vad-processor");
        workletNodeRef.current = vadNode;

        vadNode.port.onmessage = (event) => {
          const { type } = event.data;

          if (type === "speech_start") {
            if (onSpeechStartRef.current) {
              onSpeechStartRef.current();
            }

            // R2: Guard Against Premature Interruption Cancellation Loops
            // ONLY drop gain to 0.0 and publish cancellation if the assistant is currently speaking.
            // Do not send cancel signals when the user is speaking their prompt to the assistant.
            if (isBotSpeakingRef.current) {
              // Instant interruption muting (<20ms)
              const gainNode = assistantGainNodeRef.current;
              if (gainNode) {
                try {
                  const gainCtx = gainNode.context;
                  if (gainCtx) {
                    if (typeof gainNode.gain.cancelScheduledValues === "function") {
                      gainNode.gain.cancelScheduledValues(gainCtx.currentTime);
                    }
                    if (gainCtx.state === "running") {
                      gainNode.gain.setValueAtTime(0.0, gainCtx.currentTime);
                    }
                  }
                  gainNode.gain.value = 0.0;
                } catch {
                  gainNode.gain.value = 0.0;
                }
              }
              onInterruptionRef.current();
            }
          } else if (type === "speech_end") {
            // R1: Cleanly unmute and restore gain back to 1.0 when user speech ends
            const gainNode = assistantGainNodeRef.current;
            if (gainNode) {
              try {
                const gainCtx = gainNode.context;
                if (gainCtx) {
                  if (gainCtx.state === "suspended" && typeof (gainCtx as any).resume === "function") {
                    (gainCtx as any).resume().catch((error: unknown) => logSafeFailure("AudioContext resume failed", error, "warn"));
                  }
                  if (typeof gainNode.gain.cancelScheduledValues === "function") {
                    gainNode.gain.cancelScheduledValues(gainCtx.currentTime);
                  }
                  if (gainCtx.state === "running") {
                    gainNode.gain.setValueAtTime(1.0, gainCtx.currentTime);
                  }
                }
                gainNode.gain.value = 1.0;
              } catch {
                gainNode.gain.value = 1.0;
              }
            }

            if (onSpeechEndRef.current) {
              onSpeechEndRef.current();
            }
          }
        };

        // Ensure worklet processing is actively pulled by the audio destination
        // using a zero-gain node so no microphone loopback is heard by the user
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0.0;
        sourceNode.connect(vadNode);
        vadNode.connect(silentGain);
        silentGain.connect(audioCtx.destination);
      } catch (err) {
        logSafeFailure("Client-side AudioWorklet VAD initialization unavailable", err, "warn");
      }
    };

    initVAD();

    return () => {
      isCancelled = true;
      if (workletNodeRef.current) {
        try {
          workletNodeRef.current.disconnect();
        } catch {
          // ignore disconnect error
        }
        workletNodeRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch((error) => logSafeFailure("AudioContext cleanup failed", error, "warn"));
        audioContextRef.current = null;
      }
    };
  }, [micStream]);
};
