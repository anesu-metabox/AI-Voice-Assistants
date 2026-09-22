from types import SimpleNamespace
import uuid

import pytest

from backend.app.api import settings as settings_api
from db.agent_profiles import validate_profile_transition


@pytest.mark.asyncio
@pytest.mark.parametrize("publish", [False, True])
async def test_assistant_save_preserves_requested_publish_state(monkeypatch, publish):
    company_id = str(uuid.uuid4())
    recorded = {}

    async def ensure_company(*args, **kwargs):
        return None

    async def save_config(**kwargs):
        recorded["is_deployed"] = kwargs["is_deployed"]
        return {"assistant_name": kwargs["assistant_name"], "is_deployed": kwargs["is_deployed"]}

    async def save_profile_version(**kwargs):
        recorded["published"] = kwargs["published"]
        recorded["profile"] = kwargs["profile"]
        return {"version": 1}

    monkeypatch.setattr(settings_api, "verify_session_context", lambda _header: SimpleNamespace(company_id=company_id, auth_subject="auth-user-1"))
    monkeypatch.setattr(settings_api, "ensure_company", ensure_company)
    monkeypatch.setattr(settings_api, "save_assistant_config", save_config)
    monkeypatch.setattr(settings_api, "save_agent_profile_version", save_profile_version)

    payload = settings_api.AssistantConfigRequest(
        assistant_name="Company Calendar Assistant",
        voice_engine="Aoede",
        inbound_greeting="How can I help with your calendar?",
        system_prompt="Follow company calendar instructions.",
        knowledge_base_notes="",
        tone="warm",
        business_hours={"monday": "09:00-17:00"},
        escalation_rules=["Ask a manager to follow up"],
        faq_entries=[{"question": "Where are you?", "answer": "Port Louis."}],
        capabilities={"google_calendar": {"enabled": True}, "company_faq": {"enabled": True}},
        is_deployed=publish,
    )
    result = await settings_api.update_assistant_config(payload, "verified")

    assert result["data"]["is_deployed"] is publish
    assert result["data"]["profile_version"] == 1
    assert recorded["is_deployed"] is publish
    assert recorded["published"] is publish
    assert recorded["profile"]["tone"] == "warm"
    assert recorded["profile"]["business_hours"] == {"monday": "09:00-17:00"}
    assert recorded["profile"]["escalation_rules"] == ["Ask a manager to follow up"]
    assert recorded["profile"]["faq_entries"] == [{"question": "Where are you?", "answer": "Port Louis."}]


@pytest.mark.parametrize(
    ("current", "target", "allowed"),
    [
        ("validated", "published", {"validated", "tested"}),
        ("tested", "published", {"validated", "tested"}),
        ("superseded", "published", {"superseded"}),
    ],
)
def test_profile_transition_accepts_only_explicit_source_states(current, target, allowed):
    validate_profile_transition(current, target, allowed)


@pytest.mark.parametrize(
    ("current", "target", "allowed"),
    [
        ("draft", "published", {"validated", "tested"}),
        ("published", "published", {"validated", "tested"}),
        ("draft", "published", {"superseded"}),
    ],
)
def test_profile_transition_rejects_unvalidated_or_repeated_publish(current, target, allowed):
    with pytest.raises(ValueError):
        validate_profile_transition(current, target, allowed)
