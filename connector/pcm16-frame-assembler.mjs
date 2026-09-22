/**
 * Bounded framing for signed 16-bit little-endian PCM streams.
 *
 * This utility deliberately does not resample or connect to LiveKit/3CX. It
 * preserves sample bytes and turns arbitrarily fragmented input chunks into
 * fixed-duration frames for the adapter's separately tested resampler.
 */
export class Pcm16FrameAssembler {
  constructor({ sampleRate, channels = 1, frameDurationMs = 20, maxBufferedMs = 200 }) {
    if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
      throw new RangeError("sampleRate must be a positive integer");
    }
    if (!Number.isInteger(channels) || channels <= 0) {
      throw new RangeError("channels must be a positive integer");
    }
    if (!Number.isInteger(frameDurationMs) || frameDurationMs <= 0) {
      throw new RangeError("frameDurationMs must be a positive integer");
    }
    if (!Number.isInteger(maxBufferedMs) || maxBufferedMs < frameDurationMs) {
      throw new RangeError("maxBufferedMs must be at least one frame");
    }

    const samplesPerChannel = (sampleRate * frameDurationMs) / 1000;
    if (!Number.isInteger(samplesPerChannel)) {
      throw new RangeError("frame duration must contain an integer number of samples");
    }

    this.sampleRate = sampleRate;
    this.channels = channels;
    this.frameDurationMs = frameDurationMs;
    this.frameBytes = samplesPerChannel * channels * 2;
    this.maxBufferedBytes = Math.floor((sampleRate * channels * 2 * maxBufferedMs) / 1000);
    this.pending = Buffer.alloc(0);
  }

  /** Add one chunk and return complete frames. Throws instead of growing unbounded. */
  push(chunk) {
    if (!(Buffer.isBuffer(chunk) || chunk instanceof Uint8Array)) {
      throw new TypeError("PCM chunk must be a Buffer or Uint8Array");
    }
    if (chunk.byteLength === 0) return [];

    const bufferedBytes = this.pending.byteLength + chunk.byteLength;
    if (bufferedBytes > this.maxBufferedBytes) {
      throw new RangeError("PCM input exceeded the configured buffering limit");
    }

    const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const combined = this.pending.length ? Buffer.concat([this.pending, input], bufferedBytes) : input;
    const completeBytes = combined.length - (combined.length % this.frameBytes);
    const frames = [];
    for (let offset = 0; offset < completeBytes; offset += this.frameBytes) {
      // Copy each output so later input-buffer reuse cannot mutate a queued frame.
      frames.push(Buffer.from(combined.subarray(offset, offset + this.frameBytes)));
    }
    this.pending = Buffer.from(combined.subarray(completeBytes));
    return frames;
  }

  /** Discard an incomplete tail at end-of-stream; return its byte count for metrics. */
  reset() {
    const discardedBytes = this.pending.length;
    this.pending = Buffer.alloc(0);
    return discardedBytes;
  }
}
