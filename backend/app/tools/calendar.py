"""Google-Calendar-only voice tools.

The voice agent has no local calendar fallback. A missing or expired Google
integration fails closed so one company's events cannot come from shared state.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional
import uuid
from zoneinfo import ZoneInfo

from ..services.credential_broker_client import broker_post


def _company_uuid(company_id: str) -> str:
    if not company_id:
        raise ValueError("A verified company identity is required for Calendar access")
    return str(uuid.UUID(str(company_id)))


def _format_utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso_datetime(value: str, timezone_name: str = "Indian/Mauritius") -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo(timezone_name))
    return parsed.astimezone(timezone.utc)


async def get_calendar_availability(user_id: str, start_date: Optional[str] = None, end_date: Optional[str] = None, duration_minutes: int = 30, timezone: Optional[str] = None, business_hours: Optional[Mapping[str, str]] = None) -> Dict[str, Any]:
    company_id = _company_uuid(user_id)
    result = await broker_post("/internal/v1/calendar/availability", {
        "company_id": company_id, "start_date": start_date, "end_date": end_date,
        "duration_minutes": duration_minutes, "timezone": timezone or "Indian/Mauritius",
        "business_hours": dict(business_hours) if business_hours else None,
    })
    if result is not None:
        if timezone:
            result["timezone"] = timezone
        return result
    return {"status": "integration_required", "error_code": "GOOGLE_CALENDAR_REQUIRED", "message": "Connect Google Calendar before requesting availability.", "source": "google_calendar"}


async def book_event(user_id: str, title: str, start_time: str, duration_minutes: int = 30, attendees: Optional[List[str]] = None, description: Optional[str] = None, location: Optional[str] = "Google Meet", session_id: Optional[str] = None, timezone: Optional[str] = None) -> Dict[str, Any]:
    company_id = _company_uuid(user_id)
    result = await broker_post("/internal/v1/calendar/book", {
        "company_id": company_id, "title": title,
        "start_time": _format_utc_iso(_parse_iso_datetime(start_time, timezone or "Indian/Mauritius")),
        "duration_minutes": duration_minutes, "attendees": attendees or [],
        "description": description, "location": location,
    })
    if result is not None:
        return result
    return {"status": "integration_required", "error_code": "GOOGLE_CALENDAR_REQUIRED", "message": "Connect Google Calendar before booking an event.", "source": "google_calendar"}


async def cancel_event(user_id: str, event_id: str, reason: Optional[str] = None, confirm: bool = False, confirmation_token: Optional[str] = None) -> Dict[str, Any]:
    if not confirm:
        return {"status": "confirmation_required", "message": f"Confirmation required to cancel event '{event_id}'.", "event_id": str(event_id)}
    company_id = _company_uuid(user_id)
    result = await broker_post("/internal/v1/calendar/cancel", {
        "company_id": company_id, "event_id": str(event_id),
    })
    if result.get("status") == "cancelled":
        return {"event_id": str(event_id), "id": str(event_id), "status": "cancelled", "reason": reason, "source": "google_calendar_live"}
    return {"status": "integration_required", "error_code": "GOOGLE_CALENDAR_REQUIRED", "message": "The event could not be cancelled through the connected Google Calendar.", "source": "google_calendar"}


async def list_events(user_id: str, start_date: Optional[str] = None, end_date: Optional[str] = None, timezone: Optional[str] = None) -> Dict[str, Any]:
    company_id = _company_uuid(user_id)
    result = await broker_post("/internal/v1/calendar/list", {
        "company_id": company_id, "start_date": start_date,
        "end_date": end_date, "timezone": timezone or "Indian/Mauritius",
    })
    if result is not None:
        return result
    return {"status": "integration_required", "error_code": "GOOGLE_CALENDAR_REQUIRED", "message": "Connect Google Calendar before listing events.", "source": "google_calendar"}
