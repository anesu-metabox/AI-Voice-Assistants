"""
Google Calendar API v3 Async Service
Direct REST integration for calendar availability and event creation with Google Meet support.
Runs asynchronously via httpx to maintain the sub-400ms Fast Lane voice latency budget.
"""

from datetime import datetime, timedelta, timezone
import logging
from typing import Any, Dict, List, Optional
import uuid

import httpx

from .google_oauth import get_valid_access_token

logger = logging.getLogger("voice_bot.services.google_calendar")

GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"


async def get_google_calendar_availability(
    user_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    duration_minutes: int = 30,
) -> Optional[Dict[str, Any]]:
    """
    Query Google Calendar API Free/Busy endpoint to calculate real available slots.
    Returns None if user is not authenticated with Google.
    """
    access_token = await get_valid_access_token(user_id)
    if not access_token:
        logger.info("No valid Google access token found for user %s; skipping real API call.", user_id)
        return None

    today = datetime.now(timezone.utc)
    base_date = start_date or today.strftime("%Y-%m-%d")

    try:
        # Determine start and end timestamps (defaulting to whole day)
        start_dt = datetime.fromisoformat(f"{base_date}T00:00:00+00:00")
        if end_date:
            end_dt = datetime.fromisoformat(f"{end_date}T23:59:59+00:00")
        else:
            end_dt = datetime.fromisoformat(f"{base_date}T23:59:59+00:00")
    except Exception as exc:
        logger.warning("Could not parse date (%s). Falling back to today.", exc)
        start_dt = today.replace(hour=0, minute=0, second=0, microsecond=0)
        end_dt = today.replace(hour=23, minute=59, second=59, microsecond=0)

    url = f"{GOOGLE_CALENDAR_API_BASE}/freeBusy"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    payload = {
        "timeMin": start_dt.isoformat(),
        "timeMax": end_dt.isoformat(),
        "items": [{"id": "primary"}],
    }

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                logger.error("Google Calendar freeBusy query failed: %s - %s", response.status_code, response.text)
                return None

            data = response.json()
            busy_periods = data.get("calendars", {}).get("primary", {}).get("busy", [])

            # Compute free intervals across standard business hours (09:00 - 17:00 UTC)
            available_slots = _compute_free_slots(base_date, busy_periods, duration_minutes)

            return {
                "user_id": str(user_id),
                "date": base_date,
                "start_date": start_date or base_date,
                "end_date": end_date or base_date,
                "available_slots": available_slots,
                "duration_minutes": duration_minutes,
                "timezone": "UTC",
                "source": "google_calendar_live",
            }
    except Exception as exc:
        logger.exception("Error querying Google Calendar API: %s", exc)
        return None


def _compute_free_slots(
    base_date: str,
    busy_periods: List[Dict[str, str]],
    duration_minutes: int,
) -> List[str]:
    """
    Generate slot suggestions within 09:00 - 17:00 UTC that do not collide with busy intervals.
    """
    candidate_hours = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"]
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

    for hour_str in candidate_hours:
        slot_start = datetime.fromisoformat(f"{base_date}T{hour_str}:00+00:00")
        slot_end = slot_start + timedelta(minutes=duration_minutes)

        # Check collision
        collides = False
        for b_start, b_end in parsed_busy:
            if slot_start < b_end and slot_end > b_start:
                collides = True
                break

        if not collides:
            free_slots.append(f"{base_date}T{hour_str}:00Z")

    return free_slots


async def book_google_calendar_event(
    user_id: str,
    title: str,
    start_time: str,
    duration_minutes: int = 30,
    attendees: Optional[List[str]] = None,
    description: Optional[str] = None,
    location: Optional[str] = "Google Meet",
) -> Optional[Dict[str, Any]]:
    """
    Create a Google Calendar event with auto-generated Google Meet conferencing link.
    Returns None if user is not authenticated with Google.
    """
    access_token = await get_valid_access_token(user_id)
    if not access_token:
        logger.info("No valid Google access token for user %s; skipping live booking.", user_id)
        return None

    # Parse start and compute end time
    try:
        clean_start = start_time.replace("Z", "+00:00")
        start_dt = datetime.fromisoformat(clean_start)
    except Exception:
        start_dt = datetime.now(timezone.utc) + timedelta(hours=1)

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
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(url, headers=headers, json=event_payload)
            if response.status_code not in (200, 201):
                logger.error("Google Calendar event creation failed: %s - %s", response.status_code, response.text)
                return None

            event_data = response.json()
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
    except Exception as exc:
        logger.exception("Error booking event via Google Calendar API: %s", exc)
        return None

