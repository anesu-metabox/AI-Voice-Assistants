"""
agent/latency_masking.py
Acoustic Latency Masking Engine & Pre-Buffered Acoustic Cache (PAC).
Enforces Requirement R1: >280ms triggers acoustic fillers; zero dead air >500ms;
Strictly preserves Grounded Confirmation Law (ANE-03).
"""

from __future__ import annotations

import asyncio
import logging
import math
import random
import re
import struct
import time
from pathlib import Path
from typing import Any, AsyncIterable, Dict, List, Mapping, Optional, Tuple

from livekit import rtc
from livekit.agents.voice.events import RunContext
from livekit.agents.voice import AgentSession

logger = logging.getLogger("voice_bot.latency_masking")

# Contextual Filler Phrases (Strictly In-Progress Dwell Semantics)
FILLER_DICTIONARY: Mapping[str, Tuple[str, ...]] = {
    "get_calendar_availability": (
        "Let me check that for you.",
        "Taking a quick look at your calendar.",
        "Checking availability now.",
        "Looking at open slots right now.",
    ),
    "list_events": (
        "Looking up your calendar events.",
        "Let me pull up your schedule.",
        "Checking your events for that day.",
        "Taking a look at your schedule now.",
    ),
    "book_event": (
        "Working on that reservation now.",
        "Reserving that time slot right now.",
        "Working on adding that event for you now.",
        "Checking reservation details now.",
    ),
    "cancel_event": (
        "Processing that cancellation now.",
        "Checking those cancellation details.",
        "Working on that cancellation right now.",
    ),
}

# Lexical Invariant (Grounding Confirmation Law / ANE-03)
# Prohibit premature outcome confirmations
FORBIDDEN_OUTCOME_WORDS: Tuple[str, ...] = (
    "confirmed",
    "scheduled",
    "booked",
    "all set",
    "cancelled",
)

FORBIDDEN_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in FORBIDDEN_OUTCOME_WORDS) + r")\b",
    re.IGNORECASE,
)


def validate_filler_phrase(phrase: str) -> None:
    """Validate that filler phrase strictly preserves Grounded Confirmation Law.

    Raises ValueError if any prohibited outcome confirmation word is present.
    """
    match = FORBIDDEN_PATTERN.search(phrase)
    if match:
        raise ValueError(
            f"Lexical Invariant Violation: Filler phrase '{phrase}' contains "
            f"forbidden outcome confirmation word '{match.group()}'"
        )


# Verify dictionary integrity at module load time
for _tool_name, _phrases in FILLER_DICTIONARY.items():
    for _p in _phrases:
        validate_filler_phrase(_p)


DEFAULT_SAMPLE_RATE = 24000
NUM_CHANNELS = 1
SAMPLES_PER_CHANNEL = 480  # 20ms frames at 24kHz


def create_pcm_audio_frames(
    duration_seconds: float = 1.2,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
    samples_per_channel: int = SAMPLES_PER_CHANNEL,
) -> List[rtc.AudioFrame]:
    """Generate 24kHz 16-bit mono PCM AudioFrames with a smooth acoustic envelope."""
    frames: List[rtc.AudioFrame] = []
    total_samples = int(duration_seconds * sample_rate)
    num_frames = (total_samples + samples_per_channel - 1) // samples_per_channel

    raw_samples = []
    for n in range(num_frames * samples_per_channel):
        t = n / sample_rate
        # Smooth attack (50ms) and decay (100ms) envelope
        env = 1.0
        if t < 0.05:
            env = t / 0.05
        elif t > (duration_seconds - 0.1):
            env = max(0.0, (duration_seconds - t) / 0.1)

        # Gentle vocal resonance harmonics (~220Hz / 440Hz / 880Hz) at pleasant listening level (~ -28dBFS)
        signal = (
            0.5 * math.sin(2 * math.pi * 220 * t)
            + 0.3 * math.sin(2 * math.pi * 440 * t)
            + 0.15 * math.sin(2 * math.pi * 880 * t)
        ) * env * 1200.0
        raw_samples.append(int(signal))

    for f_idx in range(num_frames):
        frame_samples = raw_samples[f_idx * samples_per_channel : (f_idx + 1) * samples_per_channel]
        data = struct.pack(f"<{len(frame_samples)}h", *frame_samples)
        frame = rtc.AudioFrame(
            data=data,
            sample_rate=sample_rate,
            num_channels=NUM_CHANNELS,
            samples_per_channel=samples_per_channel,
        )
        frames.append(frame)
    return frames


RESOURCES_DIR = Path(__file__).parent / "resources" / "fillers"


def phrase_slug(phrase: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", phrase.strip().lower()).strip("_")
    return cleaned[:60]


def load_pcm_frames_from_bytes(
    raw_data: bytes,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
    samples_per_channel: int = SAMPLES_PER_CHANNEL,
) -> List[rtc.AudioFrame]:
    """Convert raw 16-bit mono PCM bytes into a list of rtc.AudioFrame chunks."""
    frames: List[rtc.AudioFrame] = []
    chunk_size = samples_per_channel * 2  # 16-bit mono = 2 bytes per sample
    for i in range(0, len(raw_data), chunk_size):
        chunk = raw_data[i : i + chunk_size]
        if len(chunk) == chunk_size:
            frames.append(
                rtc.AudioFrame(
                    data=chunk,
                    sample_rate=sample_rate,
                    num_channels=NUM_CHANNELS,
                    samples_per_channel=samples_per_channel,
                )
            )
    return frames


class PrebufferedAudioCache:
    """Pre-Buffered Acoustic Cache (PAC) storing 24kHz 16-bit PCM AudioFrames."""

    def __init__(self) -> None:
        self._cache: Dict[Tuple[str, str], List[rtc.AudioFrame]] = {}

    def register_phrase_audio(self, voice: str, phrase: str, frames: List[rtc.AudioFrame]) -> None:
        validate_filler_phrase(phrase)
        self._cache[(voice.lower(), phrase)] = frames

    def get_frames(self, voice: str, phrase: str) -> Optional[List[rtc.AudioFrame]]:
        return self._cache.get((voice.lower(), phrase))

    def has_phrase(self, voice: str, phrase: str) -> bool:
        return (voice.lower(), phrase) in self._cache

    def warm_cache_for_voice(self, voice: str = "Aoede") -> None:
        """Pre-populate PAC with pre-generated neural speech audio frames for sub-15ms playout."""
        voice_lower = voice.lower()
        voice_dir = RESOURCES_DIR / voice_lower
        if not voice_dir.exists():
            voice_dir = RESOURCES_DIR / "aoede"

        for tool, phrases in FILLER_DICTIONARY.items():
            for phrase in phrases:
                if not self.has_phrase(voice, phrase):
                    frames: List[rtc.AudioFrame] = []
                    slug = phrase_slug(phrase)
                    pcm_path = voice_dir / f"{slug}.pcm"
                    if pcm_path.exists() and pcm_path.stat().st_size > 0:
                        try:
                            pcm_bytes = pcm_path.read_bytes()
                            frames = load_pcm_frames_from_bytes(pcm_bytes)
                        except Exception as read_err:
                            logger.warning("Failed to load filler pcm %s: %s", pcm_path, read_err)

                    if not frames:
                        words = phrase.split()
                        duration = max(0.8, min(2.5, len(words) * 0.28 + 0.3))
                        frames = create_pcm_audio_frames(duration_seconds=duration, sample_rate=DEFAULT_SAMPLE_RATE)

                    self.register_phrase_audio(voice, phrase, frames)


GLOBAL_PAC = PrebufferedAudioCache()
# Warm default voices
GLOBAL_PAC.warm_cache_for_voice("Aoede")
GLOBAL_PAC.warm_cache_for_voice("Puck")
GLOBAL_PAC.warm_cache_for_voice("Charon")
GLOBAL_PAC.warm_cache_for_voice("Kore")
GLOBAL_PAC.warm_cache_for_voice("Fenrir")


async def audio_frame_stream(frames: List[rtc.AudioFrame]) -> AsyncIterable[rtc.AudioFrame]:
    """Stream pre-buffered PCM frames with 20ms pacing into LiveKit audio track."""
    frame_duration = 0.02
    for frame in frames:
        yield frame
        await asyncio.sleep(frame_duration)


class LatencyMaskingWatchdog:
    """Watchdog that immediately communicates with the user when a tool starts.

    Speaks a contextual in-progress filler via:
    session.say(phrase, audio=audio_frame_stream(frames), allow_interruptions=True, add_to_chat_ctx=False)

    On exit, ensures playout synchronization:
    await filler_handle.wait_for_playout() before returning tool JSON output to Gemini.
    """

    def __init__(
        self,
        ctx: Optional[RunContext] = None,
        tool_name: str = "",
        voice: str = "Aoede",
        dwell_ms: float = 0.0,
        session: Optional[AgentSession] = None,
    ) -> None:
        self.ctx = ctx
        self.tool_name = tool_name
        self.voice = voice
        self.dwell_seconds = dwell_ms / 1000.0
        self._session: Optional[Any] = session or (getattr(ctx, "session", None) if ctx else None)
        self._filler_handle: Optional[Any] = None
        self._fired = False
        self._filler_phrase: Optional[str] = None
        self._stop_event = asyncio.Event()
        self._watchdog_task: Optional[asyncio.Task[None]] = None
        self._start_time: float = 0.0
        self._filler_triggered_at: Optional[float] = None

    @property
    def fired(self) -> bool:
        return self._fired

    @property
    def filler_phrase(self) -> Optional[str]:
        return self._filler_phrase

    async def __aenter__(self) -> "LatencyMaskingWatchdog":
        self._start_time = time.perf_counter()
        if self._session is not None:
            self._watchdog_task = asyncio.create_task(self._watchdog_loop())
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self._stop_event.set()
        if self._watchdog_task and not self._watchdog_task.done():
            self._watchdog_task.cancel()
            try:
                await self._watchdog_task
            except asyncio.CancelledError:
                pass

        # Playout Synchronization: ensure active filler finishes playing before releasing tool response
        await self.wait_for_playout()

    async def wait_for_playout(self) -> None:
        """Wait for any active filler speech to finish playing before releasing tool response."""
        if self._filler_handle is not None:
            try:
                if hasattr(self._filler_handle, "wait_for_playout"):
                    await self._filler_handle.wait_for_playout()
                elif hasattr(self._filler_handle, "done") and not self._filler_handle.done():
                    if asyncio.iscoroutine(self._filler_handle):
                        await self._filler_handle
            except Exception as e:
                logger.debug("Filler wait_for_playout skipped or interrupted: %s", e)

    async def _watchdog_loop(self) -> None:
        try:
            if self.dwell_seconds > 0:
                await asyncio.sleep(self.dwell_seconds)
            if self._stop_event.is_set():
                return

            phrases = FILLER_DICTIONARY.get(self.tool_name)
            if not phrases:
                phrases = ("Let me check that for you right now.",)
            phrase = random.choice(phrases)
            validate_filler_phrase(phrase)
            self._filler_phrase = phrase
            self._fired = True
            self._filler_triggered_at = time.perf_counter()

            if self._session is not None:
                frames = GLOBAL_PAC.get_frames(self.voice, phrase) or GLOBAL_PAC.get_frames("Aoede", phrase)
                if not frames:
                    frames = create_pcm_audio_frames(duration_seconds=1.2, sample_rate=DEFAULT_SAMPLE_RATE)

                self._filler_handle = self._session.say(
                    phrase,
                    audio=audio_frame_stream(frames),
                    allow_interruptions=True,
                    add_to_chat_ctx=False,
                )
                logger.info(
                    "Spoke task filler for '%s': '%s' (after %.1fms)",
                    self.tool_name,
                    phrase,
                    (self._filler_triggered_at - self._start_time) * 1000,
                )
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.warning("Failed to emit acoustic filler: %s", exc)
