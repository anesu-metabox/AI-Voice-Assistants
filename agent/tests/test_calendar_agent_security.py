"""Security and tool-surface tests for the LiveKit calendar agent."""

import hashlib
import hmac
import inspect
import json
import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent import agent
from agent.assistant_policy import ASSISTANT_POLICY_VERSION, CALENDAR_TOOL_NAMES


def _signed_metadata(
    *,
    secret: str = "test-dispatch-secret",
    session_id: str = "session-123",
    company_id: str = "company-456",
    issued_at: int | None = None,
    timezone: str | None = None,
) -> str:
    issued_at = int(time.time()) if issued_at is None else issued_at
    unsigned = {
        "auth_subject": "auth-user-456",
        "company_id": company_id,
        "issued_at": issued_at,
        "session_id": session_id,
    }
    if timezone is not None:
        unsigned["timezone"] = timezone
    message = json.dumps(unsigned, sort_keys=True, separators=(",", ":")).encode()
    unsigned["signature"] = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return json.dumps(unsigned)


def test_policy_exposes_exactly_the_four_calendar_tools() -> None:
    assert CALENDAR_TOOL_NAMES == {
        "get_calendar_availability",
        "list_events",
        "book_event",
        "cancel_event",
    }
    assert ASSISTANT_POLICY_VERSION


def test_agent_has_no_non_calendar_callable_methods_or_identity_fallback() -> None:
    source = inspect.getsource(agent.VoiceBotAgent)
    assert "search_contacts" not in source
    assert "draft_email" not in source
    assert "create_durable_task" not in source
    assert "DEFAULT_USER_ID" not in inspect.getsource(agent)
    assert "user_id" not in source


def test_signed_dispatch_context_is_validated_and_tenant_bound() -> None:
    context = agent.load_verified_session_context(
        _signed_metadata(), signing_secret="test-dispatch-secret"
    )

    assert context is not None
    assert context.session_id == "session-123"
    assert context.company_id == "company-456"
    assert context.auth_subject == "auth-user-456"
    assert context.as_backend_payload() == {
        "session_id": "session-123",
        "company_id": "company-456",
        "auth_subject": "auth-user-456",
        "verified": True,
        "source": "livekit-dispatch",
    }


def test_signed_dispatch_timezone_is_bound_and_survives_backend_forwarding() -> None:
    context = agent.load_verified_session_context(
        _signed_metadata(timezone="Indian/Mauritius"),
        signing_secret="test-dispatch-secret",
    )

    assert context is not None
    assert context.timezone == "Indian/Mauritius"
    assert context.as_backend_payload()["timezone"] == "Indian/Mauritius"

    tampered = json.loads(_signed_metadata(timezone="Indian/Mauritius"))
    tampered["timezone"] = "Europe/London"
    assert agent.load_verified_session_context(
        json.dumps(tampered), signing_secret="test-dispatch-secret"
    ) is None


@pytest.mark.parametrize(
    "metadata,secret",
    [
        (None, "test-dispatch-secret"),
        (_signed_metadata(), "wrong-secret"),
        (_signed_metadata(issued_at=int(time.time()) - 301), "test-dispatch-secret"),
        ('{"session_id":"s","company_id":"c"}', "test-dispatch-secret"),
    ],
)
def test_invalid_dispatch_context_fails_closed(metadata: str | None, secret: str) -> None:
    assert agent.load_verified_session_context(metadata, signing_secret=secret) is None


@pytest.mark.asyncio
async def test_backend_dispatch_requires_verified_context() -> None:
    client = AsyncMock()

    with pytest.raises(PermissionError, match="Verified session/company context"):
        await agent.call_backend_tool("list_events", {}, client=client)

    client.post.assert_not_awaited()


@pytest.mark.asyncio
async def test_backend_dispatch_sends_context_not_model_identity() -> None:
    response = MagicMock()
    response.json.return_value = {"status": "success"}
    client = AsyncMock()
    client.post.return_value = response
    context = agent.VerifiedSessionContext("session-123", "company-456", "auth-user-456")

    result = await agent.call_backend_tool(
        "list_events",
        {"start_date": "2026-09-21"},
        session_context=context,
        client=client,
    )

    assert result == {"status": "success"}
    payload = client.post.await_args.kwargs["json"]
    assert payload["session_context"] == context.as_backend_payload()
    assert "user_id" not in payload
    response.raise_for_status.assert_called_once_with()


@pytest.mark.asyncio
async def test_unknown_tool_is_rejected_before_backend_call() -> None:
    client = AsyncMock()
    context = agent.VerifiedSessionContext("session-123", "company-456", "auth-user-456")

    with pytest.raises(PermissionError, match="not enabled"):
        await agent.call_backend_tool(
            "draft_email", {}, session_context=context, client=client
        )

    client.post.assert_not_awaited()
