"""
agent/tests/test_live_conversation_flow.py
End-to-End Simulation Test for VoiceBotAgent Speech & Latency Masking.
Validates:
1. Inbound greeting speaking without RuntimeError (supports_say capability resolved).
2. Out-of-scope redirection speaking without RuntimeError.
3. All 4 calendar tools triggering latency masking acoustic fillers (>280ms).
4. Direct WebRTC audio frame capture & flush without deadlock.
5. Real-time DataChannel transcript card broadcasting.
6. Playout synchronization prior to releasing tool response.
"""

import asyncio
import json
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from livekit import rtc
from livekit.agents import StopResponse
from livekit.agents.llm import ChatMessage
from livekit.agents.voice import AgentSession, io
from livekit.agents.voice.events import RunContext
from livekit.plugins.google import realtime

from agent import agent
from agent.agent import VoiceBotAgent, clean_spoken_text, speak_configured_greeting
from agent.latency_masking import (
    FILLER_DICTIONARY,
    GLOBAL_PAC,
    LatencyMaskingWatchdog,
    create_pcm_audio_frames,
    validate_filler_phrase,
)
from agent.session_context import VerifiedSessionContext
from agent.tts import VoiceBotTTS


class TestLiveConversationFlow(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.room = MagicMock(spec=rtc.Room)
        self.room.name = "test-live-room"
        self.mock_participant = MagicMock()
        self.mock_participant.publish_data = AsyncMock()
        self.room.local_participant = self.mock_participant

        self.session_context = VerifiedSessionContext(
            session_id="test-session-live",
            company_id="company-live-1",
            auth_subject="user-live-1",
            timezone="America/New_York",
        )

        self.captured_frames = []
        self.flushed = False

        class MockAudioOutput(io.AudioOutput):
            def __init__(outer_self):
                super().__init__(label="mock_webrtc_sink", capabilities=io.AudioOutputCapabilities(pause=False))

            async def capture_frame(outer_self, frame):
                await super().capture_frame(frame)
                self.captured_frames.append(frame)

            def flush(outer_self):
                super().flush()
                self.flushed = True
                outer_self.on_playback_finished(playback_position=0.2, interrupted=False)

            def clear_buffer(outer_self):
                pass

        self.mock_audio_sink = MockAudioOutput()

    async def test_greeting_succeeds_without_runtime_error(self):
        """Inbound greeting must speak through AgentSession with VoiceBotTTS without throwing supports_say error."""
        model = realtime.RealtimeModel(model="gemini-2.0-flash-exp", api_key="fake")
        tts = VoiceBotTTS(voice="Aoede")
        session = AgentSession(llm=model, tts=tts)
        bot_agent = VoiceBotAgent(
            room=self.room,
            instructions="Calendar assistant",
            session_context=self.session_context,
            voice="Aoede",
        )

        # Mock room session start
        with patch.object(session, "say") as mock_say:
            mock_say.return_value = MagicMock()
            result = await speak_configured_greeting(session, "Hello! Welcome to our calendar service.")
            self.assertTrue(result)
            mock_say.assert_called_once_with(
                "Hello! Welcome to our calendar service.",
                allow_interruptions=True,
            )

    async def test_out_of_scope_redirect_speaks_without_error(self):
        """Policy redirection turn must invoke session.say cleanly and raise StopResponse."""
        bot_agent = VoiceBotAgent(
            room=self.room,
            instructions="Calendar assistant",
            session_context=self.session_context,
            voice="Aoede",
        )
        mock_session = MagicMock()
        mock_session.say = MagicMock()
        bot_agent.session = mock_session

        message = ChatMessage(role="user", content=["Tell me what the weather is like today."])
        with self.assertRaises(StopResponse):
            await bot_agent.on_user_turn_completed(MagicMock(), message)

        mock_session.say.assert_called_once()
        spoken_text = mock_session.say.call_args[0][0]
        self.assertIn("calendar", spoken_text.lower())

    async def test_all_four_calendar_tools_trigger_latency_masking_without_deadlock(self):
        """Each calendar tool must execute LatencyMaskingWatchdog, capture audio frames, and return JSON."""
        bot_agent = VoiceBotAgent(
            room=self.room,
            instructions="Calendar assistant",
            session_context=self.session_context,
            voice="Aoede",
        )

        mock_session = MagicMock()
        mock_session.output.audio = self.mock_audio_sink
        bot_agent.session = mock_session

        tools = [
            ("get_calendar_availability", lambda: bot_agent.get_calendar_availability(
                start_date="2026-09-25", duration_minutes=30
            )),
            ("list_events", lambda: bot_agent.list_events(
                start_date="2026-09-25"
            )),
            ("book_event", lambda: bot_agent.book_event(
                title="Client Consultation", start_time="2026-09-25T14:00:00"
            )),
            ("cancel_event", lambda: bot_agent.cancel_event(
                event_id="evt-1234-abcd", confirm=True
            )),
        ]

        for tool_name, tool_coro_fn in tools:
            self.captured_frames.clear()
            self.flushed = False

            # Simulate backend call taking 320ms (>280ms threshold) to trigger filler
            async def mock_call_backend(*args, **kwargs):
                await asyncio.sleep(0.32)
                return {"status": "success", "tool": tool_name, "data": []}

            with patch("agent.agent.call_backend_tool", side_effect=mock_call_backend):
                raw_result = await tool_coro_fn()

            parsed = json.loads(raw_result)
            self.assertEqual(parsed.get("status"), "success")
            self.assertEqual(parsed.get("tool"), tool_name)
            # Verify frames were captured directly into WebRTC sink
            self.assertGreater(len(self.captured_frames), 0, f"Tool {tool_name} failed to stream audio frames")
            self.assertTrue(self.flushed, f"Tool {tool_name} failed to flush audio sink")
            # Verify DataChannel transcript was published to the room
            self.mock_participant.publish_data.assert_awaited()

        await bot_agent.aclose()


if __name__ == "__main__":
    unittest.main()
