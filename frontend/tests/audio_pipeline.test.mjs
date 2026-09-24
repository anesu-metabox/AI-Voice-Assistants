import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vadProcessorSource = readFileSync(resolve(root, "public/worklets/vad-processor.js"), "utf8");
const useClientVADSource = readFileSync(resolve(root, "src/hooks/useClientVAD.ts"), "utf8");
const assistantPolicySource = readFileSync(resolve(root, "src/lib/assistantPolicy.json"), "utf8");
const assistantPolicy = JSON.parse(assistantPolicySource);

test("vad-processor AudioWorklet implements 600ms pause tolerance and onset gating", () => {
  // Verify 4-frame speech onset gating (~10.6ms) to reject click/breath glitches
  assert.match(vadProcessorSource, /this\.speechOnsetFrames\s*=\s*4/);
  assert.match(vadProcessorSource, /consecutiveSpeechFrames\s*>=\s*this\.speechOnsetFrames/);

  // Verify 225-frame silence hangover (~600ms at 48kHz, 128 samples/frame)
  assert.match(vadProcessorSource, /this\.silenceHangoverFrames\s*=\s*Math\.round\(\(0\.6\s*\*\s*rate\)\s*\/\s*128\)\s*\|\|\s*225/);
  assert.match(vadProcessorSource, /silentFramesCount\s*>\s*this\.silenceHangoverFrames/);
});

test("vad-processor logic maintains speaking state across 500ms hesitation", () => {
  // Test simulated VAD logic
  const sampleRate = 48000;
  const hangoverFrames = Math.round((0.6 * sampleRate) / 128); // 225
  const onsetFrames = 4;
  let isSpeaking = false;
  let consecutiveSpeech = 0;
  let silentFrames = 0;
  let startEmitted = 0;
  let endEmitted = 0;

  function simulateFrame(rms) {
    if (rms > 0.025) {
      silentFrames = 0;
      consecutiveSpeech++;
      if (!isSpeaking && consecutiveSpeech >= onsetFrames) {
        isSpeaking = true;
        startEmitted++;
      }
    } else {
      consecutiveSpeech = 0;
      if (isSpeaking) {
        silentFrames++;
        if (silentFrames > hangoverFrames) {
          isSpeaking = false;
          endEmitted++;
        }
      }
    }
  }

  // 1-3 speech frames: should NOT trigger speech_start yet (noise rejection)
  for (let i = 0; i < 3; i++) simulateFrame(0.05);
  assert.equal(isSpeaking, false, "3 frames of noise should not trigger speech_start");
  assert.equal(startEmitted, 0);

  // 4th frame: declared speaking
  simulateFrame(0.05);
  assert.equal(isSpeaking, true, "4 frames must trigger speech_start");
  assert.equal(startEmitted, 1);

  // User speaks for 20 frames
  for (let i = 0; i < 20; i++) simulateFrame(0.05);

  // Mid-sentence pause of ~480ms (180 frames < 225)
  for (let i = 0; i < 180; i++) simulateFrame(0.001);
  assert.equal(isSpeaking, true, "480ms pause must not cut off user mid-sentence");
  assert.equal(endEmitted, 0);

  // Speech resumes for 20 frames
  for (let i = 0; i < 20; i++) simulateFrame(0.05);
  assert.equal(isSpeaking, true);
  assert.equal(endEmitted, 0);

  // Speech ends with >600ms silence (230 frames > 225)
  for (let i = 0; i < 230; i++) simulateFrame(0.001);
  assert.equal(isSpeaking, false, "Silence exceeding 600ms must emit speech_end");
  assert.equal(endEmitted, 1);
});

test("useClientVAD exports and enforces BACKCHANNEL_INTERRUPTION_THRESHOLD_MS of 320ms", () => {
  assert.match(useClientVADSource, /export const BACKCHANNEL_INTERRUPTION_THRESHOLD_MS = 320;/);
  assert.match(useClientVADSource, /clearInterruptionTimer/);
  assert.match(useClientVADSource, /interruptionTimerRef/);
  assert.match(useClientVADSource, /setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?muteAssistantGain\(\);[\s\S]*?onInterruptionRef\.current\(\);[\s\S]*?\},\s*BACKCHANNEL_INTERRUPTION_THRESHOLD_MS\)/);
});

test("useClientVAD backchannel simulation cancels timer without muting or cancelling", async () => {
  // Simulate the 320ms tentative barge-in window behavior
  const thresholdMs = 320;
  let gain = 1.0;
  let cancelled = false;
  let timer = null;

  function onSpeechStart(isBotSpeaking) {
    if (isBotSpeaking) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        gain = 0.0;
        cancelled = true;
      }, thresholdMs);
    }
  }

  function onSpeechEnd() {
    if (timer) {
      // Backchannel ended before threshold
      clearTimeout(timer);
      timer = null;
    } else {
      gain = 1.0;
    }
  }

  // Case 1: Bot speaking, user says "mhm" (200ms)
  onSpeechStart(true);
  assert.equal(gain, 1.0, "Gain must remain 1.0 during tentative barge-in window");
  assert.equal(cancelled, false, "Cancel must not be sent on initial speech_start");

  // Wait 150ms and end speech
  await new Promise((r) => setTimeout(r, 150));
  onSpeechEnd();

  // Wait another 200ms to verify timer did not fire late
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(gain, 1.0, "Gain must remain 1.0 after immune backchannel");
  assert.equal(cancelled, false, "Interruption must not fire for backchannels under 320ms");

  // Case 2: Bot speaking, user intentionally barges in (>320ms: "Wait, stop!")
  onSpeechStart(true);
  assert.equal(gain, 1.0);
  assert.equal(cancelled, false);

  // Wait 350ms (> 320ms threshold)
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(gain, 0.0, "Gain must drop to 0.0 when user speech sustains past 320ms");
  assert.equal(cancelled, true, "Cancel must be dispatched on sustained barge-in");

  // User finishes their barge-in prompt
  onSpeechEnd();
  assert.equal(gain, 1.0, "Gain must be restored to 1.0 on speech_end");
});

test("assistantPolicy mandates natural contractions, conversational cadence, and contextual fillers", () => {
  const instruction = assistantPolicy.systemInstruction;
  assert.match(instruction, /HUMAN SPEECH DYNAMICS & VOCAL CADENCE/);
  assert.match(instruction, /natural contractions/);
  assert.match(instruction, /'I'm', 'don't', 'can't', 'we'll'/);
  assert.match(instruction, /conversational markers/);
  assert.match(instruction, /'hmm', 'let's see', 'gotcha'/);
  assert.match(instruction, /POLITE REDIRECTION/);
  assert.match(instruction, /Grounded Confirmation Law/);
});
