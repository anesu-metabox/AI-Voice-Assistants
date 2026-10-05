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

    def test_required_profile_and_company_profile_fetch_in_parallel(self) -> None:
        self.assertIn("runtime_result, company_result = await asyncio.gather(", AGENT_SOURCE)
        self.assertIn('"X-Request-ID": profile_bootstrap_trace_id', AGENT_SOURCE)
        self.assertIn("stage=agent_profile_bootstrap", AGENT_SOURCE)

    def test_gemini_recovery_does_not_regenerate_partial_replies(self) -> None:
        recovery_source = (
            Path(__file__).parents[1] / "gemini_recovery.py"
        ).read_text(encoding="utf-8")
        self.assertIn("regenerate_on_swap=False", recovery_source)
        self.assertIn("session_resumption", AGENT_SOURCE)
        self.assertIn("context_window_compression", AGENT_SOURCE)

    def test_worker_broadcasts_lifecycle_and_heartbeat_state(self) -> None:
        self.assertIn("AgentLifecyclePublisher", AGENT_SOURCE)
        self.assertIn('lifecycle.transition("ready"', AGENT_SOURCE)
        self.assertIn('"provider_connection_error"', AGENT_SOURCE)

    def test_speaking_rate_unblock_is_applied(self) -> None:
        self.assertIn("patch_speaking_rate_unblock()", AGENT_SOURCE)

    def test_quota_exhausted_error_handling_is_wired(self) -> None:
        self.assertIn("_is_quota_exhausted_error", AGENT_SOURCE)
        self.assertIn("_handle_quota_exhausted", AGENT_SOURCE)
        self.assertIn('"quota_exhausted"', AGENT_SOURCE)
        self.assertIn('"RESOURCE_EXHAUSTED"', AGENT_SOURCE)

    def test_native_gemini_greeting_with_fallback(self) -> None:
        self.assertIn("speak_configured_greeting", AGENT_SOURCE)
        self.assertIn("session.generate_reply", AGENT_SOURCE)
        self.assertIn("session.say(cleaned", AGENT_SOURCE)

    def test_entrypoint_respects_session_context_voice_and_language(self) -> None:
        self.assertIn("session_context.voice", AGENT_SOURCE)
        self.assertIn("session_context.language", AGENT_SOURCE)


if __name__ == "__main__":
    unittest.main()

