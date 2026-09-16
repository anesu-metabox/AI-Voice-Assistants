"""
Calendar Direct Tools
Provides calendar availability querying and event booking.
Includes realistic mock fallback with simulated network latency (<180ms) when OAuth is pending.
"""

import asyncio
from datetime import datetime, timedelta, timezone
import logging
from typing import Any, Dict, List, Optional
import uuid

from ..config import settings

logger = logging.getLogger("voice_bot.tools.calendar")


async def get_calendar_availability(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    duration_minutes: int = 30,
) -> Dict[str, Any]:
    """
    Query available calendar slots for a date range.
    """
    logger.info("Querying calendar availability between %s and %s", start_date, end_date)

    # Check if Google OAuth credentials are live
    if settings.google_client_id and settings.google_client_secret:
        # Placeholder for real Google Calendar API call (Collaborator 1 - Sprint 2)
        pass

    # Realistic mock fallback with simulated network latency (120ms)
    await asyncio.sleep(0.12)

    today = datetime.now(timezone.utc)
    base_date = start_date or today.strftime("%Y-%m-%d")

    available_slots: List[str] = [
        f"{base_date}T09:30:00Z",
        f"{base_date}T11:00:00Z",
        f"{base_date}T14:00:00Z",
        f"{base_date}T16:30:00Z",
    ]

    return {
        "date": base_date,
        "available_slots": available_slots,
        "duration_minutes": duration_minutes,
        "source": "google_calendar_mock",
    }


async def book_event(
    title: str,
    start_time: str,
    duration_minutes: int = 30,
    attendees: Optional[List[str]] = None,
    description: Optional[str] = None,
    location: Optional[str] = "Google Meet",
) -> Dict[str, Any]:
    """
    Create and schedule a new calendar event.
    """
    logger.info("Booking event '%s' at %s for %d minutes", title, start_time, duration_minutes)

    # Realistic mock fallback with simulated network latency (160ms)
    await asyncio.sleep(0.16)

    event_id = f"evt_{uuid.uuid4().hex[:12]}"
    meet_link = f"https://meet.google.com/{uuid.uuid4().hex[:3]}-{uuid.uuid4().hex[:4]}-{uuid.uuid4().hex[:3]}"

    return {
        "event_id": event_id,
        "title": title,
        "start_time": start_time,
        "duration_minutes": duration_minutes,
        "attendees": attendees or [],
        "meet_link": meet_link,
        "status": "confirmed",
        "source": "google_calendar_mock",
    }
