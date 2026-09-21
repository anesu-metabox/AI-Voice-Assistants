"""
Calendar Database Persistence & Google Calendar Tools
Provides PostgreSQL-backed calendar availability querying, event booking with atomic
advisory locking, event cancellation with soft deletion, audit logging, and optional
live Google Calendar API integration with OAuth 2.0.
"""

import asyncio
from datetime import datetime, date, time as dt_time, timedelta, timezone as dt_timezone
import json
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
import uuid
import zoneinfo

from ..config import settings
from ..services.google_calendar import (
    book_google_calendar_event,
    get_google_calendar_availability,
)

root_path = str(Path(__file__).resolve().parents[3])
if root_path not in sys.path:
    sys.path.append(root_path)

from db.connection import get_db_pool

logger = logging.getLogger("voice_bot.tools.calendar")


def _format_utc_iso(dt: datetime) -> str:
    """Format a datetime object into a standardized ISO 8601 UTC string (YYYY-MM-DDTHH:MM:SSZ)."""
    if dt.tzinfo is None:
        utc_dt = dt.replace(tzinfo=dt_timezone.utc)
    else:
        utc_dt = dt.astimezone(dt_timezone.utc)
    return utc_dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_iso_datetime(dt_str: str) -> datetime:
    """Parse ISO 8601 timestamp string into timezone-aware UTC datetime."""
    if isinstance(dt_str, datetime):
        dt = dt_str
    else:
        clean = dt_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=dt_timezone.utc)
    return dt.astimezone(dt_timezone.utc)


def _parse_user_uuid(user_id: Any) -> Optional[uuid.UUID]:
    """Parse user ID to UUID object. Returns None if invalid, missing, or guest."""
    if isinstance(user_id, uuid.UUID):
        return user_id
    if not user_id or str(user_id).lower() in ("guest", "none", "null", ""):
        return None
    try:
        return uuid.UUID(str(user_id))
    except (ValueError, TypeError, AttributeError):
        return None


async def get_calendar_availability(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    duration_minutes: int = 30,
    timezone: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Query available calendar slots for a date range dynamically.
    Checks live Google Calendar if configured and authenticated;
    otherwise queries Neon PostgreSQL calendar_events and user_preferences.
    """
    user_uuid = _parse_user_uuid(user_id)
    if user_uuid is None:
        return {
            "status": "error",
            "error": "NOT_CONNECTED",
            "message": "Google Calendar is not connected. Please connect your Google Calendar account in the Integrations page.",
            "available_slots": [],
        }

    logger.info("Computing calendar availability for user %s (%s to %s)", user_uuid, start_date, end_date)

    # 1. Attempt live Google Calendar lookup if credentials are configured
    if settings.google_client_id and settings.google_client_secret:
        try:
            live_result = await get_google_calendar_availability(
                user_id=str(user_uuid),
                start_date=start_date,
                end_date=end_date,
                duration_minutes=duration_minutes,
            )
            if live_result:
                logger.info("Retrieved %d live calendar slots from Google Calendar.", len(live_result.get("available_slots", [])))
                return live_result
        except Exception as exc:
            logger.warning("Google Calendar lookup error (%s); falling back to database.", exc)

    # 2. Database-backed dynamic availability
    pool = await get_db_pool()
    working_hours = {"start": "09:00", "end": "17:00"}
    pref_tz = "UTC"

    async with pool.acquire() as conn:
        # Fetch user preferences
        pref_row = await conn.fetchrow(
            """
            SELECT timezone, working_hours, default_meeting_duration_minutes
            FROM user_preferences
            WHERE user_id = $1
            """,
            user_uuid,
        )
        if pref_row:
            pref_tz = pref_row["timezone"] or "UTC"
            raw_wh = pref_row["working_hours"]
            if isinstance(raw_wh, str):
                try:
                    working_hours = json.loads(raw_wh)
                except Exception:
                    pass
            elif isinstance(raw_wh, dict):
                working_hours = raw_wh

        effective_tz_name = timezone or pref_tz or "UTC"
        try:
            tz = zoneinfo.ZoneInfo(effective_tz_name)
        except Exception:
            tz = dt_timezone.utc
            effective_tz_name = "UTC"

        # Parse working hours start and end
        wh_start_str = working_hours.get("start", "09:00")
        wh_end_str = working_hours.get("end", "17:00")
        start_parts = [int(p) for p in wh_start_str.split(":")[:2]]
        end_parts = [int(p) for p in wh_end_str.split(":")[:2]]
        wh_start_time = dt_time(start_parts[0], start_parts[1])
        wh_end_time = dt_time(end_parts[0], end_parts[1])

        # Resolve date boundaries
        now_utc = datetime.now(dt_timezone.utc)
        if not start_date:
            start_date_obj = now_utc.astimezone(tz).date()
        else:
            if "T" in start_date:
                start_date_obj = _parse_iso_datetime(start_date).astimezone(tz).date()
            else:
                start_date_obj = datetime.strptime(start_date, "%Y-%m-%d").date()

        if not end_date:
            end_date_obj = start_date_obj
        else:
            if "T" in end_date:
                end_date_obj = _parse_iso_datetime(end_date).astimezone(tz).date()
            else:
                end_date_obj = datetime.strptime(end_date, "%Y-%m-%d").date()

        if end_date_obj < start_date_obj:
            end_date_obj = start_date_obj

        # Build overall query window in UTC
        range_start_dt = datetime.combine(start_date_obj, wh_start_time).replace(tzinfo=tz).astimezone(dt_timezone.utc)
        range_end_dt = datetime.combine(end_date_obj, wh_end_time).replace(tzinfo=tz).astimezone(dt_timezone.utc)

        # Query confirmed bookings in window
        rows = await conn.fetch(
            """
            SELECT start_time, end_time
            FROM calendar_events
            WHERE user_id = $1
              AND status = 'confirmed'
              AND start_time < $2
              AND end_time > $3
            ORDER BY start_time ASC
            """,
            user_uuid,
            range_end_dt,
            range_start_dt,
        )
        confirmed_intervals = [
            (row["start_time"].astimezone(dt_timezone.utc), row["end_time"].astimezone(dt_timezone.utc))
            for row in rows
        ]

    # Generate candidate slots and exclude occupied intervals
    available_slots: List[str] = []
    slot_step = timedelta(minutes=duration_minutes if duration_minutes > 0 else 30)
    cur_date = start_date_obj

    while cur_date <= end_date_obj:
        day_slot_start = datetime.combine(cur_date, wh_start_time).replace(tzinfo=tz)
        day_boundary_end = datetime.combine(cur_date, wh_end_time).replace(tzinfo=tz)

        while day_slot_start + timedelta(minutes=duration_minutes) <= day_boundary_end:
            candidate_end = day_slot_start + timedelta(minutes=duration_minutes)
            slot_start_utc = day_slot_start.astimezone(dt_timezone.utc)
            slot_end_utc = candidate_end.astimezone(dt_timezone.utc)

            # Check for overlap against confirmed intervals
            overlap = False
            for evt_start, evt_end in confirmed_intervals:
                if slot_start_utc < evt_end and slot_end_utc > evt_start:
                    overlap = True
                    break

            if not overlap:
                available_slots.append(_format_utc_iso(slot_start_utc))

            day_slot_start += slot_step

        cur_date += timedelta(days=1)

    formatted_start = start_date_obj.strftime("%Y-%m-%d")
    formatted_end = end_date_obj.strftime("%Y-%m-%d")

    return {
        "user_id": str(user_uuid),
        "date": formatted_start,
        "start_date": formatted_start,
        "end_date": formatted_end,
        "available_slots": available_slots,
        "duration_minutes": duration_minutes,
        "timezone": effective_tz_name,
        "source": "neon_postgres",
    }


async def book_event(
    title: str,
    start_time: str,
    duration_minutes: int = 30,
    attendees: Optional[List[str]] = None,
    description: Optional[str] = None,
    location: Optional[str] = "Google Meet",
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create and schedule a new calendar event with atomic transaction advisory locking.
    Prevents race conditions and double bookings.
    Persists event in calendar_events, integrates with Google Calendar if connected,
    and emits audit task into tasks table.
    """
    user_uuid = _parse_user_uuid(user_id)
    if user_uuid is None:
        return {
            "status": "error",
            "error": "NOT_CONNECTED",
            "message": "Google Calendar is not connected. Please connect your Google Calendar account in the Integrations page to schedule events.",
        }

    start_dt = _parse_iso_datetime(start_time)
    end_dt = start_dt + timedelta(minutes=duration_minutes)
    attendees_list = attendees if attendees is not None else []
    meet_link = f"https://meet.google.com/{uuid.uuid4().hex[:3]}-{uuid.uuid4().hex[:4]}-{uuid.uuid4().hex[:3]}"
    event_id = uuid.uuid4()
    live_booking = None

    logger.info(
        "Attempting atomic booking for user %s: '%s' [%s - %s]",
        user_uuid,
        title,
        _format_utc_iso(start_dt),
        _format_utc_iso(end_dt),
    )

    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Acquire transaction-level advisory lock hashed to this user
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtext('calendar_' || $1::text));",
                str(user_uuid),
            )

            # Query overlapping confirmed events for this user
            conflict_row = await conn.fetchrow(
                """
                SELECT id, title, start_time, end_time, duration_minutes, attendees, meet_link, status
                FROM calendar_events
                WHERE user_id = $1
                  AND status = 'confirmed'
                  AND start_time < $2
                  AND end_time > $3
                ORDER BY start_time ASC
                LIMIT 1
                """,
                user_uuid,
                end_dt,
                start_dt,
            )

            if conflict_row:
                conflicting_event = {
                    "id": str(conflict_row["id"]),
                    "title": conflict_row["title"],
                    "start_time": _format_utc_iso(conflict_row["start_time"]),
                    "end_time": _format_utc_iso(conflict_row["end_time"]),
                    "status": conflict_row["status"],
                }
                next_available_slot = _format_utc_iso(conflict_row["end_time"])
                logger.warning(
                    "Booking conflict for user %s: requested [%s - %s] overlaps with existing '%s' [%s - %s]",
                    user_uuid,
                    _format_utc_iso(start_dt),
                    _format_utc_iso(end_dt),
                    conflict_row["title"],
                    conflicting_event["start_time"],
                    conflicting_event["end_time"],
                )
                return {
                    "status": "conflict",
                    "error": "Slot already occupied",
                    "message": f"Time slot {_format_utc_iso(start_dt)} is already occupied by '{conflict_row['title']}'. Next open time: {next_available_slot}",
                    "conflicting_event": conflicting_event,
                    "next_available_slot": next_available_slot,
                }

            # Attempt live Google Calendar booking if credentials are configured
            if settings.google_client_id and settings.google_client_secret:
                try:
                    live_booking = await book_google_calendar_event(
                        user_id=str(user_uuid),
                        title=title,
                        start_time=_format_utc_iso(start_dt),
                        duration_minutes=duration_minutes,
                        attendees=attendees_list,
                        description=description,
                        location=location,
                    )
                    if live_booking and live_booking.get("meet_link"):
                        meet_link = live_booking["meet_link"]
                except Exception as exc:
                    logger.warning("Live Google Calendar booking failed (%s); continuing with database persistence.", exc)

            # Insert confirmed booking
            row = await conn.fetchrow(
                """
                INSERT INTO calendar_events (
                    id, user_id, title, start_time, end_time, duration_minutes, attendees, meet_link, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed')
                RETURNING id, user_id, title, start_time, end_time, duration_minutes, attendees, meet_link, status, created_at, updated_at
                """,
                event_id,
                user_uuid,
                title,
                start_dt,
                end_dt,
                duration_minutes,
                json.dumps(attendees_list),
                meet_link,
            )

            result_payload = {
                "id": str(row["id"]),
                "event_id": str(row["id"]),
                "title": row["title"],
                "start_time": _format_utc_iso(row["start_time"]),
                "end_time": _format_utc_iso(row["end_time"]),
                "duration_minutes": row["duration_minutes"],
                "attendees": attendees_list,
                "meet_link": row["meet_link"],
                "status": row["status"],
                "source": "google_calendar_live" if live_booking else "neon_postgres",
            }
            if live_booking and live_booking.get("html_link"):
                result_payload["html_link"] = live_booking["html_link"]
            if live_booking and live_booking.get("event_id"):
                result_payload["google_event_id"] = live_booking["event_id"]

            # Record audit event into tasks table
            task_id = uuid.uuid4()
            input_params = {
                "title": title,
                "start_time": _format_utc_iso(start_dt),
                "end_time": _format_utc_iso(end_dt),
                "duration_minutes": duration_minutes,
                "attendees": attendees_list,
                "description": description,
                "location": location,
            }
            await conn.execute(
                """
                INSERT INTO tasks (
                    id, user_id, session_id, title, status, tool_name, input_parameters, output_result
                ) VALUES ($1, $2, $3, $4, 'completed', 'book_event', $5, $6)
                """,
                task_id,
                user_uuid,
                session_id,
                f"Calendar Booking: {title}",
                json.dumps(input_params),
                json.dumps(result_payload),
            )

            logger.info(
                "Successfully booked event %s for user %s: '%s' [%s - %s]",
                event_id,
                user_uuid,
                title,
                result_payload["start_time"],
                result_payload["end_time"],
            )
            return result_payload


async def cancel_event(
    event_id: str,
    reason: Optional[str] = None,
    confirm: bool = False,
    confirmation_token: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Cancel an existing calendar event via soft deletion (status='cancelled', cancelled_at=NOW()).
    Gated by ANE-03 Confirmation Protocol when confirm=False.
    Emits an audit event to the tasks table upon successful cancellation.
    """
    logger.info("Cancelling calendar event '%s' (confirm=%s, user=%s)", event_id, confirm, user_id)

    if not confirm:
        return {
            "status": "confirmation_required",
            "message": f"Confirmation required to cancel event '{event_id}'.",
            "event_id": str(event_id),
        }

    user_uuid = _parse_user_uuid(user_id)
    if user_uuid is None:
        return {
            "status": "error",
            "error": "NOT_CONNECTED",
            "message": "Google Calendar is not connected. Please connect your Google Calendar account in the Integrations page.",
        }
    try:
        event_uuid = uuid.UUID(str(event_id))
    except (ValueError, TypeError):
        return {
            "event_id": str(event_id),
            "id": str(event_id),
            "status": "error",
            "error_message": f"Invalid event ID UUID format: {event_id}",
        }

    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Soft delete confirmed event
            row = await conn.fetchrow(
                """
                UPDATE calendar_events
                SET status = 'cancelled',
                    cancelled_at = NOW()
                WHERE id = $1
                  AND user_id = $2
                  AND status = 'confirmed'
                RETURNING id, title, start_time, end_time, cancelled_at
                """,
                event_uuid,
                user_uuid,
            )

            if not row:
                # Check whether event was already cancelled or never existed
                existing = await conn.fetchrow(
                    "SELECT id, title, status, cancelled_at FROM calendar_events WHERE id = $1 AND user_id = $2",
                    event_uuid,
                    user_uuid,
                )
                if existing and existing["status"] == "cancelled":
                    cancelled_at_str = (
                        _format_utc_iso(existing["cancelled_at"])
                        if existing["cancelled_at"]
                        else _format_utc_iso(datetime.now(dt_timezone.utc))
                    )
                    return {
                        "event_id": str(event_uuid),
                        "id": str(event_uuid),
                        "status": "cancelled",
                        "cancelled_at": cancelled_at_str,
                        "reason": reason,
                        "message": "Event was already cancelled.",
                    }
                return {
                    "event_id": str(event_uuid),
                    "id": str(event_uuid),
                    "status": "error",
                    "error_message": f"Event '{event_id}' not found for user {user_uuid}.",
                }

            cancelled_at_iso = _format_utc_iso(row["cancelled_at"])
            result_payload = {
                "event_id": str(row["id"]),
                "id": str(row["id"]),
                "status": "cancelled",
                "cancelled_at": cancelled_at_iso,
                "reason": reason,
            }

            # Emit audit task into tasks table
            task_id = uuid.uuid4()
            input_params = {
                "event_id": str(event_uuid),
                "reason": reason,
                "confirm": confirm,
            }
            await conn.execute(
                """
                INSERT INTO tasks (
                    id, user_id, session_id, title, status, tool_name, input_parameters, output_result
                ) VALUES ($1, $2, NULL, $3, 'completed', 'cancel_event', $4, $5)
                """,
                task_id,
                user_uuid,
                f"Cancel Calendar Event: {row['title']}",
                json.dumps(input_params),
                json.dumps(result_payload),
            )

            logger.info("Successfully cancelled event %s for user %s: '%s'", event_uuid, user_uuid, row["title"])
            return result_payload


async def list_events(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    timezone: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Return all confirmed calendar events for a user within a date range.
    Used when the user asks 'what meetings do I have today/this week?'.
    Returns the actual booked events, not free slots.
    """
    user_uuid = _parse_user_uuid(user_id)
    if user_uuid is None:
        return {
            "status": "error",
            "error": "NOT_CONNECTED",
            "message": "Google Calendar is not connected. Please connect your Google Calendar account in the Integrations page to view events.",
            "events": [],
            "count": 0,
        }
    logger.info("Fetching confirmed events for user %s (%s to %s)", user_uuid, start_date, end_date)

    pool = await get_db_pool()
    pref_tz = "UTC"

    async with pool.acquire() as conn:
        # Fetch user timezone preference
        pref_row = await conn.fetchrow(
            "SELECT timezone FROM user_preferences WHERE user_id = $1",
            user_uuid,
        )
        if pref_row:
            pref_tz = pref_row["timezone"] or "UTC"

        effective_tz_name = timezone or pref_tz or "UTC"
        try:
            tz = zoneinfo.ZoneInfo(effective_tz_name)
        except Exception:
            tz = dt_timezone.utc
            effective_tz_name = "UTC"

        # Resolve date range
        now_utc = datetime.now(dt_timezone.utc)
        if not start_date:
            start_date_obj = now_utc.astimezone(tz).date()
        else:
            if "T" in start_date:
                start_date_obj = _parse_iso_datetime(start_date).astimezone(tz).date()
            else:
                start_date_obj = datetime.strptime(start_date, "%Y-%m-%d").date()

        if not end_date:
            end_date_obj = start_date_obj
        else:
            if "T" in end_date:
                end_date_obj = _parse_iso_datetime(end_date).astimezone(tz).date()
            else:
                end_date_obj = datetime.strptime(end_date, "%Y-%m-%d").date()

        if end_date_obj < start_date_obj:
            end_date_obj = start_date_obj

        # Build UTC window covering the full day(s)
        range_start_utc = datetime.combine(start_date_obj, dt_time.min).replace(tzinfo=tz).astimezone(dt_timezone.utc)
        range_end_utc = datetime.combine(end_date_obj, dt_time.max).replace(tzinfo=tz).astimezone(dt_timezone.utc)

        rows = await conn.fetch(
            """
            SELECT id, title, start_time, end_time, duration_minutes, attendees, meet_link, status, created_at
            FROM calendar_events
            WHERE user_id = $1
              AND status = 'confirmed'
              AND start_time < $2
              AND end_time > $3
            ORDER BY start_time ASC
            """,
            user_uuid,
            range_end_utc,
            range_start_utc,
        )

        events = []
        for row in rows:
            raw_attendees = row["attendees"]
            if isinstance(raw_attendees, str):
                try:
                    attendees_list = json.loads(raw_attendees)
                except Exception:
                    attendees_list = []
            elif isinstance(raw_attendees, list):
                attendees_list = raw_attendees
            else:
                attendees_list = []

            events.append({
                "id": str(row["id"]),
                "title": row["title"],
                "start_time": _format_utc_iso(row["start_time"]),
                "end_time": _format_utc_iso(row["end_time"]),
                "duration_minutes": row["duration_minutes"],
                "attendees": attendees_list,
                "meet_link": row["meet_link"],
                "status": row["status"],
            })

    return {
        "user_id": str(user_uuid),
        "start_date": start_date_obj.strftime("%Y-%m-%d"),
        "end_date": end_date_obj.strftime("%Y-%m-%d"),
        "timezone": effective_tz_name,
        "count": len(events),
        "events": events,
        "source": "neon_postgres",
    }
