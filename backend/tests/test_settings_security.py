from backend.app.api.settings import stable_participant_identity


def test_livekit_participant_identity_is_stable_for_token_retries():
    first = stable_participant_identity("company-a", "session-123")
    retry = stable_participant_identity("company-a", "session-123")
    different_session = stable_participant_identity("company-a", "session-456")
    different_company = stable_participant_identity("company-b", "session-123")

    assert first == retry
    assert first.startswith("user-")
    assert first != different_session
    assert first != different_company
