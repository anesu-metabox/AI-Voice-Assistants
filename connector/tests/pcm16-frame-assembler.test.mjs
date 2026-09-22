import test from "node:test";
import assert from "node:assert/strict";
import { Pcm16FrameAssembler } from "../pcm16-frame-assembler.mjs";

const frameBytes = 160 * 2; // 20 ms, 8 kHz, mono, signed 16-bit PCM

test("assembles exact 20 ms 8 kHz frames across arbitrary chunk boundaries", () => {
  const assembler = new Pcm16FrameAssembler({ sampleRate: 8000, channels: 1, frameDurationMs: 20 });
  const source = Buffer.from(Array.from({ length: frameBytes * 2 }, (_, index) => index % 251));

  const first = assembler.push(source.subarray(0, 117));
  const second = assembler.push(source.subarray(117, 511));
  const third = assembler.push(source.subarray(511));

  assert.equal(first.length, 0);
  assert.equal(second.length, 1);
  assert.equal(third.length, 1);
  assert.deepEqual(Buffer.concat([...second, ...third]), source);
  assert.equal(assembler.pending.length, 0);
});

test("keeps an odd byte tail until the next chunk completes the frame", () => {
  const assembler = new Pcm16FrameAssembler({ sampleRate: 8000 });
  const source = Buffer.alloc(frameBytes, 0x5a);
  assert.equal(assembler.push(source.subarray(0, frameBytes - 1)).length, 0);
  const [frame] = assembler.push(source.subarray(frameBytes - 1));
  assert.deepEqual(frame, source);
});

test("returns detached frame buffers and reports discarded trailing bytes", () => {
  const assembler = new Pcm16FrameAssembler({ sampleRate: 8000 });
  const source = Buffer.alloc(frameBytes + 3, 0x22);
  const [frame] = assembler.push(source);
  source.fill(0);
  assert.equal(frame[0], 0x22);
  assert.equal(assembler.reset(), 3);
  assert.equal(assembler.pending.length, 0);
  assert.equal(assembler.reset(), 0);
});

test("rejects malformed audio configuration and unbounded bursts", () => {
  assert.throws(() => new Pcm16FrameAssembler({ sampleRate: 0 }), /sampleRate/);
  assert.throws(() => new Pcm16FrameAssembler({ sampleRate: 11025, frameDurationMs: 7 }), /integer number/);

  const assembler = new Pcm16FrameAssembler({ sampleRate: 8000, maxBufferedMs: 40 });
  assert.throws(() => assembler.push(Buffer.alloc(frameBytes * 3)), /buffering limit/);
  assert.equal(assembler.pending.length, 0);
});

test("rejects non-byte inputs and frames multichannel audio without changing samples", () => {
  const assembler = new Pcm16FrameAssembler({ sampleRate: 16000, channels: 2, frameDurationMs: 20 });
  assert.throws(() => assembler.push("not pcm"), /Buffer or Uint8Array/);
  const pcm = Buffer.from([1, 2, 3, 4]);
  assert.deepEqual(assembler.push(pcm), []);
  assert.deepEqual(assembler.push(Buffer.alloc(320 * 4 - 4)), [Buffer.concat([pcm, Buffer.alloc(320 * 4 - 4)])]);
});
