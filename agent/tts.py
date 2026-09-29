"""
agent/tts.py
Unified neural TTS integration for VoiceBotAgent.
Provides a speech path so that
AgentSession.say() (greeting, scope redirect, fallback messages) succeeds
when using Gemini RealtimeModel (where capabilities.supports_say == False).
"""

from __future__ import annotations

import asyncio
import io
from typing import Optional

try:
    import av
except ImportError:
    av = None

try:
    import edge_tts
except ImportError:
    edge_tts = None

from livekit.agents import APIConnectOptions, DEFAULT_API_CONNECT_OPTIONS, tts

DEFAULT_SAMPLE_RATE = 24000

SUPPORTED_TTS_LANGUAGES = frozenset({"fr-FR", "fr-BE", "en"})
VOICE_MAPS = {
    "en": {
        "aoede": "en-US-AvaNeural",
        "kore": "en-US-JennyNeural",
        "puck": "en-US-AndrewNeural",
        "charon": "en-US-GuyNeural",
        "fenrir": "en-US-BrianNeural",
    },
    "fr-FR": {
        "aoede": "fr-FR-DeniseNeural",
        "kore": "fr-FR-DeniseNeural",
        "puck": "fr-FR-HenriNeural",
        "charon": "fr-FR-HenriNeural",
        "fenrir": "fr-FR-HenriNeural",
    },
    "fr-BE": {
        "aoede": "fr-BE-CharlineNeural",
        "kore": "fr-BE-CharlineNeural",
        "puck": "fr-BE-GerardNeural",
        "charon": "fr-BE-GerardNeural",
        "fenrir": "fr-BE-GerardNeural",
    },
}


def edge_voice_for(voice: str, language: str) -> str:
    selected_language = language if language in SUPPORTED_TTS_LANGUAGES else "en"
    mapping = VOICE_MAPS[selected_language]
    fallback = "en-US-AvaNeural" if selected_language == "en" else next(iter(mapping.values()))
    return mapping.get(voice.lower(), fallback)


async def synthesize_neural_pcm(
    text: str,
    voice: str = "Aoede",
    language: str = "en",
    sample_rate: int = DEFAULT_SAMPLE_RATE,
) -> bytes:
    """Synthesize text into 24kHz 16-bit mono PCM bytes using edge-tts."""
    if edge_tts is None or av is None:
        raise RuntimeError("edge_tts or av library is not available in the current environment")
    edge_voice = edge_voice_for(voice, language)
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
        language = getattr(self._tts, "language", "en")
        # Scripted greetings and policy redirects use the configured TTS only.
        # Do not play procedural tones or cached task fillers when synthesis fails.
        pcm_bytes = await asyncio.wait_for(
            synthesize_neural_pcm(
                text,
                voice=voice,
                language=language,
                sample_rate=self._tts.sample_rate,
            ),
            timeout=4.0,
        )

        output_emitter.push(pcm_bytes)


class VoiceBotTTS(tts.TTS):
    """Unified TTS engine ensuring AgentSession.say() produces audio with zero deadlocks."""

    def __init__(
        self,
        voice: str = "Aoede",
        language: str = "en",
        sample_rate: int = DEFAULT_SAMPLE_RATE,
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=1,
        )
        self.voice = voice
        self.set_language(language)

    def set_language(self, language: str) -> None:
        if language not in SUPPORTED_TTS_LANGUAGES:
            raise ValueError("Unsupported scripted TTS language")
        self.language = language

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
