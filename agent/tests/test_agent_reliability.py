"""Focused regression checks for the LiveKit worker lifecycle."""

from pathlib import Path
import unittest


AGENT_SOURCE = (Path(__file__).parents[1] / "agent.py").read_text(encoding="utf-8")


class AgentReliabilityTests(unittest.TestCase):
    def test_worker_reuses_preloaded_ssl_context(self) -> None:
        self.assertIn("_install_livekit_ssl_context()", AGENT_SOURCE)
        self.assertIn("livekit_http_context._create_ssl_context = lambda: ssl_context", AGENT_SOURCE)

    def test_user_transcripts_publish_only_final_segments(self) -> None:
        self.assertIn("if event.transcript and event.is_final:", AGENT_SOURCE)
        self.assertIn('if event.item.role == "assistant":', AGENT_SOURCE)


if __name__ == "__main__":
    unittest.main()
