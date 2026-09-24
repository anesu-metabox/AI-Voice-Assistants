"""
Google Calendar API v3 Async Service
Direct REST integration for calendar availability and event creation with Google Meet support.
Runs asynchronously via httpx to maintain the sub-400ms Fast Lane voice latency budget.
"""

from datetime import date, datetime, time, timedelta, timezone
import logging
from typing import Any, Dict, List, Mapping, Optional
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from .google_oauth import get_valid_access_token
from .http_client import get_http_client

logger = logging.getLogger("voice_bot.services.google_calendar")

GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
DEFAULT_COMPANY_TIMEZONE = "Indian/Mauritius"


def _provider_event_id(request_key: str) -> str:
    """Return a deterministic Google-compatible ID for one logical booking."""
    import hashlib

    return hashlib.sha256(request_key.encode("utf-8")).hexdigest()


async def get_google_calendar_booking_by_request_key(user_id: str, request_key: str) -> Dict[str, Any]:
    access_token = await get_valid_access_token(user_id)
    if not access_token:
        return {"status": "needs_reconnect", "error_code": "GOOGLE_CALENDAR_REAUTH_REQUIRED"}
    try:
        response = await get_http_client().get(
            f"{GOOGLE_CALENDAR_API_BASE}/calendars/primary/events/{_provider_event_id(request_key)}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if response.status_code == 404:
            return {"status": "not_found"}
        if response.status_code in (401, 403):
            return {"status": "needs_reconnect", "error_code": "GOOGLE_CALENDAR_REAUTH_REQUIRED"}
        if response.status_code == 429 or response.status_code >= 500:
            return {"status": "temporarily_unavailable", "retryable": True}
        if response.status_code != 200:
            return {"status": "failed", "retryable": False}
        event = _calendar_event_payload(response.json())
        if event["status"] == "cancelled":
            return {"status": "failed", "retryable": False}
        return event | {"status": "confirmed", "source": "google_calendar_live"}
    except httpx.HTTPError as exc:
        logger.error("Google Calendar booking reconciliation failed (%s)", type(exc).__name__)
        return {"status": "temporarily_unavailable", "retryable": True}


def _company_zone(timezone_name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name or DEFAULT_COMPANY_TIMEZONE)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("A valid IANA timezone is required for Calendar operations") from exc


def _local_date_range_utc(
    start_date: str | None,
    end_date: str | None,
    timezone_name: str | None,
    *,
    today: date | None = None,
) -> tuple[datetime, datetime, date, date]:
    """Convert inclusive local calendar dates to a UTC [start, end) range."""
    zone = _company_zone(timezone_name)
    start_day = date.fromisoformat(start_date) if start_date else (today or datetime.now(zone).date())
    end_day = date.fromisoformat(end_date) if end_date else start_day
    if end_day < start_day:
        raise ValueError("Calendar end date must not be before start date")
    start_local = datetime.combine(start_day, time.min, tzinfo=zone)
    end_local = datetime.combine(end_day + timedelta(days=1), time.min, tzinfo=zone)
    return (
        start_local.astimezone(timezone.utc),
        end_local.astimezone(timezone.utc),
        start_day,
        end_day,
    )


def _calendar_event_payload(event: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a Google Calendar event into the voice-tool response shape."""
    start = event.get("start", {})
    end = event.get("end", {})
    start_value = start.get("dateTime") or start.get("date")
    end_value = end.get("dateTime") or end.get("date")
    attendees = [
        attendee.get("email")
        for attendee in event.get("attendees", [])
        if attendee.get("email")
    ]
    return {
        "id": event.get("id"),
        "title": event.get("summary") or "Untitled event",
        "start_time": start_value,
        "end_time": end_value,
        "duration_minutes": _duration_minutes(start_value, end_value),
        "attendees": attendees,
        "meet_link": event.get("hangoutLink") or event.get("htmlLink"),
        "status": "cancelled" if event.get("status") == "cancelled" else "confirmed",
    }


def _duration_minutes(start_value: Optional[str], end_value: Optional[str]) -> int:
    if not start_value or not end_value or len(start_value) == 10 or len(end_value) == 10:
        return 1440 if start_value and end_value else 0
    try:
        start_dt = datetime.fromisoformat(start_value.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end_value.replace("Z", "+00:00"))
        return max(0, round((end_dt - start_dt).total_seconds() / 60))
    except Exception:
        return 0


async def list_google_calendar_events(
    user_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    timezone_name: str = DEFAULT_COMPANY_TIMEZONE,
) -> Optional[Dict[str, Any]]:
    """List the user's actual primary-calendar events from Google."""
    access_token = await get_valid_access_token(user_id)
    if not access_token:
        logger.info("No valid Google access token found; skipping live event list")
        return None

    try:
        start_utc, end_utc, start_day, end_day = _local_date_range_utc(
            start_date, end_date, timezone_name
        )
        time_min = start_utc.isoformat()
        time_max = end_utc.isoformat()
    except (ValueError, TypeError):
        logger.warning("Invalid Google Calendar date range")
        return None

    response = await get_http_client().get(
        f"{GOOGLE_CALENDAR_API_BASE}/calendars/primary/events",
        headers={"Authorization": f"Bearer {access_token}"},
        params={
            "timeMin": time_min,
            "timeMax": time_max,
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": "2500",
            "timeZone": str(_company_zone(timezone_name)),
        },
    )
    if response.status_code != 200:
        logger.error("Google Calendar event list failed: %s", response.status_code)
        return None

    events = [
        _calendar_event_payload(event)
        for event in response.json().get("items", [])
        if event.get("status") != "cancelled"
    ]
    return {
        "user_id": str(user_id),
        "start_date": start_day.isoformat(),
        "end_date": end_day.isoformat(),
        "timezone": str(_company_zone(timezone_name)),
        "count": len(events),
        "events": events,
        "source": "google_calendar_live",
    }


async def cancel_google_calendar_event(user_id: str, event_id: str) -> bool:
    """Cancel a Google Calendar event by its native Google event ID."""
    access_token = await get_valid_access_token(user_id)
    if not access_token:
        return False

    response = await get_http_client().delete(
        f"{GOOGLE_CALENDAR_API_BASE}/calendars/primary/events/{event_id}",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if response.status_code not in (200, 204):
        logger.error("Google Calendar event cancellation failed: %s", response.status_code)
        return False
    return True


async def get_google_calendar_availability(
    user_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    duration_minutes: int = 30,
    timezone_name: str = DEFAULT_COMPANY_TIMEZONE,
    business_hours: Mapping[str, str] | None = None,
) -> Optional[Dict[str, Any]]:
    """
    Query Google Calendar API Free/Busy endpoint to calculate real available slots.
    Returns None if user is not authenticated with Google.
    """
    access_token = await get_valid_access_token(user_id)
    if not access_token:
        logger.info("No valid Google access token found; skipping live availability request")
        return {"status": "needs_reconnect", "error_code": "GOOGLE_CALENDAR_REAUTH_REQUIRED"}

    try:
        start_dt, end_dt, start_day, end_day = _local_date_range_utc(
            start_date, end_date, timezone_name
        )
        zone = _company_zone(timezone_name)
    except (ValueError, TypeError):
        logger.warning("Invalid Google Calendar date range or timezone")
        return None

    url = f"{GOOGLE_CALENDAR_API_BASE}/freeBusy"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "timeMin": start_dt.isoformat(),
        "timeMax": end_dt.isoformat(),
        "timeZone": str(zone),
        "items": [{"id": "primary"}],
    }

    try:
        client = get_http_client()
        response = await client.post(url, headers=headers, json=payload)
        if response.status_code != 200:
            logger.error(
                "Google Calendar freeBusy query failed with status %s: %s",
                response.status_code,
                response.text,
            )
            if response.status_code in (401, 403):
                return {"status": "needs_reconnect", "error_code": "GOOGLE_CALENDAR_REAUTH_REQUIRED", "details": response.text}
            if response.status_code == 429 or response.status_code >= 500:
                return {"status": "temporarily_unavailable", "retryable": True}
            return {"status": "failed", "retryable": False, "details": response.text}

        data = response.json()
        busy_periods = data.get("calendars", {}).get("primary", {}).get("busy", [])

        available_slots = _compute_free_slots(
            start_day.isoformat(), busy_periods, duration_minutes, str(zone), business_hours
        )

        return {
            "user_id": str(user_id),
            "date": start_day.isoformat(),
            "start_date": start_day.isoformat(),
            "end_date": end_day.isoformat(),
            "available_slots": available_slots,
            "duration_minutes": duration_minutes,
            "timezone": str(zone),
            "source": "google_calendar_live",
        }
    except httpx.HTTPError as exc:
        logger.error("Google Calendar availability operation failed (%s)", type(exc).__name__)
        return {"status": "temporarily_unavailable", "retryable": True}


def _compute_free_slots(
    base_date: str,
    busy_periods: List[Dict[str, str]],
    duration_minutes: int,
    timezone_name: str = DEFAULT_COMPANY_TIMEZONE,
    business_hours: Mapping[str, str] | None = None,
) -> List[str]:
    """
    Generate company-local slots and return canonical UTC timestamps.
    """
    zone = _company_zone(timezone_name)
    local_day = date.fromisoformat(base_date)
    if business_hours:
        hours_value = business_hours.get(local_day.strftime("%A").lower())
        if not isinstance(hours_value, str) or hours_value.strip().casefold() == "closed":
            return []
        normalized = hours_value.strip().replace("–", "-").replace("—", "-")
        parts = normalized.split("-")
        if len(parts) != 2:
            return []
        try:
            opening_time, closing_time = (time.fromisoformat(part.strip()) for part in parts)
        except ValueError:
            return []
        if opening_time >= closing_time:
            return []
    else:
        opening_time, closing_time = time(9, 0), time(17, 0)

    opening = datetime.combine(local_day, opening_time)
    closing = datetime.combine(local_day, closing_time)
    business_close_utc = closing.replace(tzinfo=zone).astimezone(timezone.utc)
    free_slots: List[str] = []

    # Parse busy intervals
    parsed_busy = []
    for period in busy_periods:
        try:
            b_start = datetime.fromisoformat(period["start"].replace("Z", "+00:00"))
            b_end = datetime.fromisoformat(period["end"].replace("Z", "+00:00"))
            parsed_busy.append((b_start, b_end))
        except Exception:
            continue

    slot_start_local = opening
    while slot_start_local < closing:
        slot_start = slot_start_local.replace(tzinfo=zone)
        # Skip wall-clock times that do not exist during a DST spring-forward.
        normalized_start = slot_start.astimezone(timezone.utc).astimezone(zone)
        if normalized_start.replace(tzinfo=None) != slot_start_local:
            slot_start_local += timedelta(minutes=30)
            continue
        slot_start_utc = slot_start.astimezone(timezone.utc)
        slot_end_utc = slot_start_utc + timedelta(minutes=duration_minutes)
        if slot_end_utc > business_close_utc:
            break

        # Check collision
        collides = False
        for b_start, b_end in parsed_busy:
            if slot_start_utc < b_end and slot_end_utc > b_start:
                collides = True
                break

        if not collides:
            free_slots.append(slot_start_utc.strftime("%Y-%m-%dT%H:%M:%SZ"))
        slot_start_local += timedelta(minutes=30)

    return free_slots


async def book_google_calendar_event(
    user_id: str,
    title: str,
    start_time: str,
    duration_minutes: int = 30,
    attendees: Optional[List[str]] = None,
    description: Optional[str] = None,
    location: Optional[str] = "Google Meet",
    request_key: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Create a Google Calendar event with auto-generated Google Meet conferencing link.
    Returns None if user is not authenticated with Google.
    """
    access_token = await get_valid_access_token(user_id)
    if not access_token:
        logger.info("No valid Google access token found; skipping live booking")
        return {"status": "needs_reconnect", "error_code": "GOOGLE_CALENDAR_REAUTH_REQUIRED"}

    # Parse start and compute end time
    try:
        clean_start = str(start_time).strip().replace(" ", "T").replace("Z", "+00:00")
        try:
            start_dt = datetime.fromisoformat(clean_start)
        except Exception:
            if len(clean_start) == 16:  # YYYY-MM-DDTHH:MM
                clean_start += ":00+00:00"
            start_dt = datetime.fromisoformat(clean_start)
        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)
        else:
            start_dt = start_dt.astimezone(timezone.utc)
    except Exception as exc:
        logger.error("Google Calendar start time validation failed (%s)", type(exc).__name__)
        raise ValueError("Invalid ISO 8601 start_time timestamp") from exc

    end_dt = start_dt + timedelta(minutes=duration_minutes)

    event_payload: Dict[str, Any] = {
        "summary": title,
        "description": description or f"Voice Bot Scheduled Meeting: {title}",
        "start": {
            "dateTime": start_dt.isoformat(),
        },
        "end": {
            "dateTime": end_dt.isoformat(),
        },
        "conferenceData": {
            "createRequest": {
                "requestId": f"voice_meet_{uuid.uuid4().hex[:10]}",
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
    }

    # A stable provider event ID makes retries safe if Google created the event
    # but the response was lost before this service could record success.
    if request_key:
        event_payload["id"] = _provider_event_id(request_key)

    if location and "meet" not in location.lower():
        event_payload["location"] = location

    if attendees:
        event_payload["attendees"] = [{"email": email} for email in attendees if "@" in email]

    url = f"{GOOGLE_CALENDAR_API_BASE}/calendars/primary/events?conferenceDataVersion=1"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    try:
        client = get_http_client()
        response = await client.post(url, headers=headers, json=event_payload)
        if response.status_code == 409 and request_key:
            # The same logical request already created its event. Fetch the
            # deterministic event ID and return the confirmed result.
            existing = await client.get(
                f"{GOOGLE_CALENDAR_API_BASE}/calendars/primary/events/{event_payload['id']}",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            if existing.status_code == 200:
                response = existing
            else:
                return {"status": "temporarily_unavailable", "retryable": True}
        if response.status_code not in (200, 201):
            logger.error("Google Calendar event creation failed with status %s", response.status_code)
            if response.status_code in (401, 403):
                return {"status": "needs_reconnect", "error_code": "GOOGLE_CALENDAR_REAUTH_REQUIRED"}
            if response.status_code == 429 or response.status_code >= 500:
                return {"status": "temporarily_unavailable", "retryable": True}
            return {"status": "failed", "retryable": False}

        event_data = response.json()
        if event_data.get("status") == "cancelled":
            return {"status": "failed", "retryable": False}
        meet_link = event_data.get("hangoutLink")
        if not meet_link:
            # Check conference entry points
            entry_points = event_data.get("conferenceData", {}).get("entryPoints", [])
            for ep in entry_points:
                if ep.get("entryPointType") == "video":
                    meet_link = ep.get("uri")
                    break

        return {
            "event_id": event_data.get("id"),
            "title": event_data.get("summary", title),
            "start_time": start_dt.isoformat(),
            "duration_minutes": duration_minutes,
            "attendees": attendees or [],
            "meet_link": meet_link or event_data.get("htmlLink"),
            "html_link": event_data.get("htmlLink"),
            "status": "confirmed",
            "source": "google_calendar_live",
        }
    except httpx.HTTPError as exc:
        logger.error("Google Calendar booking operation failed (%s)", type(exc).__name__)
        return {"status": "temporarily_unavailable", "retryable": True}

