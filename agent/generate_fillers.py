"""
agent/generate_fillers.py
Pre-generate 24kHz 16-bit Mono PCM audio filler files for all configured voice personas.
These files are loaded into PrebufferedAudioCache (PAC) at worker startup for 0ms speech playout.
"""

import asyncio
import io
import os
import re
from pathlib import Path
import av
import edge_tts

try:
    from .latency_masking import FILLER_DICTIONARY, DEFAULT_SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_CHANNEL
except (ImportError, ValueError):
    from latency_masking import FILLER_DICTIONARY, DEFAULT_SAMPLE_RATE, NUM_CHANNELS, SAMPLES_PER_CHANNEL

VOICE_MAP = {
    "aoede": "en-US-AvaNeural",
    "kore": "en-US-JennyNeural",
    "puck": "en-US-AndrewNeural",
    "charon": "en-US-GuyNeural",
    "fenrir": "en-US-BrianNeural",
}

RESOURCES_DIR = Path(__file__).parent / "resources" / "fillers"


def phrase_slug(phrase: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", phrase.strip().lower()).strip("_")
    return cleaned[:60]


async def generate_filler_pcm(phrase: str, edge_voice: str) -> bytes:
    communicate = edge_tts.Communicate(phrase, edge_voice)
    mp3_bytes = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            mp3_bytes.extend(chunk["data"])

    container = av.open(io.BytesIO(mp3_bytes))
    resampler = av.AudioResampler(format="s16", layout="mono", rate=DEFAULT_SAMPLE_RATE)
    pcm_chunks = bytearray()
    for frame in container.decode(audio=0):
        for resampled in resampler.resample(frame):
            raw_data = resampled.to_ndarray().tobytes()
            pcm_chunks.extend(raw_data)
    return bytes(pcm_chunks)


async def generate_all_fillers() -> None:
    RESOURCES_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Generating fillers into {RESOURCES_DIR}...")
    for voice_key, edge_voice in VOICE_MAP.items():
        voice_dir = RESOURCES_DIR / voice_key
        voice_dir.mkdir(parents=True, exist_ok=True)
        for tool, phrases in FILLER_DICTIONARY.items():
            for phrase in phrases:
                slug = phrase_slug(phrase)
                out_file = voice_dir / f"{slug}.pcm"
                if out_file.exists() and out_file.stat().st_size > 0:
                    continue
                try:
                    pcm_data = await generate_filler_pcm(phrase, edge_voice)
                    out_file.write_bytes(pcm_data)
                    print(f"  [{voice_key}] generated {slug}.pcm ({len(pcm_data)} bytes)")
                except Exception as exc:
                    print(f"  [{voice_key}] error generating '{phrase}': {exc}")


if __name__ == "__main__":
    asyncio.run(generate_all_fillers())
