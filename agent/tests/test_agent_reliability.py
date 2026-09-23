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

    def test_entrypoint_uses_configurable_backend_timeout(self) -> None:
        self.assertIn("timeout=httpx.Timeout(BACKEND_TIMEOUT_SECONDS, connect=5.0)", AGENT_SOURCE)
        self.assertNotIn("timeout=2.0", AGENT_SOURCE)

    def test_company_profile_fetch_is_isolated_from_required_snapshot(self) -> None:
        self.assertIn("Optional company profile fetch failed or timed out", AGENT_SOURCE)


if __name__ == "__main__":
    unittest.main()

