"""
agent/tts.py
Unified neural TTS integration for VoiceBotAgent.
Provides seamless fallback and pre-buffered acoustic caching so that
AgentSession.say() (greeting, scope redirect, fallback messages) succeeds
even when using Gemini RealtimeModel (where capabilities.supports_say == False).
"""

from __future__ import annotations

import asyncio
import io
import logging
from typing import Optional

try:
    import av
except ImportError:
    av = None

try:
    import edge_tts
except ImportError:
    edge_tts = None

from livekit import rtc
from livekit.agents import APIConnectOptions, DEFAULT_API_CONNECT_OPTIONS, tts

try:
    from .latency_masking import (
        DEFAULT_SAMPLE_RATE,
        GLOBAL_PAC,
        create_pcm_audio_frames,
        load_pcm_frames_from_bytes,
    )
except (ImportError, ValueError):
    try:
        from agent.latency_masking import (
            DEFAULT_SAMPLE_RATE,
            GLOBAL_PAC,
            create_pcm_audio_frames,
            load_pcm_frames_from_bytes,
        )
    except ImportError:
        from latency_masking import (
            DEFAULT_SAMPLE_RATE,
            GLOBAL_PAC,
            create_pcm_audio_frames,
            load_pcm_frames_from_bytes,
        )

logger = logging.getLogger("voice_bot.tts")

VOICE_MAP = {
    "aoede": "en-US-AvaNeural",
    "kore": "en-US-JennyNeural",
    "puck": "en-US-AndrewNeural",
    "charon": "en-US-GuyNeural",
    "fenrir": "en-US-BrianNeural",
}


async def synthesize_neural_pcm(
    text: str,
    voice: str = "Aoede",
    sample_rate: int = DEFAULT_SAMPLE_RATE,
) -> bytes:
    """Synthesize text into 24kHz 16-bit mono PCM bytes using edge-tts."""
    if edge_tts is None or av is None:
        raise RuntimeError("edge_tts or av library is not available in the current environment")
    edge_voice = VOICE_MAP.get(voice.lower(), "en-US-AvaNeural")
    communicate = edge_tts.Communicate(text, edge_voice)
    mp3_bytes = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            mp3_bytes.extend(chunk["data"])

    container = av.open(io.BytesIO(mp3_bytes))
    resampler = av.AudioResampler(format="s16", layout="mono", rate=sample_rate)
    pcm_chunks = bytearray()
    for frame in container.decode(audio=0):
        for resampled in resampler.resample(frame):
            pcm_chunks.extend(resampled.to_ndarray().tobytes())
    return bytes(pcm_chunks)


class VoiceBotChunkedStream(tts.ChunkedStream):
    """Chunked synthesis stream serving pre-buffered or neural synthesized audio frames."""

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        text = self._input_text.strip()
        if not text:
            return

        import uuid
        output_emitter.initialize(
            request_id=f"req_{uuid.uuid4().hex[:8]}",
            sample_rate=self._tts.sample_rate,
            num_channels=self._tts.num_channels,
            mime_type="audio/pcm",
        )

        voice = getattr(self._tts, "voice", "Aoede")
        # 1. Check in-memory PrebufferedAudioCache (0ms latency)
        cached_frames = GLOBAL_PAC.get_frames(voice, text) or GLOBAL_PAC.get_frames("Aoede", text)
        if cached_frames:
            pcm_bytes = b"".join(f.data.tobytes() for f in cached_frames)
            output_emitter.push(pcm_bytes)
            return

        # 2. Synthesize using edge-tts
        try:
            pcm_bytes = await asyncio.wait_for(
                synthesize_neural_pcm(text, voice=voice, sample_rate=self._tts.sample_rate),
                timeout=4.0,
            )
        except Exception as exc:
            logger.warning("Neural TTS synthesis failed for '%s', using procedural tone: %s", text, exc)
            words = text.split()
            duration = max(0.8, min(3.5, len(words) * 0.28 + 0.3))
            frames = create_pcm_audio_frames(duration_seconds=duration, sample_rate=self._tts.sample_rate)
            pcm_bytes = b"".join(f.data.tobytes() for f in frames)

        output_emitter.push(pcm_bytes)


class VoiceBotTTS(tts.TTS):
    """Unified TTS engine ensuring AgentSession.say() produces audio with zero deadlocks."""

    def __init__(
        self,
        voice: str = "Aoede",
        sample_rate: int = DEFAULT_SAMPLE_RATE,
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=1,
        )
        self.voice = voice

    @property
    def model(self) -> str:
        return "voicebot-neural-tts"

    @property
    def provider(self) -> str:
        return "voicebot"

    def synthesize(
        self,
        text: str,
        *,
        conn_options: Optional[APIConnectOptions] = None,
    ) -> tts.ChunkedStream:
        return VoiceBotChunkedStream(
            tts=self,
            input_text=text,
            conn_options=conn_options or DEFAULT_API_CONNECT_OPTIONS,
        )
