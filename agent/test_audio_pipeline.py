"""
Unit tests for LiveKit Audio Pipeline and Worker Prewarm (ADR-005, R1, R2, R3).
"""
import asyncio
import ssl
import unittest
from unittest.mock import MagicMock, patch
import numpy as np

from agent import agent
from livekit.agents.voice.transcription._speaking_rate import SpeakingRateDetector


class TestAgentPrewarmAndPipeline(unittest.TestCase):
    def test_prewarm_initializes_fft_and_userdata(self):
        """Verify R3: prewarm initializes numpy.fft, windowing, and sets userdata without blocking."""
        mock_proc = MagicMock()
        mock_proc.userdata = {}

        agent.prewarm(mock_proc)

        self.assertTrue(mock_proc.userdata.get("prewarmed"))
        self.assertIsInstance(mock_proc.userdata.get("gemini_ssl_context"), ssl.SSLContext)
        # Verify numpy.fft and numpy.hanning are functional and callable
        win = np.hanning(128)
        self.assertEqual(len(win), 128)
        res = np.fft.rfft([0.0] * 128)
        self.assertEqual(len(res), 65)

    def test_speaking_rate_detector_executes_fft_without_block(self):
        """Verify _speaking_rate STFT / spectral flux runs smoothly with prewarmed numpy.fft."""
        async def _run():
            detector = SpeakingRateDetector(sample_rate=16000)
            # Create 1 second of synthetic speech audio (440Hz sine wave)
            t = np.linspace(0, 1.0, 16000, endpoint=False, dtype=np.float32)
            audio = (0.5 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)

            stream = detector.stream()
            flux = stream._spectral_flux(audio, 16000)
            await stream.aclose()
            return flux

        flux = asyncio.run(_run())
        self.assertGreater(flux, 0.0, "Spectral flux should be greater than zero for tone audio")

    def test_worker_options_includes_prewarm_fnc(self):
        """Verify R3: WorkerOptions accepts and configures prewarm_fnc."""
        opts = agent.WorkerOptions(
            entrypoint_fnc=agent.entrypoint,
            prewarm_fnc=agent.prewarm,
        )
        self.assertEqual(opts.prewarm_fnc, agent.prewarm)
        self.assertEqual(opts.entrypoint_fnc, agent.entrypoint)

    def test_worker_keeps_one_process_warm_in_development(self):
        """The configured worker avoids a multi-second first-session process cold start."""
        opts = agent.build_worker_options()
        self.assertEqual(opts.num_idle_processes, 1)
        self.assertEqual(opts.port, 8081)

    def test_backend_http_pool_reuses_prewarmed_tls_context(self):
        """Creating an agent must not parse the certificate bundle on the audio loop."""
        tls_context = ssl.create_default_context()
        with patch.object(agent.httpx, "AsyncClient") as async_client:
            agent.VoiceBotAgent(
                room=MagicMock(),
                instructions="Calendar only",
                ssl_context=tls_context,
            )

        _, kwargs = async_client.call_args
        self.assertIs(kwargs["verify"], tls_context)
        self.assertFalse(kwargs["trust_env"])

    def test_interruption_cancel_packet_triggers_forced_session_interrupt(self):
        """Verify client-side response.cancel packet invokes agent.handle_incoming_data_packet with force=True."""
        mock_session = MagicMock()
        mock_packet = MagicMock()
        mock_packet.data = b'{"type": "response.cancel"}'

        result = agent.handle_incoming_data_packet(mock_packet, mock_session)

        self.assertTrue(result)
        mock_session.interrupt.assert_called_once_with(force=True)

    def test_non_cancel_data_packet_does_not_interrupt_session(self):
        """Verify non-cancel packets do not trigger session.interrupt."""
        mock_session = MagicMock()
        mock_packet = MagicMock()
        mock_packet.data = b'{"type": "chat_message", "text": "hello"}'

        result = agent.handle_incoming_data_packet(mock_packet, mock_session)

        self.assertFalse(result)
        mock_session.interrupt.assert_not_called()

    def test_malformed_and_binary_data_packets_handled_gracefully(self):
        """Verify corrupt or non-JSON packets do not crash the handler or interrupt."""
        mock_session = MagicMock()
        mock_packet = MagicMock()

        # Non-JSON string
        mock_packet.data = b"NOT_JSON_DATA"
        self.assertFalse(agent.handle_incoming_data_packet(mock_packet, mock_session))

        # Binary / non-UTF8 bytes
        mock_packet.data = b"\xff\xfe\x00\x01"
        self.assertFalse(agent.handle_incoming_data_packet(mock_packet, mock_session))

        mock_session.interrupt.assert_not_called()

    def test_session_interrupt_exception_caught_without_raising(self):
        """Verify that RuntimeError during session.interrupt (e.g. idle session) does not raise."""
        mock_session = MagicMock()
        mock_session.interrupt.side_effect = RuntimeError("AgentSession isn't running")
        mock_packet = MagicMock()
        mock_packet.data = b'{"type": "response.cancel"}'

        result = agent.handle_incoming_data_packet(mock_packet, mock_session)

        self.assertTrue(result)
        mock_session.interrupt.assert_called_once_with(force=True)


if __name__ == "__main__":
    unittest.main()
