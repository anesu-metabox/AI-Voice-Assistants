"use client";

import { useEffect, useRef, useCallback } from "react";
import { logSafeFailure } from "@/lib/safeLogging";

export const BACKCHANNEL_INTERRUPTION_THRESHOLD_MS = 320;

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
 * Upgraded with Requirement R2 & R3: 320ms Tentative Barge-In Window for Backchannel Immunity
 * ("mhm", "yeah" do not mute or cancel speech) and permanent gain muting prevention (R1).
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

  const interruptionTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearInterruptionTimer = useCallback(() => {
    if (interruptionTimerRef.current) {
      clearTimeout(interruptionTimerRef.current);
      interruptionTimerRef.current = null;
    }
  }, []);

  const muteAssistantGain = useCallback(() => {
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
  }, []);

  const unmuteAssistantGain = useCallback(() => {
    const gainNode = assistantGainNodeRef.current;
    if (gainNode) {
      try {
        const gainCtx = gainNode.context;
        if (gainCtx) {
          if (gainCtx.state === "suspended" && typeof (gainCtx as any).resume === "function") {
            (gainCtx as any).resume().catch((error: unknown) =>
              logSafeFailure("AudioContext resume failed", error, "warn")
            );
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
  }, []);

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

            // R3: Backchannel Immunity Guard
            // If the bot is speaking, do NOT immediately mute or publish cancellation.
            // Wait for 320ms. If user stops speaking before 320ms, it is an immune backchannel ("mhm", "yeah").
            if (isBotSpeakingRef.current) {
              clearInterruptionTimer();
              interruptionTimerRef.current = setTimeout(() => {
                interruptionTimerRef.current = null;
                // Speech sustained past 320ms: confirmed intentional barge-in!
                muteAssistantGain();
                onInterruptionRef.current();
              }, BACKCHANNEL_INTERRUPTION_THRESHOLD_MS);
            }
          } else if (type === "speech_end") {
            // Speech ended: check if this was a short backchannel during bot speech
            if (interruptionTimerRef.current) {
              // User spoke < 320ms while bot spoke (backchannel)
              clearInterruptionTimer();
              // assistantGainNode was NEVER muted and cancel was NEVER sent!
            } else {
              // True speech end or after barge-in: restore gain to 1.0 cleanly (R1)
              unmuteAssistantGain();
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
      clearInterruptionTimer();
      if (workletNodeRef.current) {
        try {
          workletNodeRef.current.disconnect();
        } catch {
          // ignore disconnect error
        }
        workletNodeRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch((error) =>
          logSafeFailure("AudioContext cleanup failed", error, "warn")
        );
        audioContextRef.current = null;
      }
    };
  }, [micStream, clearInterruptionTimer, muteAssistantGain, unmuteAssistantGain]);
};
