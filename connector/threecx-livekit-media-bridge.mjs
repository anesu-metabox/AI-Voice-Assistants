import {
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { Pcm16FrameAssembler } from "./pcm16-frame-assembler.mjs";
import { Pcm16LiveKitResampler } from "./pcm16-livekit-resampler.mjs";

const PBX_RATE = 8000;
const LIVEKIT_RATE = 24000;
const CHANNELS = 1;
const FRAME_MS = 20;
const MAX_BUFFERED_MS = 200;

/**
 * Bridges one Route Point participant to one already-connected LiveKit room.
 * Agent identity verification is deliberately injected and mandatory: a
 * participant name or track publication alone is not proof of trusted agent
 * dispatch. The owner must connect with autoSubscribe:false and bind this
 * bridge to its verified dispatch record.
 */
export class ThreeCxLiveKitMediaBridge {
  constructor({
    room,
    participant,
    dispatchId,
    isAuthorizedAgent,
    onSignal = () => {},
    onFailure,
    maxBufferedMs = MAX_BUFFERED_MS,
    dependencies = {},
  }) {
    if (!room?.localParticipant || typeof room.on !== "function" || typeof room.off !== "function") {
      throw new TypeError("A connected LiveKit room is required");
    }
    if (!participant || typeof participant.getAudioStream !== "function" || typeof participant.getAudioWriter !== "function") {
      throw new TypeError("A connected 3CX Route Point participant is required");
    }
    if (typeof dispatchId !== "string" || !dispatchId || dispatchId.length > 255) {
      throw new TypeError("A verified LiveKit dispatch ID is required");
    }
    if (typeof isAuthorizedAgent !== "function") throw new TypeError("A dispatch-bound agent verifier is required");
    if (typeof onSignal !== "function") throw new TypeError("onSignal must be a function");
    if (typeof onFailure !== "function") throw new TypeError("A safe PBX failure handler is required");
    if (!Number.isInteger(maxBufferedMs) || maxBufferedMs < FRAME_MS || maxBufferedMs > 2000) {
      throw new RangeError("maxBufferedMs must be between 20 and 2000 ms");
    }

    this.room = room;
    this.participant = participant;
    this.dispatchId = dispatchId;
    this.isAuthorizedAgent = isAuthorizedAgent;
    this.onSignal = onSignal;
    this.onFailure = onFailure;
    this.maxBufferedMs = maxBufferedMs;
    this.dependencies = {
      AudioSource,
      AudioStream,
      LocalAudioTrack,
      TrackPublishOptions,
      TrackSource,
      Pcm16FrameAssembler,
      Pcm16LiveKitResampler,
      ...dependencies,
    };
    this.writer = null;
    this.source = null;
    this.localTrack = null;
    this.inboundResampler = null;
    this.inboundAssembler = null;
    this.activeReaders = new Map();
    this.readerTasks = new Set();
    this.closed = false;
    this.failed = false;
    this.started = false;
    this.onTrackPublished = (publication, remoteParticipant) => {
      void this.#onTrackPublished(publication, remoteParticipant);
    };
    this.onTrackSubscribed = (track, publication, remoteParticipant) => {
      const task = this.#onTrackSubscribed(track, publication, remoteParticipant)
        .catch(() => this.#fail("agent_audio_stream_failed"));
      this.readerTasks.add(task);
      void task.finally(() => this.readerTasks.delete(task));
    };
    this.onTrackUnsubscribed = (track, _publication, remoteParticipant) => {
      if (this.#isAuthorized(remoteParticipant)) this.#fail("agent_audio_unsubscribed");
      void this.#stopReaderForTrack(track);
    };
    this.onParticipantDisconnected = (remoteParticipant) => {
      if (this.#isAuthorized(remoteParticipant)) this.#fail("verified_agent_disconnected");
    };
    this.onRoomDisconnected = () => {
      if (!this.closed) this.#fail("livekit_room_disconnected");
    };
  }

  async start() {
    if (this.closed) throw new Error("Media bridge is closed");
    if (this.started) return this;
    this.started = true;
    this.room.on("trackPublished", this.onTrackPublished);
    this.room.on("trackSubscribed", this.onTrackSubscribed);
    this.room.on("trackUnsubscribed", this.onTrackUnsubscribed);
    this.room.on("participantDisconnected", this.onParticipantDisconnected);
    this.room.on("disconnected", this.onRoomDisconnected);

    try {
      this.source = new this.dependencies.AudioSource(LIVEKIT_RATE, CHANNELS, this.maxBufferedMs / 1000);
      this.localTrack = this.dependencies.LocalAudioTrack.createAudioTrack("threecx-caller-audio", this.source);
      const options = new this.dependencies.TrackPublishOptions();
      options.source = this.dependencies.TrackSource.SOURCE_MICROPHONE;
      await this.room.localParticipant.publishTrack(this.localTrack, options);

      this.writer = this.participant.getAudioWriter();
      this.inboundAssembler = new this.dependencies.Pcm16FrameAssembler({
        sampleRate: PBX_RATE,
        channels: CHANNELS,
        frameDurationMs: FRAME_MS,
        maxBufferedMs: this.maxBufferedMs,
      });
      this.inboundResampler = new this.dependencies.Pcm16LiveKitResampler({
        inputRate: PBX_RATE,
        outputRate: LIVEKIT_RATE,
        channels: CHANNELS,
        frameDurationMs: FRAME_MS,
        maxBufferedMs: this.maxBufferedMs,
      });
      const readable = await this.participant.getAudioStream();
      if (!readable || typeof readable[Symbol.asyncIterator] !== "function") {
        throw new Error("pbx_audio_stream_unavailable");
      }
      this.inboundReadable = readable;
      this.inboundTask = this.#pumpPbxInput(readable);

      // A worker may have joined before bridge startup. Only subscribe after
      // the dispatch-bound verifier approves the participant.
      for (const remote of this.room.remoteParticipants.values()) {
        if (!this.#isAuthorized(remote)) continue;
        for (const publication of remote.trackPublications.values()) {
          if (publication.kind === "audio") publication.setSubscribed?.(true);
        }
      }
      this.#signal("media_bridge_started");
      return this;
    } catch (error) {
      this.#signal("media_bridge_start_failed");
      await this.close();
      throw error;
    }
  }

  /** Clear queued PBX playback immediately when the trusted agent signals interruption. */
  clearOutboundAudio() {
    if (!this.closed && this.writer && !this.writer.cancelled) {
      this.writer.clear();
      this.#signal("outbound_audio_cleared");
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.room.off("trackPublished", this.onTrackPublished);
    this.room.off("trackSubscribed", this.onTrackSubscribed);
    this.room.off("trackUnsubscribed", this.onTrackUnsubscribed);
    this.room.off("participantDisconnected", this.onParticipantDisconnected);
    this.room.off("disconnected", this.onRoomDisconnected);
    this.inboundReadable?.destroy?.();
    for (const reader of this.activeReaders.values()) {
      try { await reader.cancel(); } catch { /* Stream may already have ended. */ }
    }
    if (this.inboundTask) await this.inboundTask;
    if (this.readerTasks.size) await Promise.allSettled([...this.readerTasks]);
    this.activeReaders.clear();
    try { this.writer?.cancel(); } catch { /* SDK may have cancelled on PBX hang-up. */ }
    try { this.source?.clearQueue(); } catch { /* Source may not have started. */ }
    try { this.inboundResampler?.close(); } catch { /* Native resource cleanup is best effort here. */ }
    try {
      if (this.localTrack) await this.localTrack.close();
      else await this.source?.close();
    } catch { /* Room teardown may have closed it already. */ }
    this.#signal("media_bridge_closed");
  }

  async #pumpPbxInput(readable) {
    try {
      for await (const chunk of readable) {
        if (this.closed) break;
        for (const frame of this.inboundAssembler.push(chunk)) {
          for (const resampled of this.inboundResampler.push(frame)) {
            if (this.closed) break;
            await this.source.captureFrame(resampled);
          }
        }
      }
      if (!this.closed) {
        for (const tail of this.inboundResampler.flush()) await this.source.captureFrame(tail);
        this.inboundAssembler.reset();
        this.#fail("pbx_audio_stream_ended");
      }
    } catch {
      if (!this.closed) this.#fail("pbx_audio_stream_failed");
    }
  }

  async #onTrackPublished(publication, remoteParticipant) {
    if (!this.#isAuthorized(remoteParticipant) || publication?.kind !== "audio") return;
    try {
      publication.setSubscribed?.(true);
    } catch {
      this.#signal("agent_audio_subscribe_failed");
    }
  }

  async #onTrackSubscribed(track, publication, remoteParticipant) {
    if (this.closed || publication?.kind !== "audio" || !track || this.activeReaders.has(track)
      || !this.#isAuthorized(remoteParticipant)) return;
    const reader = new this.dependencies.AudioStream(track, {
      sampleRate: LIVEKIT_RATE,
      numChannels: CHANNELS,
      frameSizeMs: FRAME_MS,
    }).getReader();
    this.activeReaders.set(track, reader);
    this.#signal("agent_audio_subscribed");
    const assembler = new this.dependencies.Pcm16FrameAssembler({
      sampleRate: LIVEKIT_RATE,
      channels: CHANNELS,
      frameDurationMs: FRAME_MS,
      maxBufferedMs: this.maxBufferedMs,
    });
    const resampler = new this.dependencies.Pcm16LiveKitResampler({
      inputRate: LIVEKIT_RATE,
      outputRate: PBX_RATE,
      channels: CHANNELS,
      frameDurationMs: FRAME_MS,
      maxBufferedMs: this.maxBufferedMs,
    });
    try {
      while (!this.closed) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.sampleRate !== LIVEKIT_RATE || value.channels !== CHANNELS) {
          throw new Error("agent_audio_format_invalid");
        }
        const pcm = int16ToPcm16le(value.data);
        for (const frame of assembler.push(pcm)) {
          for (const output of resampler.push(frame)) this.#writePbxFrame(output);
        }
      }
      if (!this.closed) {
        for (const output of resampler.flush()) this.#writePbxFrame(output);
        assembler.reset();
        this.#signal("agent_audio_stream_ended");
      }
    } catch {
      if (!this.closed) this.#fail("agent_audio_stream_failed");
    } finally {
      this.activeReaders.delete(track);
      try { await reader.cancel(); } catch { /* Already closed. */ }
      resampler.close();
    }
  }

  #writePbxFrame(buffer) {
    const writer = this.writer;
    if (!writer || writer.cancelled) throw new Error("pbx_audio_writer_unavailable");
    const maxBufferedBytes = (PBX_RATE * CHANNELS * 2 * this.maxBufferedMs) / 1000;
    if (writer.bufferedBytes + buffer.length > maxBufferedBytes) {
      writer.clear();
      this.#fail("pbx_audio_queue_overflow");
      throw new Error("pbx_audio_queue_overflow");
    }
    writer.write(buffer);
  }

  #isAuthorized(remoteParticipant) {
    if (!remoteParticipant) return false;
    try { return this.isAuthorizedAgent(remoteParticipant, this.dispatchId) === true; } catch { return false; }
  }

  #signal(reason) {
    try { this.onSignal({ reason }); } catch { /* Metrics do not affect media safety. */ }
  }

  #fail(reason) {
    if (this.failed || this.closed) return;
    this.failed = true;
    this.#signal(reason);
    // Let the media reader/writer task that detected the failure unwind before
    // asking the call controller to close the bridge. Otherwise its cleanup
    // can await the very reader task that is awaiting the failure callback.
    void new Promise((resolve) => setImmediate(resolve))
      .then(() => this.onFailure({ reason }))
      .catch(() => this.#signal("pbx_failure_handler_failed"));
  }

  async #stopReaderForTrack(track) {
    const reader = this.activeReaders.get(track);
    if (reader) try { await reader.cancel(); } catch { /* Already closed. */ }
  }
}

function int16ToPcm16le(samples) {
  const buffer = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) buffer.writeInt16LE(samples[i], i * 2);
  return buffer;
}
