"""Company-local timezone handling for Google Calendar operations."""

from datetime import date

import pytest
from pydantic import ValidationError

from backend.app.auth_context import InternalSessionContext, issue_session_context
from backend.app.api import tools as tools_api
from backend.app.schemas.tools import ListEventsParams, ToolExecutionRequest
from backend.app.services import google_calendar
from backend.app.tools import calendar as calendar_tools
from backend.app.services.google_calendar import (
    _compute_free_slots,
    _local_date_range_utc,
)


def test_company_local_day_bounds_convert_to_utc():
    start, end, start_day, end_day = _local_date_range_utc(
        "2026-09-22", None, "Indian/Mauritius"
    )

    assert start.isoformat() == "2026-09-21T20:00:00+00:00"
    assert end.isoformat() == "2026-09-22T20:00:00+00:00"
    assert start_day == end_day == date(2026, 9, 22)


def test_availability_slots_use_local_business_hours_and_respect_busy_periods():
    slots = _compute_free_slots(
        "2026-09-22",
        [{"start": "2026-09-22T05:00:00Z", "end": "2026-09-22T05:30:00Z"}],
        30,
        "Indian/Mauritius",
    )

    assert slots[0] == "2026-09-22T05:30:00Z"  # 09:30 local; the 09:00 slot is busy.
    assert "2026-09-22T05:00:00Z" not in slots
    assert "2026-09-22T13:00:00Z" not in slots  # 17:00 local is outside business hours.


def test_availability_obeys_configured_weekday_hours_and_closed_days():
    hours = {"tuesday": "10:00-12:00", "wednesday": "closed"}

    tuesday_slots = _compute_free_slots(
        "2026-09-22", [], 30, "Indian/Mauritius", hours
    )
    wednesday_slots = _compute_free_slots(
        "2026-09-23", [], 30, "Indian/Mauritius", hours
    )

    assert tuesday_slots == [
        "2026-09-22T06:00:00Z",
        "2026-09-22T06:30:00Z",
        "2026-09-22T07:00:00Z",
        "2026-09-22T07:30:00Z",
    ]
    assert wednesday_slots == []


def test_availability_skips_nonexistent_local_slots_during_dst_transition():
    slots = _compute_free_slots(
        "2026-03-08",
        [],
        30,
        "America/New_York",
        {"sunday": "01:00-04:00"},
    )

    assert slots == [
        "2026-03-08T06:00:00Z",
        "2026-03-08T06:30:00Z",
        "2026-03-08T07:00:00Z",
        "2026-03-08T07:30:00Z",
    ]


def test_calendar_tool_timezone_is_optional_but_must_be_iana():
    assert ListEventsParams().timezone is None
    with pytest.raises(ValidationError):
        ListEventsParams(timezone="Not/A_Real_Timezone")


@pytest.mark.asyncio
async def test_calendar_tool_uses_saved_company_timezone_when_no_override(monkeypatch):
    async def profile_for_company(company_id: str):
        assert company_id == "company-123"
        return {"timezone": "Indian/Mauritius"}

    monkeypatch.setattr(tools_api, "get_company_profile", profile_for_company)

    assert await tools_api.resolve_company_timezone("company-123") == "Indian/Mauritius"


@pytest.mark.parametrize(
    ("tool_name", "parameters"),
    [
        ("get_calendar_availability", {"start_date": "2026-09-22"}),
        ("list_events", {"start_date": "2026-09-22"}),
    ],
)
@pytest.mark.asyncio
async def test_authenticated_calendar_tool_dispatch_inherits_company_timezone(
    monkeypatch, tool_name, parameters
):
    monkeypatch.setenv("LIVEKIT_SESSION_CONTEXT_SECRET", "timezone-dispatch-test")
    context = InternalSessionContext(
        session_id="timezone-session-123",
        company_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        auth_subject="timezone-user",
    )
    received = {}

    async def profile_for_company(company_id: str):
        assert company_id == context.company_id
        return {"timezone": "Indian/Mauritius"}

    async def fake_calendar_tool(
        user_id: str,
        timezone: str,
        start_date: str | None = None,
        end_date: str | None = None,
        duration_minutes: int = 30,
    ):
        received.update(
            user_id=user_id,
            timezone=timezone,
            start_date=start_date,
            end_date=end_date,
            duration_minutes=duration_minutes,
        )
        return {"timezone": timezone}

    monkeypatch.setattr(tools_api, "get_company_profile", profile_for_company)
    monkeypatch.setitem(tools_api.TOOL_REGISTRY, tool_name, fake_calendar_tool)

    result = await tools_api.execute_tool(
        ToolExecutionRequest(tool_name=tool_name, parameters=parameters),
        verified_context_header=issue_session_context(context),
    )

    assert result.status == "success"
    assert result.data["timezone"] == "Indian/Mauritius"
    assert received["timezone"] == "Indian/Mauritius"
    assert received["user_id"] == context.company_id


@pytest.mark.asyncio
async def test_calendar_dispatch_uses_signed_session_timezone_instead_of_reloading_profile(monkeypatch):
    monkeypatch.setenv("LIVEKIT_SESSION_CONTEXT_SECRET", "timezone-dispatch-test")
    context = InternalSessionContext(
        session_id="timezone-snapshot-session",
        company_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        auth_subject="timezone-user",
        timezone="Indian/Mauritius",
    )
    received = {}

    async def unexpected_profile_lookup(_company_id: str):
        raise AssertionError("a signed session timezone should avoid live profile lookup")

    async def fake_list_events(
        user_id: str,
        timezone: str,
        start_date: str | None = None,
        end_date: str | None = None,
    ):
        received.update(user_id=user_id, timezone=timezone)
        return {"timezone": timezone}

    monkeypatch.setattr(tools_api, "get_company_profile", unexpected_profile_lookup)
    monkeypatch.setitem(tools_api.TOOL_REGISTRY, "list_events", fake_list_events)

    result = await tools_api.execute_tool(
        ToolExecutionRequest(
            tool_name="list_events",
            parameters={"start_date": "2026-09-22"},
        ),
        verified_context_header=issue_session_context(context),
    )

    assert result.status == "success"
    assert received == {"user_id": context.company_id, "timezone": "Indian/Mauritius"}


@pytest.mark.asyncio
async def test_availability_dispatch_uses_business_hours_from_bound_profile_snapshot(monkeypatch):
    monkeypatch.setenv("LIVEKIT_SESSION_CONTEXT_SECRET", "timezone-dispatch-test")
    context = InternalSessionContext(
        session_id="timezone-profile-session",
        company_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        auth_subject="timezone-user",
        profile_version=3,
    )
    received = {}

    async def company_profile(_company_id: str):
        return {"timezone": "Indian/Mauritius"}

    async def published_profile(*, company_id: str, version: int):
        assert company_id == context.company_id
        assert version == 3
        return {
            "compiled_policy": {
                "allowedTools": ["get_calendar_availability"],
                "businessRules": {"business_hours": {"tuesday": "10:00-12:00"}},
            }
        }

    async def fake_availability(
        user_id: str,
        timezone: str,
        business_hours,
        start_date: str | None = None,
        end_date: str | None = None,
        duration_minutes: int = 30,
    ):
        received.update(timezone=timezone, business_hours=business_hours)
        return {"timezone": timezone, "business_hours": business_hours}

    monkeypatch.setattr(tools_api, "get_company_profile", company_profile)
    monkeypatch.setattr(tools_api, "get_published_agent_profile", published_profile)
    monkeypatch.setitem(
        tools_api.TOOL_REGISTRY, "get_calendar_availability", fake_availability
    )

    result = await tools_api.execute_tool(
        ToolExecutionRequest(
            tool_name="get_calendar_availability",
            parameters={"start_date": "2026-09-22"},
        ),
        verified_context_header=issue_session_context(context, profile_version=3),
    )

    assert result.status == "success"
    assert received == {
        "timezone": "Indian/Mauritius",
        "business_hours": {"tuesday": "10:00-12:00"},
    }


@pytest.mark.asyncio
async def test_calendar_tool_rejects_invalid_saved_company_timezone(monkeypatch):
    async def invalid_profile(_company_id: str):
        return {"timezone": "Not/A_Real_Timezone"}

    monkeypatch.setattr(tools_api, "get_company_profile", invalid_profile)

    with pytest.raises(ValueError, match="valid IANA timezone"):
        await tools_api.resolve_company_timezone("company-123")


@pytest.mark.asyncio
async def test_google_event_listing_queries_a_local_calendar_day_as_utc_bounds(monkeypatch):
    captured = {}

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {"items": []}

    class Client:
        async def get(self, _url, *, headers, params):
            captured.update(headers=headers, params=params)
            return Response()

    async def access_token(_company_id):
        return "test-token"

    monkeypatch.setattr(google_calendar, "get_valid_access_token", access_token)
    monkeypatch.setattr(google_calendar, "get_http_client", lambda: Client())

    result = await google_calendar.list_google_calendar_events(
        "company-123", "2026-09-22", timezone_name="Indian/Mauritius"
    )

    assert result["timezone"] == "Indian/Mauritius"
    assert captured["params"]["timeMin"] == "2026-09-21T20:00:00+00:00"
    assert captured["params"]["timeMax"] == "2026-09-22T20:00:00+00:00"
    assert captured["params"]["timeZone"] == "Indian/Mauritius"


@pytest.mark.asyncio
async def test_availability_uses_local_day_and_returns_local_business_hours(monkeypatch):
    captured = {}

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {"calendars": {"primary": {"busy": []}}}

    class Client:
        async def post(self, _url, *, headers, json):
            captured.update(headers=headers, payload=json)
            return Response()

    async def access_token(_company_id):
        return "test-token"

    monkeypatch.setattr(google_calendar, "get_valid_access_token", access_token)
    monkeypatch.setattr(google_calendar, "get_http_client", lambda: Client())

    result = await google_calendar.get_google_calendar_availability(
        "company-123", "2026-09-22", timezone_name="Indian/Mauritius"
    )

    assert result["available_slots"][0] == "2026-09-22T05:00:00Z"  # 09:00 Mauritius time.
    assert result["timezone"] == "Indian/Mauritius"
    assert captured["payload"]["timeMin"] == "2026-09-21T20:00:00+00:00"
    assert captured["payload"]["timeMax"] == "2026-09-22T20:00:00+00:00"
    assert captured["payload"]["timeZone"] == "Indian/Mauritius"


@pytest.mark.asyncio
async def test_naive_booking_time_is_interpreted_in_company_timezone(monkeypatch):
    captured = {}

    async def broker_post(_path, payload):
        captured.update(payload)
        return {"event_id": "event-1", "status": "confirmed"}

    monkeypatch.setattr(calendar_tools, "broker_post", broker_post)

    await calendar_tools.book_event(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "Review",
        "2026-09-22T09:00:00",
        timezone="Indian/Mauritius",
    )

    assert captured["start_time"] == "2026-09-22T05:00:00Z"
