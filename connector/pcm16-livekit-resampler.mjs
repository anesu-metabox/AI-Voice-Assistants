import {
  AudioFrame,
  AudioResampler,
  AudioResamplerQuality,
} from "@livekit/rtc-node";

/**
 * Bounded PCM16LE frame adapter around LiveKit's native Sox resampler.
 * The caller still owns framing arbitrary 3CX stream chunks (use
 * Pcm16FrameAssembler); each push here must be one complete source frame.
 */
export class Pcm16LiveKitResampler {
  constructor({ inputRate, outputRate, channels = 1, frameDurationMs = 20, maxBufferedMs = 200 }) {
    for (const [name, value] of Object.entries({ inputRate, outputRate, channels, frameDurationMs, maxBufferedMs })) {
      if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
    }
    if (maxBufferedMs < frameDurationMs) throw new RangeError("maxBufferedMs must be at least one frame");

    const inputFrameSamples = (inputRate * frameDurationMs) / 1000;
    const outputFrameSamples = (outputRate * frameDurationMs) / 1000;
    if (!Number.isInteger(inputFrameSamples) || !Number.isInteger(outputFrameSamples)) {
      throw new RangeError("frame duration must contain an integer number of samples at both rates");
    }

    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.channels = channels;
    this.frameDurationMs = frameDurationMs;
    this.inputFrameSamples = inputFrameSamples;
    this.outputFrameSamples = outputFrameSamples;
    this.maxBufferedSamples = Math.floor((outputRate * channels * maxBufferedMs) / 1000);
    this.pending = new Int16Array(0);
    this.closed = false;
    this.resampler = new AudioResampler(inputRate, outputRate, channels, AudioResamplerQuality.HIGH);
  }

  /** Resample one exact-duration PCM16LE frame and return zero or more 20 ms frames. */
  push(buffer) {
    this.#ensureOpen();
    if (!(Buffer.isBuffer(buffer) || buffer instanceof Uint8Array)) {
      throw new TypeError("PCM input must be a Buffer or Uint8Array");
    }
    const expectedBytes = this.inputFrameSamples * this.channels * 2;
    if (buffer.byteLength !== expectedBytes) {
      throw new RangeError(`PCM input frame must contain exactly ${expectedBytes} bytes`);
    }

    const inputSamples = new Int16Array(buffer.byteLength / 2);
    const inputBytes = Buffer.isBuffer(buffer)
      ? buffer
      : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    for (let offset = 0; offset < inputSamples.length; offset += 1) {
      inputSamples[offset] = inputBytes.readInt16LE(offset * 2);
    }

    return this.#consume(this.resampler.push(new AudioFrame(
      inputSamples,
      this.inputRate,
      this.channels,
      this.inputFrameSamples,
    )));
  }

  /** Flush the native filter tail, returning complete frames plus a final partial frame. */
  flush() {
    this.#ensureOpen();
    return this.#consume(this.resampler.flush(), { includePartial: true });
  }

  /** Flush once, close the native resource, and return all remaining audio frames. */
  close() {
    if (this.closed) return [];
    let frames = [];
    try {
      frames = this.#consume(this.resampler.flush(), { includePartial: true });
    } finally {
      this.resampler.close();
      this.closed = true;
      this.pending = new Int16Array(0);
    }
    return frames;
  }

  #consume(frames, { includePartial = false } = {}) {
    const result = [];
    for (const frame of frames) {
      if (frame.sampleRate !== this.outputRate || frame.channels !== this.channels) {
        throw new Error("LiveKit resampler returned an unexpected audio format");
      }
      if (this.pending.length + frame.data.length > this.maxBufferedSamples) {
        throw new RangeError("Resampler output exceeded the configured buffering limit");
      }
      const joined = new Int16Array(this.pending.length + frame.data.length);
      joined.set(this.pending, 0);
      joined.set(frame.data, this.pending.length);
      this.pending = joined;

      const samplesPerFrame = this.outputFrameSamples * this.channels;
      while (this.pending.length >= samplesPerFrame) {
        result.push(this.#frame(this.pending.subarray(0, samplesPerFrame), this.outputFrameSamples));
        this.pending = this.pending.slice(samplesPerFrame);
      }
    }

    if (includePartial && this.pending.length > 0) {
      const samples = this.pending;
      this.pending = new Int16Array(0);
      result.push(this.#frame(samples, samples.length / this.channels));
    }
    return result;
  }

  #frame(samples, samplesPerChannel) {
    const detached = new Int16Array(samples);
    return new AudioFrame(detached, this.outputRate, this.channels, samplesPerChannel);
  }

  #ensureOpen() {
    if (this.closed) throw new Error("PCM resampler is closed");
  }
}
