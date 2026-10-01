"""
Google Calendar API v3 Async Service
Direct REST integration for calendar availability and event creation with Google Meet support.
Runs asynchronously via httpx to maintain the sub-400ms Fast Lane voice latency budget.
"""

import asyncio
from datetime import date, datetime, time, timedelta, timezone
import logging
from typing import Any, Dict, List, Mapping, Optional
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from .google_oauth import get_valid_access_token
from .http_client import get_http_client
from .calendar_read_cache import CALENDAR_READ_CACHE
from ..config import settings

logger = logging.getLogger("voice_bot.services.google_calendar")

GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3"
DEFAULT_COMPANY_TIMEZONE = "Indian/Mauritius"
MAX_VOICE_CALENDAR_EVENTS = 50
_mirror_sync_locks: dict[str, asyncio.Lock] = {}
_mirror_sync_locks_guard = asyncio.Lock()
_active_mirror_companies: dict[str, tuple[str, float]] = {}
_active_mirror_companies_lock = asyncio.Lock()
_MAX_ACTIVE_MIRROR_COMPANIES = 512


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


def _mirror_event_record(
    event: Dict[str, Any], timezone_name: str
) -> dict[str, Any] | None:
    """Build the bounded event record persisted by the local read mirror."""
    event_id = str(event.get("id") or "").strip()
    status = "cancelled" if event.get("status") == "cancelled" else "confirmed"
    if not event_id:
        return None
    if status == "cancelled":
        return {"event_id": event_id, "status": status}

    start = event.get("start") or {}
    end = event.get("end") or {}
    start_value = start.get("dateTime") or start.get("date")
    end_value = end.get("dateTime") or end.get("date")
    if not start_value or not end_value:
        return None
    try:
        zone = _company_zone(timezone_name)
        if len(start_value) == 10:
            start_dt = datetime.combine(date.fromisoformat(start_value), time.min, tzinfo=zone)
        else:
            start_dt = datetime.fromisoformat(start_value.replace("Z", "+00:00"))
            if start_dt.tzinfo is None:
                start_dt = start_dt.replace(tzinfo=zone)
        if len(end_value) == 10:
            end_dt = datetime.combine(date.fromisoformat(end_value), time.min, tzinfo=zone)
        else:
            end_dt = datetime.fromisoformat(end_value.replace("Z", "+00:00"))
            if end_dt.tzinfo is None:
                end_dt = end_dt.replace(tzinfo=zone)
        if end_dt <= start_dt:
            return None
    except (TypeError, ValueError):
        return None

    updated_at = None
    if event.get("updated"):
        try:
            updated_at = datetime.fromisoformat(str(event["updated"]).replace("Z", "+00:00"))
        except ValueError:
            updated_at = None
    return {
        "event_id": event_id,
        "status": status,
        "start_time": start_dt.astimezone(timezone.utc),
        "end_time": end_dt.astimezone(timezone.utc),
        "event_payload": _calendar_event_payload(event),
        "provider_updated_at": updated_at,
    }


async def _mirror_sync_lock(company_id: str) -> asyncio.Lock:
    async with _mirror_sync_locks_guard:
        return _mirror_sync_locks.setdefault(company_id, asyncio.Lock())


async def note_active_calendar_company(
    company_id: str, timezone_name: str = DEFAULT_COMPANY_TIMEZONE
) -> None:
    """Remember recently used tenants without requiring cross-tenant DB access."""
    _company_zone(timezone_name)
    async with _active_mirror_companies_lock:
        _active_mirror_companies[company_id] = (timezone_name, asyncio.get_running_loop().time())
        while len(_active_mirror_companies) > _MAX_ACTIVE_MIRROR_COMPANIES:
            oldest = min(_active_mirror_companies, key=lambda key: _active_mirror_companies[key][1])
            _active_mirror_companies.pop(oldest, None)


async def reconcile_active_calendar_mirrors_once(
    *, now_monotonic: float | None = None
) -> dict[str, int]:
    """Refresh recently used tenant mirrors with bounded concurrency."""
    now = asyncio.get_running_loop().time() if now_monotonic is None else now_monotonic
    cutoff = now - settings.calendar_mirror_active_tenant_ttl_seconds
    async with _active_mirror_companies_lock:
        stale_ids = [
            company_id
            for company_id, (_timezone_name, last_seen) in _active_mirror_companies.items()
            if last_seen < cutoff
        ]
        for company_id in stale_ids:
            _active_mirror_companies.pop(company_id, None)
        active = list(_active_mirror_companies.items())

    semaphore = asyncio.Semaphore(4)

    async def reconcile(company_id: str, timezone_name: str) -> bool:
        async with semaphore:
            return await sync_google_calendar_mirror(
                company_id,
                timezone_name=timezone_name,
                register_active=False,
            )

    results = await asyncio.gather(
        *(reconcile(company_id, timezone_name) for company_id, (timezone_name, _seen) in active),
        return_exceptions=True,
    )
    succeeded = sum(result is True for result in results)
    return {"active": len(active), "succeeded": succeeded, "failed": len(active) - succeeded}


async def clear_active_calendar_companies() -> None:
    """Lifecycle/test hook for the in-process active-tenant registry."""
    async with _active_mirror_companies_lock:
        _active_mirror_companies.clear()


async def sync_google_calendar_mirror(
    user_id: str,
    *,
    timezone_name: str = DEFAULT_COMPANY_TIMEZONE,
    force_full: bool = False,
    register_active: bool = True,
) -> bool:
    """Apply a fully paginated Google incremental sync to the tenant mirror."""
    from db.calendar_mirror import (
        commit_calendar_sync,
        get_calendar_sync_state,
        mark_calendar_sync_failed,
        mark_calendar_sync_started,
    )

    if register_active:
        await note_active_calendar_company(user_id, timezone_name)
    lock = await _mirror_sync_lock(user_id)
    async with lock:
        state = await get_calendar_sync_state(user_id)
        if state and state.get("sync_status") == "ready" and not force_full:
            last_synced = state.get("last_synced_at")
            if isinstance(last_synced, datetime) and last_synced >= (
                datetime.now(timezone.utc)
                - timedelta(seconds=settings.calendar_mirror_max_staleness_seconds)
            ):
                return True

        access_token = await get_valid_access_token(user_id)
        if not access_token:
            await mark_calendar_sync_failed(user_id, "GOOGLE_CALENDAR_REAUTH_REQUIRED")
            return False

        sync_token = (
            None
            if force_full or (state or {}).get("sync_status") == "needs_full_sync"
            else (state or {}).get("sync_token")
        )
        await mark_calendar_sync_started(user_id)
        events: list[dict[str, Any]] = []
        page_token: str | None = None
        next_sync_token: str | None = None
        for _page in range(100):
            params: dict[str, str] = {
                "showDeleted": "true",
                "singleEvents": "true",
                "maxResults": "2500",
            }
            if sync_token:
                params["syncToken"] = str(sync_token)
            else:
                params["timeMin"] = (
                    datetime.now(timezone.utc) - timedelta(days=30)
                ).isoformat()
            if page_token:
                params["pageToken"] = page_token
            try:
                response = await get_http_client().get(
                    f"{GOOGLE_CALENDAR_API_BASE}/calendars/primary/events",
                    headers={"Authorization": f"Bearer {access_token}"},
                    params=params,
                )
            except httpx.HTTPError:
                await mark_calendar_sync_failed(user_id, "GOOGLE_CALENDAR_UNAVAILABLE")
                return False
            if response.status_code == 410:
                await mark_calendar_sync_failed(
                    user_id, "GOOGLE_SYNC_TOKEN_GONE", needs_full_sync=True
                )
                return False
            if response.status_code in (401, 403):
                await mark_calendar_sync_failed(user_id, "GOOGLE_CALENDAR_REAUTH_REQUIRED")
                return False
            if response.status_code != 200:
                await mark_calendar_sync_failed(user_id, "GOOGLE_CALENDAR_UNAVAILABLE")
                return False
            data = response.json()
            for event in data.get("items", []):
                if not isinstance(event, dict):
                    continue
                record = _mirror_event_record(event, timezone_name)
                if record:
                    events.append(record)
            page_token = data.get("nextPageToken")
            next_sync_token = data.get("nextSyncToken") or next_sync_token
            if not page_token:
                break
        if page_token or not next_sync_token:
            await mark_calendar_sync_failed(user_id, "GOOGLE_SYNC_INCOMPLETE")
            return False
        await commit_calendar_sync(
            user_id,
            events,
            str(next_sync_token),
            full_sync=not bool(sync_token),
        )
        return True


async def _fresh_mirror_events(
    user_id: str,
    start_date: str | None,
    end_date: str | None,
    timezone_name: str,
) -> tuple[list[dict[str, Any]], date, date] | None:
    from db.calendar_mirror import get_fresh_mirrored_events

    start_utc, end_utc, start_day, end_day = _local_date_range_utc(
        start_date, end_date, timezone_name
    )
    try:
        events = await get_fresh_mirrored_events(
            user_id,
            start_utc,
            end_utc,
            max_staleness_seconds=settings.calendar_mirror_max_staleness_seconds,
        )
        if events is None:
            synced = await sync_google_calendar_mirror(
                user_id, timezone_name=timezone_name
            )
            if not synced:
                return None
            events = await get_fresh_mirrored_events(
                user_id,
                start_utc,
                end_utc,
                max_staleness_seconds=settings.calendar_mirror_max_staleness_seconds,
            )
    except Exception as exc:
        logger.warning("Calendar mirror unavailable; using live provider (error_type=%s)", type(exc).__name__)
        return None
    if events is None:
        return None
    return events, start_day, end_day


async def _list_google_calendar_events_live(
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
            # Fetch one sentinel beyond the voice response limit so callers know
            # whether the compact result was truncated without transferring an
            # unbounded calendar into the realtime turn.
            "maxResults": str(MAX_VOICE_CALENDAR_EVENTS + 1),
            "timeZone": str(_company_zone(timezone_name)),
        },
    )
    if response.status_code != 200:
        logger.error("Google Calendar event list failed: %s", response.status_code)
        return None

    provider_events = [
        _calendar_event_payload(event)
        for event in response.json().get("items", [])
        if event.get("status") != "cancelled"
    ]
    truncated = len(provider_events) > MAX_VOICE_CALENDAR_EVENTS
    events = provider_events[:MAX_VOICE_CALENDAR_EVENTS]
    return {
        "user_id": str(user_id),
        "start_date": start_day.isoformat(),
        "end_date": end_day.isoformat(),
        "timezone": str(_company_zone(timezone_name)),
        "count": len(events),
        "events": events,
        "truncated": truncated,
        "source": "google_calendar_live",
    }


async def list_google_calendar_events(
    user_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    timezone_name: str = DEFAULT_COMPANY_TIMEZONE,
) -> Optional[Dict[str, Any]]:
    if settings.calendar_mirror_enabled:
        await note_active_calendar_company(user_id, timezone_name)
    key = (user_id, "list", start_date or "", end_date or "", timezone_name)

    async def load() -> Optional[Dict[str, Any]]:
        if settings.calendar_mirror_enabled:
            mirrored = await _fresh_mirror_events(
                user_id, start_date, end_date, timezone_name
            )
            if mirrored is not None:
                events, start_day, end_day = mirrored
                all_public_events = [
                    {key: value for key, value in event.items() if not key.startswith("_mirror_")}
                    for event in events
                ]
                public_events = all_public_events[:MAX_VOICE_CALENDAR_EVENTS]
                return {
                    "user_id": str(user_id),
                    "start_date": start_day.isoformat(),
                    "end_date": end_day.isoformat(),
                    "timezone": str(_company_zone(timezone_name)),
                    "count": len(public_events),
                    "events": public_events,
                    "truncated": len(all_public_events) > MAX_VOICE_CALENDAR_EVENTS,
                    "source": "google_calendar_mirror",
                }
        return await _list_google_calendar_events_live(
            user_id, start_date, end_date, timezone_name
        )

    return await CALENDAR_READ_CACHE.get_or_load(
        key,
        ttl_seconds=settings.calendar_events_cache_ttl_seconds,
        loader=load,
    )


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
    await CALENDAR_READ_CACHE.invalidate_company(user_id)
    await _mark_calendar_mirror_stale_after_write(user_id)
    return True


async def _get_google_calendar_availability_live(
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


async def get_google_calendar_availability(
    user_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    duration_minutes: int = 30,
    timezone_name: str = DEFAULT_COMPANY_TIMEZONE,
    business_hours: Mapping[str, str] | None = None,
    force_live: bool = False,
) -> Optional[Dict[str, Any]]:
    if settings.calendar_mirror_enabled:
        await note_active_calendar_company(user_id, timezone_name)
    if force_live:
        return await _get_google_calendar_availability_live(
            user_id,
            start_date,
            end_date,
            duration_minutes,
            timezone_name,
            business_hours,
        )
    normalized_hours = tuple(
        sorted((str(day).lower(), str(hours)) for day, hours in (business_hours or {}).items())
    )
    key = (
        user_id,
        "availability",
        start_date or "",
        end_date or "",
        timezone_name,
        duration_minutes,
        normalized_hours,
    )

    async def load() -> Optional[Dict[str, Any]]:
        if settings.calendar_mirror_enabled:
            mirrored = await _fresh_mirror_events(
                user_id, start_date, end_date, timezone_name
            )
            if mirrored is not None:
                events, start_day, end_day = mirrored
                busy_periods = [
                    {"start": event["_mirror_start_utc"], "end": event["_mirror_end_utc"]}
                    for event in events
                ]
                return {
                    "user_id": str(user_id),
                    "date": start_day.isoformat(),
                    "start_date": start_day.isoformat(),
                    "end_date": end_day.isoformat(),
                    "available_slots": _compute_free_slots(
                        start_day.isoformat(),
                        busy_periods,
                        duration_minutes,
                        timezone_name,
                        business_hours,
                    ),
                    "duration_minutes": duration_minutes,
                    "timezone": str(_company_zone(timezone_name)),
                    "source": "google_calendar_mirror",
                }
        return await _get_google_calendar_availability_live(
            user_id,
            start_date,
            end_date,
            duration_minutes,
            timezone_name,
            business_hours,
        )

    return await CALENDAR_READ_CACHE.get_or_load(
        key,
        ttl_seconds=settings.calendar_availability_cache_ttl_seconds,
        loader=load,
    )


async def check_google_calendar_interval_free(
    user_id: str,
    start_time: str,
    duration_minutes: int,
) -> Dict[str, Any]:
    """Perform an uncached provider check immediately before a write."""
    access_token = await get_valid_access_token(user_id)
    if not access_token:
        return {"status": "needs_reconnect", "error_code": "GOOGLE_CALENDAR_REAUTH_REQUIRED"}
    try:
        start_dt = datetime.fromisoformat(str(start_time).replace("Z", "+00:00"))
        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)
        start_dt = start_dt.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return {"status": "failed", "retryable": False}
    end_dt = start_dt + timedelta(minutes=duration_minutes)
    try:
        response = await get_http_client().post(
            f"{GOOGLE_CALENDAR_API_BASE}/freeBusy",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json={
                "timeMin": start_dt.isoformat(),
                "timeMax": end_dt.isoformat(),
                "timeZone": "UTC",
                "items": [{"id": "primary"}],
            },
        )
    except httpx.HTTPError:
        return {"status": "temporarily_unavailable", "retryable": True}
    if response.status_code in (401, 403):
        return {"status": "needs_reconnect", "error_code": "GOOGLE_CALENDAR_REAUTH_REQUIRED"}
    if response.status_code == 429 or response.status_code >= 500:
        return {"status": "temporarily_unavailable", "retryable": True}
    if response.status_code != 200:
        return {"status": "failed", "retryable": False}
    busy = response.json().get("calendars", {}).get("primary", {}).get("busy", [])
    return {"status": "conflict" if busy else "available"}


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


async def _mark_calendar_mirror_stale_after_write(user_id: str) -> None:
    if not settings.calendar_mirror_enabled:
        return
    try:
        from db.calendar_mirror import mark_calendar_sync_stale

        await mark_calendar_sync_stale(user_id)
    except Exception as exc:
        # Provider writes remain authoritative. A failed advisory invalidation
        # must not turn a confirmed Google write into a reported failure.
        logger.warning(
            "Calendar mirror invalidation failed after provider write (error_type=%s)",
            type(exc).__name__,
        )


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

        result = {
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
        await CALENDAR_READ_CACHE.invalidate_company(user_id)
        await _mark_calendar_mirror_stale_after_write(user_id)
        return result
    except httpx.HTTPError as exc:
        logger.error("Google Calendar booking operation failed (%s)", type(exc).__name__)
        return {"status": "temporarily_unavailable", "retryable": True}

