"""
agent/speaking_rate_unblock.py
Unblocks the asyncio event loop during speaking-rate detection.

LiveKit's SpeakingRateStream computes STFT spectral flux on audio frames directly
within its asyncio _main_task coroutine. On cold starts or under CPU load,
synchronous NumPy/FFT loops stall the event loop for 100ms+
(WARNING:livekit.agents:event loop blocked for 101ms at "_speaking_rate.py: _spectral_flux").
This stall causes WebSocket ping/pong timeouts (1006 abnormal closure) with Google Gemini Live.

This module patches SpeakingRateStream to:
1. Use vectorized STFT for sub-2ms spectral flux calculations.
2. Offload the computation off the asyncio event loop using asyncio.to_thread().
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any
import numpy as np

logger = logging.getLogger("voice_bot.speaking_rate_unblock")

_UNBLOCK_PATCHED = False


def patch_speaking_rate_unblock() -> bool:
    """Apply event-loop unblocking patch to LiveKit SpeakingRateStream."""
    global _UNBLOCK_PATCHED
    if _UNBLOCK_PATCHED:
        return True

    try:
        from livekit import rtc
        from livekit.agents.voice.transcription import _speaking_rate
        from livekit.agents.voice.transcription._speaking_rate import (
            SpeakingRateEvent,
            SpeakingRateStream,
        )
    except Exception as exc:
        logger.debug("SpeakingRateStream not available for unblocking patch: %s", exc)
        return False

    # 1. Optimize _stft with vectorized NumPy operations
    def _vectorized_stft(
        self: Any,
        audio: np.ndarray,
        frame_length: int,
        hop_length: int,
    ) -> np.ndarray:
        if len(audio) < frame_length:
            return np.zeros((frame_length // 2 + 1, 0), dtype=np.complex128)
        try:
            frames = np.lib.stride_tricks.sliding_window_view(audio, frame_length)[::hop_length]
            window = np.hanning(frame_length)
            scale = 1.0 / np.sqrt(np.sum(window**2))
            return (np.fft.rfft(frames * window, axis=1) * scale).T
        except Exception:
            num_frames = (len(audio) - frame_length) // hop_length + 1
            result = np.zeros((frame_length // 2 + 1, num_frames), dtype=np.complex128)
            window = np.hanning(frame_length)
            scale_factor = 1.0 / np.sqrt(np.sum(window**2))
            for i in range(num_frames):
                start = i * hop_length
                end = start + frame_length
                frame = audio[start:end]
                result[:, i] = np.fft.rfft(frame * window) * scale_factor
            return result

    SpeakingRateStream._stft = _vectorized_stft

    # 2. Patch _main_task to offload _compute_speaking_rate via asyncio.to_thread
    async def _unblocked_main_task(self: Any) -> None:
        _inference_sample_rate = 0
        inference_f32_data = np.empty(0, dtype=np.float32)

        pub_timestamp = self._opts.window_duration / 2
        inference_frames: list[rtc.AudioFrame] = []
        resampler: rtc.AudioResampler | None = None

        async for input_frame in self._input_ch:
            if not isinstance(input_frame, rtc.AudioFrame):
                # estimate the speech rate for the last frame
                available_samples = sum(frame.samples_per_channel for frame in inference_frames)
                if available_samples > self._window_size_samples * 0.5:
                    frame = rtc.combine_audio_frames(inference_frames)
                    frame_f32_data = np.empty(frame.samples_per_channel, dtype=np.float32)
                    np.divide(
                        frame.data,
                        np.iinfo(np.int16).max,
                        out=frame_f32_data,
                        dtype=np.float32,
                    )

                    sr = await asyncio.to_thread(
                        self._compute_speaking_rate, frame_f32_data, _inference_sample_rate
                    )
                    pub_timestamp += frame.duration
                    self._event_ch.send_nowait(
                        SpeakingRateEvent(
                            timestamp=pub_timestamp,
                            speaking=sr > 0,
                            speaking_rate=sr,
                        )
                    )
                inference_frames = []
                continue

            # resample the input frame if necessary
            if not self._input_sample_rate:
                self._input_sample_rate = input_frame.sample_rate
                _inference_sample_rate = self._opts.sample_rate or self._input_sample_rate

                self._window_size_samples = int(self._opts.window_duration * _inference_sample_rate)
                self._step_size_samples = int(self._opts.step_size * _inference_sample_rate)
                inference_f32_data = np.empty(self._window_size_samples, dtype=np.float32)

                if self._input_sample_rate != _inference_sample_rate:
                    resampler = rtc.AudioResampler(
                        input_rate=self._input_sample_rate,
                        output_rate=_inference_sample_rate,
                        num_channels=1,
                        quality=rtc.AudioResamplerQuality.MEDIUM,
                    )
            elif self._input_sample_rate != input_frame.sample_rate:
                logger.error(
                    "a frame with different sample rate was pushed",
                    extra={
                        "sample_rate": input_frame.sample_rate,
                        "expected_sample_rate": self._input_sample_rate,
                    },
                )
                continue

            if input_frame.num_channels > 1:
                data = np.array(input_frame.data, dtype=np.int16)
                mono = data.reshape(-1, input_frame.num_channels).mean(axis=1).astype(np.int16)
                input_frame = rtc.AudioFrame(
                    data=mono.tobytes(),
                    sample_rate=input_frame.sample_rate,
                    num_channels=1,
                    samples_per_channel=input_frame.samples_per_channel,
                )

            if resampler is not None:
                inference_frames.extend(resampler.push(input_frame))
            else:
                inference_frames.append(input_frame)

            while True:
                available_samples = sum(frame.samples_per_channel for frame in inference_frames)
                if available_samples < self._window_size_samples:
                    break

                inference_frame = rtc.combine_audio_frames(inference_frames)
                np.divide(
                    inference_frame.data[: self._window_size_samples],
                    np.iinfo(np.int16).max,
                    out=inference_f32_data,
                    dtype=np.float32,
                )

                # run the inference off the main asyncio thread
                sr = await asyncio.to_thread(
                    self._compute_speaking_rate, inference_f32_data, _inference_sample_rate
                )
                self._event_ch.send_nowait(
                    SpeakingRateEvent(
                        timestamp=pub_timestamp,
                        speaking=sr > 0,
                        speaking_rate=sr,
                    )
                )

                # move the window forward by the hop size
                pub_timestamp += self._opts.step_size
                if len(inference_frame.data) - self._step_size_samples > 0:
                    remaining = bytes(inference_frame.data[self._step_size_samples :])
                    remaining_samples = len(remaining) // 2  # int16 = 2 bytes
                    inference_frames = [
                        rtc.AudioFrame(
                            data=remaining,
                            sample_rate=inference_frame.sample_rate,
                            num_channels=1,
                            samples_per_channel=remaining_samples,
                        )
                    ]

    SpeakingRateStream._main_task = _unblocked_main_task
    _UNBLOCK_PATCHED = True
    logger.info("Successfully patched SpeakingRateStream with asyncio.to_thread unblocking")
    return True
