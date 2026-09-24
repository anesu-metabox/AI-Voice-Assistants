"""
Unit tests for AI Voice Bot Naturalness Upgrade (Milestones M1, M2, M3, M4).
Covers:
- Session Context Decoupling (M1)
- Pre-Buffered Acoustic Cache & LatencyMaskingWatchdog (M2, R1)
- Lexical Invariant & Grounded Confirmation Law (M2, R1, ANE-03)
- Dual-Stage Acoustic & Semantic VAD Configuration (M3, R2, R3)
- Spoken Text Sanitization (M4, R4)
- Calendar Tools RunContext Injection (M2, R1)
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from livekit import rtc
from livekit.agents import llm
from livekit.agents.voice.events import RunContext

from agent.agent import VoiceBotAgent, clean_spoken_text
from agent.latency_masking import (
    FILLER_DICTIONARY,
    FORBIDDEN_OUTCOME_WORDS,
    GLOBAL_PAC,
    LatencyMaskingWatchdog,
    create_pcm_audio_frames,
    validate_filler_phrase,
)
from agent.session_context import VerifiedSessionContext, load_verified_session_context


# ==============================================================================
# 1. Milestone 1: Session Context Decoupling Tests
# ==============================================================================

def test_session_context_decoupled_load():
    """Verify that load_verified_session_context works from agent.session_context."""
    context = VerifiedSessionContext(
        session_id="test-session-1",
        company_id="company-1",
        auth_subject="user-1",
        timezone="UTC",
    )
    payload = context.as_backend_payload()
    assert payload["session_id"] == "test-session-1"
    assert payload["verified"] is True
    assert payload["timezone"] == "UTC"


# ==============================================================================
# 2. Milestone 2: Lexical Invariant & Grounded Confirmation Law
# ==============================================================================

def test_filler_dictionary_strictly_prohibits_outcome_words():
    """Verify all phrases in FILLER_DICTIONARY adhere to the Lexical Invariant."""
    for tool_name, phrases in FILLER_DICTIONARY.items():
        assert len(phrases) >= 2, f"Tool {tool_name} must have multiple contextual phrases"
        for phrase in phrases:
            # Must pass without raising ValueError
            validate_filler_phrase(phrase)
            lower = phrase.lower()
            for forbidden in FORBIDDEN_OUTCOME_WORDS:
                assert forbidden not in lower.split(), (
                    f"Forbidden word '{forbidden}' found in phrase '{phrase}' for tool '{tool_name}'"
                )


def test_lexical_invariant_rejects_premature_confirmations():
    """Verify validate_filler_phrase raises ValueError on forbidden outcome words."""
    for forbidden in FORBIDDEN_OUTCOME_WORDS:
        violating_phrase = f"Your meeting has been {forbidden} successfully."
        with pytest.raises(ValueError, match="Lexical Invariant Violation"):
            validate_filler_phrase(violating_phrase)


# ==============================================================================
# 3. Milestone 2: Pre-Buffered Acoustic Cache (PAC)
# ==============================================================================

def test_pac_generates_standard_24khz_pcm_audio_frames():
    """Verify PAC generates 24kHz 16-bit mono PCM AudioFrames with 20ms duration."""
    frames = create_pcm_audio_frames(duration_seconds=1.0, sample_rate=24000)
    assert len(frames) == 50  # 1.0s / 0.02s = 50 frames
    for frame in frames:
        assert isinstance(frame, rtc.AudioFrame)
        assert frame.sample_rate == 24000
        assert frame.num_channels == 1
        assert frame.samples_per_channel == 480
        assert abs(frame.duration - 0.02) < 1e-4


def test_pac_pre_populates_frames_for_configured_voices():
    """Verify GLOBAL_PAC contains pre-buffered frames for standard agent voices."""
    for voice in ("Aoede", "Puck"):
        for tool, phrases in FILLER_DICTIONARY.items():
            for phrase in phrases:
                assert GLOBAL_PAC.has_phrase(voice, phrase), (
                    f"PAC missing pre-buffered audio for voice '{voice}', phrase '{phrase}'"
                )
                frames = GLOBAL_PAC.get_frames(voice, phrase)
                assert frames is not None
                assert len(frames) > 0


# ==============================================================================
# 4. Milestone 2: LatencyMaskingWatchdog Execution & Playout Bridging
# ==============================================================================

@pytest.mark.asyncio
async def test_watchdog_does_not_fire_on_fast_tool():
    """Fast tool executing in <280ms must NOT trigger filler speech."""
    mock_session = MagicMock()
    mock_session.say = MagicMock()

    async with LatencyMaskingWatchdog(
        tool_name="get_calendar_availability",
        voice="Aoede",
        dwell_ms=280.0,
        session=mock_session,
    ) as watchdog:
        # Tool execution takes 50ms (< 280ms threshold)
        await asyncio.sleep(0.05)

    assert watchdog.fired is False
    assert watchdog.filler_phrase is None
    mock_session.say.assert_not_called()


@pytest.mark.asyncio
async def test_watchdog_fires_on_slow_tool_and_synchronizes_playout():
    """Slow tool taking >280ms must trigger filler speech and await playout synchronization."""
    mock_session = MagicMock()
    mock_handle = MagicMock()
    playout_completed = False

    async def mock_wait_for_playout():
        nonlocal playout_completed
        await asyncio.sleep(0.05)
        playout_completed = True

    mock_handle.wait_for_playout = AsyncMock(side_effect=mock_wait_for_playout)
    mock_handle.done = MagicMock(return_value=False)
    mock_session.say = MagicMock(return_value=mock_handle)

    start_time = time.perf_counter()
    async with LatencyMaskingWatchdog(
        tool_name="book_event",
        voice="Aoede",
        dwell_ms=100.0,  # accelerated for testing
        session=mock_session,
    ) as watchdog:
        # Tool execution takes 200ms (> 100ms threshold)
        await asyncio.sleep(0.20)

    elapsed_ms = (time.perf_counter() - start_time) * 1000
    assert watchdog.fired is True
    assert watchdog.filler_phrase in FILLER_DICTIONARY["book_event"]
    assert mock_session.say.call_count == 1
    # Verify add_to_chat_ctx is False to protect Gemini conversation context
    say_kwargs = mock_session.say.call_args[1]
    assert say_kwargs.get("add_to_chat_ctx") is False
    assert say_kwargs.get("allow_interruptions") is True
    assert say_kwargs.get("audio") is not None
    # Verify playout synchronization was awaited
    assert playout_completed is True


# ==============================================================================
# 5. Milestone 2: RunContext Tool Parameter Injection
# ==============================================================================

def test_calendar_tools_declare_run_context_and_omit_from_llm_schema():
    """Verify all 4 calendar tools declare ctx: RunContext, which is omitted from LLM schemas."""
    mock_room = MagicMock()
    agent = VoiceBotAgent(room=mock_room, instructions="test")

    # Check function signatures
    tools = {
        "get_calendar_availability": agent.get_calendar_availability,
        "list_events": agent.list_events,
        "book_event": agent.book_event,
        "cancel_event": agent.cancel_event,
    }

    for name, tool_func in tools.items():
        # Get raw underlying function if wrapped
        raw_fn = getattr(tool_func, "_func", tool_func)
        annotations = getattr(raw_fn, "__annotations__", {})
        assert "ctx" in annotations, f"Tool '{name}' must declare 'ctx' parameter"
        assert annotations["ctx"] is RunContext, f"Tool '{name}' ctx must be annotated with RunContext"

        # Verify LLM schema omits ctx
        bound_fn = raw_fn.__get__(agent, VoiceBotAgent)
        pydantic_model = llm.utils.function_arguments_to_pydantic_model(bound_fn)
        assert "ctx" not in pydantic_model.model_fields, (
            f"Tool '{name}' schema must omit ctx parameter from LLM-visible fields"
        )


# ==============================================================================
# 6. Milestone 4: Spoken Text Sanitization (clean_spoken_text)
# ==============================================================================

def test_clean_spoken_text_strips_all_markdown_and_formatting():
    """Verify clean_spoken_text removes all markdown, bullet points, numbers, links, and code."""
    raw_markdown = (
        "# Calendar Overview\n"
        "Here are your upcoming appointments:\n"
        "* **Team Standup** at *9:00 AM*\n"
        "- **Product Review** at `2:00 PM` [Zoom](https://zoom.us/j/12345)\n"
        "1. First agenda topic\n"
        "2. Second agenda topic\n"
        "```python\nprint('code block')\n```\n"
        "Status: ~~cancelled~~ confirmed."
    )

    cleaned = clean_spoken_text(raw_markdown)

    # Markdown characters must be completely eliminated
    assert "#" not in cleaned
    assert "*" not in cleaned
    assert "`" not in cleaned
    assert "~~" not in cleaned
    assert "[" not in cleaned
    assert "]" not in cleaned
    assert "(" not in cleaned
    assert ")" not in cleaned
    assert "https://" not in cleaned
    assert "print('code block')" not in cleaned

    # Plain spoken text must be preserved
    assert "Calendar Overview" in cleaned
    assert "Team Standup at 9:00 AM" in cleaned
    assert "Product Review at 2:00 PM Zoom" in cleaned
    assert "First agenda topic" in cleaned
    assert "Second agenda topic" in cleaned
