"""The general API proxies typed provider operations without decrypting credentials."""

import uuid

import pytest

from backend.app.api import auth
from backend.app.tools import calendar


@pytest.mark.asyncio
async def test_calendar_tool_calls_broker_with_authenticated_company_scope(monkeypatch):
    calls = []

    async def broker_post(path, payload):
        calls.append((path, payload))
        return {"events": [], "count": 0, "source": "google_calendar_live"}

    monkeypatch.setattr(calendar, "broker_post", broker_post)
    company_id = str(uuid.uuid4())
    result = await calendar.list_events(company_id, start_date="2026-10-01", timezone="Indian/Mauritius")
    assert result["source"] == "google_calendar_live"
    assert calls == [(
        "/internal/v1/calendar/list",
        {"company_id": company_id, "start_date": "2026-10-01", "end_date": None, "timezone": "Indian/Mauritius"},
    )]


@pytest.mark.asyncio
async def test_calendar_availability_forwards_only_the_server_bound_business_hours(monkeypatch):
    calls = []

    async def broker_post(path, payload):
        calls.append((path, payload))
        return {"available_slots": [], "timezone": payload["timezone"]}

    monkeypatch.setattr(calendar, "broker_post", broker_post)
    company_id = str(uuid.uuid4())
    business_hours = {"tuesday": "10:00-12:00"}

    await calendar.get_calendar_availability(
        company_id,
        start_date="2026-09-22",
        timezone="Indian/Mauritius",
        business_hours=business_hours,
    )

    assert calls == [(
        "/internal/v1/calendar/availability",
        {
            "company_id": company_id,
            "start_date": "2026-09-22",
            "end_date": None,
            "duration_minutes": 30,
            "timezone": "Indian/Mauritius",
            "business_hours": business_hours,
        },
    )]


@pytest.mark.asyncio
async def test_calendar_booking_sends_structured_arguments_not_access_tokens(monkeypatch):
    captured = {}

    async def broker_post(path, payload):
        captured.update(path=path, payload=payload)
        return {"event_id": "google-event", "status": "confirmed"}

    monkeypatch.setattr(calendar, "broker_post", broker_post)
    result = await calendar.book_event(
        str(uuid.uuid4()), "Review", "2026-10-01T10:00:00+04:00", 45,
        attendees=["guest@example.invalid"],
    )
    assert result["event_id"] == "google-event"
    assert captured["path"] == "/internal/v1/calendar/book"
    assert captured["payload"]["start_time"] == "2026-10-01T06:00:00Z"
    assert "access_token" not in captured["payload"]
    assert "refresh_token" not in captured["payload"]


@pytest.mark.asyncio
async def test_oauth_callback_delegates_code_exchange_and_persistence_to_broker(monkeypatch):
    calls = []

    async def verify_state(_state):
        return {"company_id": str(uuid.uuid4()), "code_verifier": "v" * 43}

    async def broker_post(path, payload):
        calls.append((path, payload))
        return {"connected": True, "google_email": "calendar@example.invalid"}

    monkeypatch.setattr(auth, "verify_authorization_state", verify_state)
    monkeypatch.setattr(auth, "broker_post", broker_post)
    response = await auth.google_callback(code="single-use-code", state="signed-state")

    assert response.status_code == 200
    assert calls[0][0] == "/internal/v1/google/oauth/complete"
    assert calls[0][1]["code"] == "single-use-code"
    assert calls[0][1]["code_verifier"] == "v" * 43
    assert "access_token" not in calls[0][1]
    assert "refresh_token" not in calls[0][1]
