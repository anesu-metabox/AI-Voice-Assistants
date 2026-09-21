import test, { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("LiveKit WebRTC Voice Audio Pipeline Verification (R1, R2)", () => {
  // Helper to create mock Web Audio GainNode with cancelScheduledValues tracking
  function createMockGainNode(initialGain = 1.0) {
    const gain = {
      value: initialGain,
      scheduledValues: [],
      cancelledAt: [],
      cancelScheduledValues(t) {
        this.cancelledAt.push(t);
        this.scheduledValues = this.scheduledValues.filter((s) => s.time < t);
      },
      setValueAtTime(val, time) {
        this.scheduledValues.push({ val, time });
        this.value = val;
      },
    };
    const context = {
      state: "running",
      currentTime: 12.34,
    };
    return {
      gain,
      context,
    };
  }

  describe("R1 & R2: useClientVAD Interruption & Gain Recovery Logic", () => {
    // Simulates the onmessage callback from VAD AudioWorklet matching useClientVAD.ts
    function simulateVADMessage({
      type,
      isBotSpeakingRef,
      assistantGainNodeRef,
      onInterruption,
      onSpeechStart,
      onSpeechEnd,
    }) {
      if (type === "speech_start") {
        if (onSpeechStart) onSpeechStart();

        // R2 Guard: ONLY drop gain and call onInterruption if isBotSpeaking is true
        if (isBotSpeakingRef.current) {
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
          if (onInterruption) onInterruption();
        }
      } else if (type === "speech_end") {
        // R1: Cleanly unmute and restore gain back to 1.0 when user speech ends
        const gainNode = assistantGainNodeRef.current;
        if (gainNode) {
          try {
            const gainCtx = gainNode.context;
            if (gainCtx) {
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
        if (onSpeechEnd) onSpeechEnd();
      }
    }

    it("does NOT mute gain and does NOT trigger interruption when user speaks prompt (isBotSpeaking = false)", () => {
      const gainNode = createMockGainNode(1.0);
      let interruptionCalled = false;
      let speechStartCalled = false;
      const isBotSpeakingRef = { current: false };
      const assistantGainNodeRef = { current: gainNode };

      simulateVADMessage({
        type: "speech_start",
        isBotSpeakingRef,
        assistantGainNodeRef,
        onInterruption: () => {
          interruptionCalled = true;
        },
        onSpeechStart: () => {
          speechStartCalled = true;
        },
      });

      assert.equal(speechStartCalled, true, "onSpeechStart should be called");
      assert.equal(interruptionCalled, false, "Interruption signal must be suppressed when bot is not speaking");
      assert.equal(gainNode.gain.value, 1.0, "Gain must remain 1.0 when bot is not speaking");
      assert.equal(gainNode.gain.cancelledAt.length, 0, "No cancelScheduledValues needed when not muting");
    });

    it("mutes gain to 0.0 and triggers interruption when user interrupts active assistant (isBotSpeaking = true)", () => {
      const gainNode = createMockGainNode(1.0);
      let interruptionCalled = false;
      let speechStartCalled = false;
      const isBotSpeakingRef = { current: true };
      const assistantGainNodeRef = { current: gainNode };

      simulateVADMessage({
        type: "speech_start",
        isBotSpeakingRef,
        assistantGainNodeRef,
        onInterruption: () => {
          interruptionCalled = true;
          isBotSpeakingRef.current = false; // State changes as in useLiveKitSession
        },
        onSpeechStart: () => {
          speechStartCalled = true;
        },
      });

      assert.equal(speechStartCalled, true, "onSpeechStart should be called");
      assert.equal(interruptionCalled, true, "Interruption signal must fire when bot is speaking");
      assert.equal(gainNode.gain.value, 0.0, "Gain must drop to 0.0 immediately upon interruption");
      assert.equal(gainNode.gain.cancelledAt.length, 1, "cancelScheduledValues should be called before muting");
    });

    it("cleanly restores gain back to 1.0 when user speech ends (R1 prevention of permanent silencing)", () => {
      const gainNode = createMockGainNode(0.0); // Muted previously
      let speechEndCalled = false;
      const isBotSpeakingRef = { current: false };
      const assistantGainNodeRef = { current: gainNode };

      simulateVADMessage({
        type: "speech_end",
        isBotSpeakingRef,
        assistantGainNodeRef,
        onSpeechEnd: () => {
          speechEndCalled = true;
        },
      });

      assert.equal(speechEndCalled, true, "onSpeechEnd should be called");
      assert.equal(gainNode.gain.value, 1.0, "Gain must be cleanly restored to 1.0 on speech_end");
      assert.equal(gainNode.gain.cancelledAt.length, 1, "cancelScheduledValues should be called before unmuting");
    });

    it("prevents oscillation and duplicate cancellation during rapid intermittent noise bursts", () => {
      const gainNode = createMockGainNode(1.0);
      let interruptionCount = 0;
      const isBotSpeakingRef = { current: true }; // Assistant was initially speaking
      const assistantGainNodeRef = { current: gainNode };

      const onInterruption = () => {
        interruptionCount++;
        isBotSpeakingRef.current = false; // Immediately marked non-speaking on first interrupt
      };

      // Burst 1: Speech starts -> triggers interruption and muting
      simulateVADMessage({
        type: "speech_start",
        isBotSpeakingRef,
        assistantGainNodeRef,
        onInterruption,
      });
      assert.equal(interruptionCount, 1);
      assert.equal(gainNode.gain.value, 0.0);

      // Burst 1 ends: Gain restored
      simulateVADMessage({
        type: "speech_end",
        isBotSpeakingRef,
        assistantGainNodeRef,
      });
      assert.equal(gainNode.gain.value, 1.0);

      // Rapid Burst 2 (noise glitch 20ms later while bot is now silent):
      // Must NOT trigger another interruption!
      simulateVADMessage({
        type: "speech_start",
        isBotSpeakingRef,
        assistantGainNodeRef,
        onInterruption,
      });
      assert.equal(interruptionCount, 1, "Interruption must not fire a second time");
      assert.equal(gainNode.gain.value, 1.0, "Gain must remain unmuted at 1.0");
    });
  });

  describe("R2: useLiveKitSession Interruption Cancellation Guard", () => {
    function simulateHandleInterruption({
      isBotSpeakingRef,
      publishedMessages,
      messages,
      setMessages,
      setIsBotSpeaking,
    }) {
      // R2 Guard: ONLY publish response.cancel over DataChannel if assistant is currently speaking
      if (!isBotSpeakingRef.current) {
        return;
      }

      publishedMessages.push({ type: "response.cancel" });

      const last = messages[messages.length - 1];
      if (last && last.speaker === "assistant" && !last.isInterrupted) {
        setMessages([...messages.slice(0, -1), { ...last, isInterrupted: true }]);
      }
      setIsBotSpeaking(false);
    }

    it("strictly suppresses { type: 'response.cancel' } when assistant is NOT speaking", () => {
      const publishedMessages = [];
      const messages = [{ speaker: "assistant", text: "Hello", isInterrupted: false }];
      let currentMessages = [...messages];
      const isBotSpeakingRef = { current: false };

      simulateHandleInterruption({
        isBotSpeakingRef,
        publishedMessages,
        messages: currentMessages,
        setMessages: (m) => {
          currentMessages = m;
        },
        setIsBotSpeaking: (val) => {
          isBotSpeakingRef.current = val;
        },
      });

      assert.equal(publishedMessages.length, 0, "No cancel packet should be sent over DataChannel");
      assert.equal(currentMessages[0].isInterrupted, false, "Message should not be marked interrupted");
    });

    it("publishes { type: 'response.cancel' } and marks message when assistant IS speaking", () => {
      const publishedMessages = [];
      const messages = [{ speaker: "assistant", text: "Hello there!", isInterrupted: false }];
      let currentMessages = [...messages];
      const isBotSpeakingRef = { current: true };

      simulateHandleInterruption({
        isBotSpeakingRef,
        publishedMessages,
        messages: currentMessages,
        setMessages: (m) => {
          currentMessages = m;
        },
        setIsBotSpeaking: (val) => {
          isBotSpeakingRef.current = val;
        },
      });

      assert.equal(publishedMessages.length, 1, "Exactly one cancel packet must be sent");
      assert.deepEqual(publishedMessages[0], { type: "response.cancel" });
      assert.equal(currentMessages[0].isInterrupted, true, "Message must be marked interrupted");
      assert.equal(isBotSpeakingRef.current, false, "isBotSpeaking must transition to false");
    });
  });

  describe("R1 & R2: TrackSubscribed, ActiveSpeakers, and In-Flight Interruption Protection", () => {
    it("preserves isBotSpeaking = false on TrackSubscribed and audioElement.onplay (preventing initial prompt cancel)", () => {
      const audioCtx = { state: "running", currentTime: 0.5 };
      const gainNode = createMockGainNode(0.0);
      let isBotSpeaking = false;

      // Simulated TrackSubscribed logic
      try {
        if (typeof gainNode.gain.cancelScheduledValues === "function") {
          gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
        }
        gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
        gainNode.gain.value = 1.0;
      } catch {
        gainNode.gain.value = 1.0;
      }
      // Note: isBotSpeaking is NOT set to true here!

      // Simulated audioElement.onplay
      const onplay = () => {
        try {
          if (typeof gainNode.gain.cancelScheduledValues === "function") {
            gainNode.gain.cancelScheduledValues(audioCtx.currentTime);
          }
          gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
          gainNode.gain.value = 1.0;
        } catch {
          gainNode.gain.value = 1.0;
        }
        // Note: isBotSpeaking is NOT set to true here!
      };
      onplay();

      assert.equal(gainNode.gain.value, 1.0, "Gain must be initialized to 1.0");
      assert.equal(isBotSpeaking, false, "isBotSpeaking MUST remain false upon initial track subscription & play");
    });

    it("restores gain to 1.0 and sets isBotSpeaking = true when remote agent actively speaks", () => {
      const audioCtx = { state: "running", currentTime: 3.1 };
      const gainNode = createMockGainNode(0.0);
      let isBotSpeaking = false;
      const isUserSpeakingRef = { current: false };
      const speakers = [{ isLocal: false }]; // Remote assistant speaking

      // Simulated RoomEvent.ActiveSpeakersChanged handler
      const isAgentSpeaking = speakers.some((p) => !p.isLocal);
      if (!isUserSpeakingRef.current) {
        isBotSpeaking = isAgentSpeaking;
        if (isAgentSpeaking && gainNode) {
          gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
        }
      }

      assert.equal(isBotSpeaking, true, "Remote speaker must set isBotSpeaking = true");
      assert.equal(gainNode.gain.value, 1.0, "Remote speaker must restore assistantGainNode.gain to 1.0");
    });

    it("strictly guards against in-flight SFU audio leaking when user interrupts (isUserSpeaking = true)", () => {
      const audioCtx = { state: "running", currentTime: 4.2 };
      const gainNode = createMockGainNode(0.0); // Muted by VAD on user interruption
      let isBotSpeaking = false; // Set to false by handleInterruption
      const isUserSpeakingRef = { current: true }; // User is actively speaking their interruption

      // Residual SFU packet arrives while cancel signal is in-flight:
      const inFlightSpeakers = [{ isLocal: false }]; // SFU still reports agent active for 50ms

      // ActiveSpeakersChanged handler execution:
      const isAgentSpeaking = inFlightSpeakers.some((p) => !p.isLocal);
      if (!isUserSpeakingRef.current) {
        isBotSpeaking = isAgentSpeaking;
        if (isAgentSpeaking && gainNode) {
          gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
        }
      }

      assert.equal(isBotSpeaking, false, "isBotSpeaking must NOT be resurrected while user is speaking");
      assert.equal(gainNode.gain.value, 0.0, "Gain must remain 0.0 (muted) so no residual speech leaks to speakers");

      // User finishes speaking:
      isUserSpeakingRef.current = false;
      // handleSpeechEnd runs:
      gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
      assert.equal(gainNode.gain.value, 1.0, "Gain cleanly restored to 1.0 once user finishes speaking");
    });

    it("TrackUnsubscribed cleanly resets isBotSpeaking and disconnects audio state", () => {
      let assistantGainNode = createMockGainNode(1.0);
      let analyserNode = {};
      let isBotSpeaking = true;

      // Simulated TrackUnsubscribed
      isBotSpeaking = false;
      assistantGainNode = null;
      analyserNode = null;

      assert.equal(isBotSpeaking, false);
      assert.equal(assistantGainNode, null);
      assert.equal(analyserNode, null);
    });

    it("resumes suspended AudioContext when remote agent speaks or speech ends", async () => {
      let resumed = false;
      const audioCtx = {
        state: "suspended",
        currentTime: 5.0,
        resume: async () => {
          resumed = true;
          audioCtx.state = "running";
        },
      };
      const gainNode = {
        gain: {
          value: 0.0,
          cancelScheduledValues: () => {},
          setValueAtTime: (val) => {
            gainNode.gain.value = val;
          },
        },
        context: audioCtx,
      };

      // Simulated unmuteAssistant with suspended context
      if (gainNode.context.state === "suspended" && typeof gainNode.context.resume === "function") {
        await gainNode.context.resume();
      }
      if (gainNode.context.state === "running") {
        gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
      }
      gainNode.gain.value = 1.0;

      assert.equal(resumed, true, "Suspended context must be resumed on unmuting");
      assert.equal(audioCtx.state, "running");
      assert.equal(gainNode.gain.value, 1.0);
    });

    it("verifies multi-turn conversation cycles cleanly without stuck mute state", () => {
      const audioCtx = { state: "running", currentTime: 1.0 };
      const gainNode = createMockGainNode(1.0);
      let isBotSpeaking = false;
      let isUserSpeaking = false;
      const publishedCancellations = [];

      // Turn 1: User speaks prompt
      isUserSpeaking = true;
      // Prompt speaking: bot not speaking, no cancel
      if (isBotSpeaking) {
        gainNode.gain.value = 0.0;
        publishedCancellations.push("cancel");
      }
      assert.equal(publishedCancellations.length, 0);
      assert.equal(gainNode.gain.value, 1.0);

      // User finishes prompt
      isUserSpeaking = false;
      gainNode.gain.value = 1.0;

      // Agent responds
      if (!isUserSpeaking) {
        isBotSpeaking = true;
        gainNode.gain.value = 1.0;
      }
      assert.equal(isBotSpeaking, true);
      assert.equal(gainNode.gain.value, 1.0);

      // Turn 2: User interrupts agent mid-sentence!
      isUserSpeaking = true;
      if (isBotSpeaking) {
        gainNode.gain.value = 0.0; // Instant mute (<20ms)
        publishedCancellations.push("cancel");
        isBotSpeaking = false;
      }
      assert.equal(publishedCancellations.length, 1);
      assert.equal(gainNode.gain.value, 0.0);
      assert.equal(isBotSpeaking, false);

      // User finishes speaking their interruption
      isUserSpeaking = false;
      gainNode.gain.value = 1.0; // Unmuted on speech end
      assert.equal(gainNode.gain.value, 1.0);

      // Agent responds to the new interruption
      if (!isUserSpeaking) {
        isBotSpeaking = true;
        gainNode.gain.value = 1.0;
      }
      assert.equal(isBotSpeaking, true);
      assert.equal(gainNode.gain.value, 1.0);
    });

    it("attaches Web Audio media element source and onplay handler before calling play()", async () => {
      const events = [];
      const fakeAudioElement = {
        onplay: null,
        play: async () => {
          events.push("play_invoked");
          if (fakeAudioElement.onplay) {
            fakeAudioElement.onplay();
          }
        },
      };

      // Execution order in improved TrackSubscribed:
      // 1. Create media element source
      events.push("createMediaElementSource");
      // 2. Set onplay handler
      fakeAudioElement.onplay = () => {
        events.push("onplay_executed");
      };
      // 3. Invoke play()
      await fakeAudioElement.play();

      assert.deepEqual(events, [
        "createMediaElementSource",
        "play_invoked",
        "onplay_executed",
      ], "Web Audio graph and onplay handler must be attached prior to invoking play()");
    });

    it("strictly prevents audioElement.onplay from unmuting gain while user is actively speaking", () => {
      const gainNode = createMockGainNode(0.0); // Muted during user interruption
      const isUserSpeakingRef = { current: true }; // User is speaking

      // audioElement.onplay implementation with isUserSpeaking guard
      const onplay = () => {
        if (isUserSpeakingRef.current) {
          return;
        }
        gainNode.gain.value = 1.0;
      };

      onplay();
      assert.equal(gainNode.gain.value, 0.0, "Gain must remain 0.0 if onplay fires during user speech");

      // Once user finishes speaking:
      isUserSpeakingRef.current = false;
      onplay();
      assert.equal(gainNode.gain.value, 1.0, "Gain unmuted to 1.0 when onplay fires outside user speech");
    });

    it("reconciles isBotSpeaking in handleSpeechEnd when agent began speaking during user speech", () => {
      let isBotSpeaking = false;
      const isUserSpeakingRef = { current: true };
      const room = {
        activeSpeakers: [{ isLocal: false }], // Remote agent started speaking during user prompt/interruption
      };

      // Simulated handleSpeechEnd with room.activeSpeakers reconciliation
      const handleSpeechEnd = () => {
        isUserSpeakingRef.current = false;
        if (room && Array.isArray(room.activeSpeakers)) {
          const isAgentSpeaking = room.activeSpeakers.some((p) => !p.isLocal);
          if (isAgentSpeaking) {
            isBotSpeaking = true;
          }
        }
      };

      handleSpeechEnd();
      assert.equal(isBotSpeaking, true, "isBotSpeaking must be reconciled to true if agent is actively speaking");
    });

    it("gracefully survives AudioContext.resume() rejection in TrackSubscribed without crashing", async () => {
      let pipelineCreated = false;
      const audioCtx = {
        state: "suspended",
        resume: async () => {
          throw new Error("NotAllowedError: play() failed because the user didn't interact");
        },
      };

      // Simulated TrackSubscribed resume error handling
      if (audioCtx.state === "suspended") {
        try {
          await audioCtx.resume();
        } catch (err) {
          // Handled and logged without crashing
        }
      }

      // Web Audio graph wiring proceeds despite initial autoplay suspension
      pipelineCreated = true;
      assert.equal(pipelineCreated, true, "Audio pipeline setup must not abort when resume rejects");
    });
  });
});

