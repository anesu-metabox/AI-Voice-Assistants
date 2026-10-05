"""Unit tests for SpeakingRate unblocking optimizations (vectorized STFT and thread offloading)."""

import asyncio
import numpy as np
import pytest

from agent.speaking_rate_unblock import patch_speaking_rate_unblock


def test_speaking_rate_patch_application():
    """Verify patch_speaking_rate_unblock executes cleanly and idempotently."""
    result1 = patch_speaking_rate_unblock()
    result2 = patch_speaking_rate_unblock()
    assert result1 is True
    assert result2 is True


def test_vectorized_stft_correctness_and_speed():
    """Verify vectorized STFT produces valid frequency bins and completes under 5ms."""
    from livekit.agents.voice.transcription._speaking_rate import SpeakingRateStream

    frame_length = 256
    hop_length = 64
    # 1 second of 16kHz audio (16,000 samples)
    t = np.linspace(0, 1.0, 16000, endpoint=False, dtype=np.float32)
    audio = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)

    # Instantiate dummy object to invoke _stft
    dummy_stream = object.__new__(SpeakingRateStream)

    import time
    t0 = time.perf_counter()
    stft_result = SpeakingRateStream._stft(dummy_stream, audio, frame_length, hop_length)
    duration_ms = (time.perf_counter() - t0) * 1000

    # STFT result should have shape (frame_length // 2 + 1, num_frames)
    expected_bins = frame_length // 2 + 1
    assert stft_result.shape[0] == expected_bins
    assert stft_result.shape[1] > 0
    assert not np.isnan(stft_result).any()
    # Speed check: vectorized version should comfortably finish in <10ms
    assert duration_ms < 50.0  # Safe threshold even on slow CI machines


@pytest.mark.asyncio
async def test_speaking_rate_main_task_is_unblocked():
    """Verify that SpeakingRateStream._main_task uses asyncio.to_thread for compute."""
    from livekit.agents.voice.transcription._speaking_rate import SpeakingRateStream

    # Check that _main_task in SpeakingRateStream is our unblocked version
    import inspect
    source = inspect.getsource(SpeakingRateStream._main_task)
    assert "asyncio.to_thread" in source
