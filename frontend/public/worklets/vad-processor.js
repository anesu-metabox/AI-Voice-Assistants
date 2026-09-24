/**
 * VAD AudioWorklet Processor (ADR-005, R2, R3)
 * Dual-stage acoustic detector with onset gating and 600ms pause hangover.
 * Runs in a dedicated audio thread to detect voice activity with <15ms latency.
 * Emits 'speech_start' and 'speech_end' messages to the main thread.
 */

class VADProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const rate = typeof sampleRate !== "undefined" ? sampleRate : 48000;
    this.energyThreshold = 0.025; // Calibrated mic energy threshold
    this.speechOnsetFrames = 4; // ~10.6ms at 48kHz: eliminates single-frame click/breath spikes
    // 600ms hangover: Math.round(0.6 * rate / 128) -> 225 frames at 48kHz
    this.silenceHangoverFrames = Math.round((0.6 * rate) / 128) || 225;
    this.consecutiveSpeechFrames = 0;
    this.silentFramesCount = 0;
    this.isSpeaking = false;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    let sumSquares = 0.0;

    for (let i = 0; i < channelData.length; i++) {
      sumSquares += channelData[i] * channelData[i];
    }

    const rms = Math.sqrt(sumSquares / channelData.length);

    if (rms > this.energyThreshold) {
      this.silentFramesCount = 0;
      this.consecutiveSpeechFrames++;

      if (!this.isSpeaking && this.consecutiveSpeechFrames >= this.speechOnsetFrames) {
        this.isSpeaking = true;
        this.port.postMessage({ type: "speech_start", energy: rms });
      }
    } else {
      this.consecutiveSpeechFrames = 0;
      if (this.isSpeaking) {
        this.silentFramesCount++;
        if (this.silentFramesCount > this.silenceHangoverFrames) {
          this.isSpeaking = false;
          this.port.postMessage({ type: "speech_end" });
        }
      }
    }

    return true;
  }
}

registerProcessor("vad-processor", VADProcessor);
