const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const FRAME_SAMPLES = 128;
const SAMPLE_RATE = 48000;
const FRAME_MS = (FRAME_SAMPLES / SAMPLE_RATE) * 1000;

function createDetector() {
  let Processor;
  const events = [];
  class AudioWorkletProcessor {
    constructor() {
      this.port = { postMessage: (event) => events.push(event.type) };
    }
  }
  const context = {
    AudioWorkletProcessor,
    sampleRate: SAMPLE_RATE,
    registerProcessor: (_name, constructor) => { Processor = constructor; },
  };
  const source = fs.readFileSync(
    path.join(__dirname, "../public/worklets/vad-processor.js"),
    "utf8",
  );
  vm.runInNewContext(source, context);
  return { detector: new Processor(), events };
}

function feed(detector, durationMs, amplitude) {
  const frames = Math.ceil(durationMs / FRAME_MS);
  const samples = new Float32Array(FRAME_SAMPLES).fill(amplitude);
  for (let frame = 0; frame < frames; frame++) {
    detector.process([[samples]], [], {});
  }
  return frames * FRAME_MS;
}

test("a short backchannel ends before the interruption timer", () => {
  const { detector, events } = createDetector();
  const speechMs = feed(detector, 150, 0.05);
  const silenceMs = feed(detector, 110, 0);
  assert.deepEqual(events, ["speech_start", "speech_end"]);
  assert.ok(speechMs + silenceMs < 320);
});

test("sustained speech remains active at the interruption threshold", () => {
  const { detector, events } = createDetector();
  feed(detector, 250, 0.05);
  feed(detector, 70, 0);
  assert.deepEqual(events, ["speech_start"]);
});
