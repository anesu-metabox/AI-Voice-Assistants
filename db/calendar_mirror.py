"""Tenant-scoped persistence for the advisory Google Calendar read mirror."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from typing import Any
import uuid

from .connection import get_db_pool


def _company_uuid(company_id: str) -> uuid.UUID:
    return uuid.UUID(str(company_id))


async def get_calendar_sync_state(
    company_id: str, calendar_id: str = "primary"
) -> dict[str, Any] | None:
    company_uuid = _company_uuid(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        row = await conn.fetchrow(
            """SELECT calendar_id, sync_token, last_synced_at, sync_status,
                      last_error_code, updated_at
               FROM calendar_sync_states
               WHERE company_id = $1 AND calendar_id = $2""",
            company_uuid,
            calendar_id,
        )
    return dict(row) if row else None


async def mark_calendar_sync_started(
    company_id: str, calendar_id: str = "primary"
) -> None:
    company_uuid = _company_uuid(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        await conn.execute(
            """INSERT INTO calendar_sync_states (company_id, calendar_id, sync_status)
               VALUES ($1, $2, 'syncing')
               ON CONFLICT (company_id, calendar_id) DO UPDATE
               SET sync_status = 'syncing', last_error_code = NULL, updated_at = NOW()""",
            company_uuid,
            calendar_id,
        )


async def mark_calendar_sync_failed(
    company_id: str,
    error_code: str,
    *,
    needs_full_sync: bool = False,
    calendar_id: str = "primary",
) -> None:
    company_uuid = _company_uuid(company_id)
    status = "needs_full_sync" if needs_full_sync else "failed"
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        await conn.execute(
            """INSERT INTO calendar_sync_states
                   (company_id, calendar_id, sync_status, last_error_code)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (company_id, calendar_id) DO UPDATE
               SET sync_status = EXCLUDED.sync_status,
                   last_error_code = EXCLUDED.last_error_code,
                   sync_token = CASE
                       WHEN EXCLUDED.sync_status = 'needs_full_sync' THEN NULL
                       ELSE calendar_sync_states.sync_token
                   END,
                   updated_at = NOW()""",
            company_uuid,
            calendar_id,
            status,
            error_code[:64],
        )


async def mark_calendar_sync_stale(
    company_id: str, calendar_id: str = "primary"
) -> None:
    """Make the next mirror read reconcile from the existing sync token."""
    company_uuid = _company_uuid(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        await conn.execute(
            """UPDATE calendar_sync_states
               SET sync_status = 'pending', last_synced_at = NULL,
                   last_error_code = NULL, updated_at = NOW()
               WHERE company_id = $1 AND calendar_id = $2""",
            company_uuid,
            calendar_id,
        )


async def commit_calendar_sync(
    company_id: str,
    events: list[dict[str, Any]],
    sync_token: str,
    *,
    full_sync: bool,
    calendar_id: str = "primary",
) -> None:
    """Atomically apply one fully paginated synchronization result."""
    if not sync_token:
        raise ValueError("a completed calendar sync requires nextSyncToken")
    company_uuid = _company_uuid(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        if full_sync:
            await conn.execute(
                "DELETE FROM calendar_event_mirror WHERE company_id = $1 AND calendar_id = $2",
                company_uuid,
                calendar_id,
            )
        for event in events:
            event_id = str(event["event_id"])
            if event.get("status") == "cancelled":
                await conn.execute(
                    """DELETE FROM calendar_event_mirror
                       WHERE company_id = $1 AND calendar_id = $2 AND event_id = $3""",
                    company_uuid,
                    calendar_id,
                    event_id,
                )
                continue
            await conn.execute(
                """INSERT INTO calendar_event_mirror
                       (company_id, calendar_id, event_id, status, start_time,
                        end_time, event_payload, provider_updated_at, mirrored_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW())
                   ON CONFLICT (company_id, calendar_id, event_id) DO UPDATE SET
                       status = EXCLUDED.status,
                       start_time = EXCLUDED.start_time,
                       end_time = EXCLUDED.end_time,
                       event_payload = EXCLUDED.event_payload,
                       provider_updated_at = EXCLUDED.provider_updated_at,
                       mirrored_at = NOW()""",
                company_uuid,
                calendar_id,
                event_id,
                str(event.get("status") or "confirmed"),
                event["start_time"],
                event["end_time"],
                json.dumps(event["event_payload"], separators=(",", ":")),
                event.get("provider_updated_at"),
            )
        await conn.execute(
            """INSERT INTO calendar_sync_states
                   (company_id, calendar_id, sync_token, last_synced_at,
                    sync_status, last_error_code)
               VALUES ($1, $2, $3, NOW(), 'ready', NULL)
               ON CONFLICT (company_id, calendar_id) DO UPDATE
               SET sync_token = EXCLUDED.sync_token,
                   last_synced_at = EXCLUDED.last_synced_at,
                   sync_status = 'ready',
                   last_error_code = NULL,
                   updated_at = NOW()""",
            company_uuid,
            calendar_id,
            sync_token,
        )


async def get_fresh_mirrored_events(
    company_id: str,
    start_time: datetime,
    end_time: datetime,
    *,
    max_staleness_seconds: int,
    calendar_id: str = "primary",
) -> list[dict[str, Any]] | None:
    """Return None for stale/unavailable mirror, otherwise a possibly empty list."""
    company_uuid = _company_uuid(company_id)
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=max_staleness_seconds)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        fresh = await conn.fetchval(
            """SELECT EXISTS (
                   SELECT 1 FROM calendar_sync_states
                   WHERE company_id = $1 AND calendar_id = $2
                     AND sync_status = 'ready' AND last_synced_at >= $3
               )""",
            company_uuid,
            calendar_id,
            cutoff,
        )
        if not fresh:
            return None
        rows = await conn.fetch(
            """SELECT event_payload, start_time, end_time
               FROM calendar_event_mirror
               WHERE company_id = $1 AND calendar_id = $2
                 AND status <> 'cancelled'
                 AND start_time < $4 AND end_time > $3
               ORDER BY start_time""",
            company_uuid,
            calendar_id,
            start_time,
            end_time,
        )
    result: list[dict[str, Any]] = []
    for row in rows:
        payload = row["event_payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        if isinstance(payload, dict):
            item = dict(payload)
            item["_mirror_start_utc"] = row["start_time"].astimezone(timezone.utc).isoformat()
            item["_mirror_end_utc"] = row["end_time"].astimezone(timezone.utc).isoformat()
            result.append(item)
    return result
