import test, { after } from "node:test";
import assert from "node:assert/strict";
import { dispose } from "@livekit/rtc-node";
import { Pcm16LiveKitResampler } from "../pcm16-livekit-resampler.mjs";

function pcmFrame(samples) {
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * i) / 40) * 12000), i * 2);
  }
  return buffer;
}

test("resamples framed 8 kHz PCM16 to fixed 20 ms LiveKit frames and flushes the tail", async () => {
  const resampler = new Pcm16LiveKitResampler({ inputRate: 8000, outputRate: 24000 });
  try {
    const output = [];
    for (let i = 0; i < 5; i += 1) output.push(...resampler.push(pcmFrame(160)));
    output.push(...resampler.close());

    assert.ok(output.length > 0);
    assert.ok(output.every((frame) => frame.sampleRate === 24000 && frame.channels === 1));
    assert.ok(output.slice(0, -1).every((frame) => frame.samplesPerChannel === 480));
    assert.equal(output.reduce((count, frame) => count + frame.samplesPerChannel, 0), 2400);
    assert.throws(() => resampler.push(pcmFrame(160)), /closed/);
    assert.deepEqual(resampler.close(), []);
  } finally {
    resampler.close();
  }
});

test("rejects invalid framing and rates before opening a native resampler", () => {
  assert.throws(() => new Pcm16LiveKitResampler({ inputRate: 0, outputRate: 24000 }), /inputRate/);
  assert.throws(() => new Pcm16LiveKitResampler({ inputRate: 11025, outputRate: 24000, frameDurationMs: 1 }), /integer number/);

  const resampler = new Pcm16LiveKitResampler({ inputRate: 8000, outputRate: 24000 });
  try {
    assert.throws(() => resampler.push(Buffer.alloc(10)), /exactly 320 bytes/);
  } finally {
    resampler.close();
  }
});

after(async () => {
  await dispose();
});
