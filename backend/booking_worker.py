"""Durable Google Calendar booking recovery worker.

Run as a separate service with BOOKING_WORKER_DATABASE_URL configured for a
dedicated database role that can access only calendar_booking_requests and
bypass RLS solely for claiming cross-tenant queue rows.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import json
import logging
import os
import random
from typing import Any, Awaitable, Callable
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import asyncpg
from fastapi import HTTPException

from backend.app.services.credential_broker_client import broker_post

logger = logging.getLogger("voice_bot.booking_worker")
POLL_SECONDS = 2.0
LEASE_SECONDS = 120
MAX_ATTEMPTS = 8
MAX_BACKOFF_SECONDS = 3600


def retry_delay_seconds(attempt: int, *, random_value: float | None = None) -> float:
    """Bounded exponential retry delay with equal jitter."""
    ceiling = min(30 * (2 ** max(0, attempt - 1)), MAX_BACKOFF_SECONDS)
    sample = random.random() if random_value is None else min(1.0, max(0.0, random_value))
    return ceiling * (0.5 + sample * 0.5)


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


async def claim_one(pool: asyncpg.Pool) -> dict[str, Any] | None:
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """SELECT id, user_id, idempotency_key, request_payload, attempt_count, status
                 FROM calendar_booking_requests
                WHERE (status = 'pending' AND next_attempt_at <= NOW())
                   OR (status = 'running' AND lease_until < NOW())
                   OR (status = 'needs_reconnect' AND next_attempt_at <= NOW())
                ORDER BY next_attempt_at, created_at
                LIMIT 1 FOR UPDATE SKIP LOCKED"""
        )
        if row is None:
            return None
        updated = await conn.fetchrow(
            """UPDATE calendar_booking_requests
                  SET status = 'running',
                      attempt_count = CASE WHEN $2 = 'needs_reconnect' THEN attempt_count ELSE attempt_count + 1 END,
                      lease_until = NOW() + ($3 * INTERVAL '1 second'), error_message = NULL
                WHERE id = $1
                RETURNING id, user_id, idempotency_key, request_payload, attempt_count""",
            row["id"], row["status"], LEASE_SECONDS,
        )
    return {
        "id": str(updated["id"]), "user_id": str(updated["user_id"]),
        "idempotency_key": updated["idempotency_key"],
        "payload": json.loads(updated["request_payload"]),
        "attempt_count": updated["attempt_count"],
        "previous_status": row["status"],
    }


async def _write_result(pool: asyncpg.Pool, job: dict[str, Any], status: str,
                        *, result: dict[str, Any] | None = None,
                        message: str | None = None,
                        delay_seconds: float | None = None) -> None:
    async with pool.acquire() as conn:
        await conn.execute(
            """UPDATE calendar_booking_requests
                  SET status = $2, result_payload = $3::jsonb, error_message = $4,
                      next_attempt_at = COALESCE(NOW() + ($5 * INTERVAL '1 second'), next_attempt_at),
                      lease_until = NULL
                WHERE id = $1""",
            job["id"], status, json.dumps(result) if result is not None else None,
            message, delay_seconds,
        )


async def process_booking_request(
    pool: asyncpg.Pool,
    job: dict[str, Any],
    *,
    provider_call: Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]] = broker_post,
) -> str:
    """Reconcile, recheck the requested slot, and safely attempt the booking."""
    company_id = job["user_id"]
    payload = job["payload"]
    key = job["idempotency_key"]
    common = {"company_id": company_id}

    try:
        existing = await provider_call("/internal/v1/calendar/book-status", common | {"request_key": key})
        if existing.get("status") == "confirmed":
            await _write_result(pool, job, "completed", result=existing)
            return "completed"
        if existing.get("status") == "needs_reconnect":
            await _write_result(pool, job, "needs_reconnect", message="Reconnect the calendar account to finish this booking.", delay_seconds=1800)
            return "needs_reconnect"
        if existing.get("status") == "temporarily_unavailable":
            raise TemporaryProviderFailure

        zone = ZoneInfo(payload["timezone"])
        start = _parse_datetime(payload["start_time"])
        local_day = start.astimezone(zone).date().isoformat()
        availability = await provider_call("/internal/v1/calendar/availability", common | {
            "start_date": local_day, "end_date": local_day,
            "duration_minutes": payload["duration_minutes"],
            "timezone": payload["timezone"],
            "business_hours": payload.get("business_hours"),
        })
        if availability.get("status") == "needs_reconnect":
            await _write_result(pool, job, "needs_reconnect", message="Reconnect the calendar account to finish this booking.", delay_seconds=1800)
            return "needs_reconnect"
        if availability.get("status") == "temporarily_unavailable":
            raise TemporaryProviderFailure
        if availability.get("status") == "failed":
            await _write_result(pool, job, "failed", message="The calendar rejected the availability check. Please submit the booking again.")
            return "failed"

        requested_start = start
        free_slots = availability.get("available_slots", [])
        if not any(_parse_datetime(slot) == requested_start for slot in free_slots):
            await _write_result(
                pool, job, "failed",
                message="That time is no longer available. Please choose another time; no booking was made.",
            )
            return "failed"

        result = await provider_call("/internal/v1/calendar/book", common | {
            "request_key": key,
            "title": payload["title"], "start_time": payload["start_time"],
            "duration_minutes": payload["duration_minutes"],
            "attendees": payload.get("attendees", []),
            "description": payload.get("description"), "location": payload.get("location"),
        })
        if result.get("status") == "confirmed":
            await _write_result(pool, job, "completed", result=result)
            return "completed"
        if result.get("status") == "needs_reconnect":
            await _write_result(pool, job, "needs_reconnect", message="Reconnect the calendar account to finish this booking.", delay_seconds=1800)
            return "needs_reconnect"
        if result.get("status") == "temporarily_unavailable" or result.get("retryable"):
            raise TemporaryProviderFailure
        await _write_result(pool, job, "failed", message="The calendar could not accept the booking. Please choose another time or try again.")
        return "failed"
    except TemporaryProviderFailure:
        attempt = job["attempt_count"]
        if attempt >= MAX_ATTEMPTS:
            await _write_result(pool, job, "failed", message="The calendar remained unavailable. Please contact us to complete this booking.")
            return "failed"
        delay = retry_delay_seconds(attempt)
        await _write_result(
            pool, job, "pending", message="Calendar temporarily unavailable; retry scheduled.",
            delay_seconds=delay,
        )
        return "pending"
    except HTTPException as exc:
        if exc.status_code < 500:
            await _write_result(
                pool, job, "failed",
                message="The calendar worker is not authorized to contact the calendar service. Please contact support.",
            )
            return "failed"
        attempt = job["attempt_count"]
        if attempt >= MAX_ATTEMPTS:
            await _write_result(pool, job, "failed", message="The calendar remained unavailable. Please contact us to complete this booking.")
            return "failed"
        await _write_result(
            pool, job, "pending", message="Calendar temporarily unavailable; retry scheduled.",
            delay_seconds=retry_delay_seconds(attempt),
        )
        return "pending"
    except Exception as exc:
        logger.error("Booking job failed (error_type=%s)", type(exc).__name__)
        attempt = job["attempt_count"]
        if attempt >= MAX_ATTEMPTS:
            await _write_result(pool, job, "failed", message="The booking could not be completed. Please contact us.")
            return "failed"
        await _write_result(
            pool, job, "pending", message="Booking service temporarily unavailable; retry scheduled.",
            delay_seconds=retry_delay_seconds(attempt),
        )
        return "pending"


class TemporaryProviderFailure(Exception):
    pass


async def run_worker() -> None:
    from dotenv import load_dotenv
    load_dotenv()
    database_url = os.getenv("BOOKING_WORKER_DATABASE_URL", "").strip()
    branch = os.getenv("NEON_BRANCH", "").strip()
    expected_role = os.getenv("BOOKING_WORKER_DB_ROLE", "calendar_booking_worker").strip()
    if not database_url or not branch:
        raise RuntimeError("BOOKING_WORKER_DATABASE_URL and NEON_BRANCH are required")
    from db.connection import assert_database_branch_is_safe
    assert_database_branch_is_safe()
    parsed = urlsplit(database_url)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        raise RuntimeError("BOOKING_WORKER_DATABASE_URL must be a PostgreSQL URL")
    clean_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    pool = await asyncpg.create_pool(
        dsn=clean_url, ssl="require", min_size=1, max_size=4,
        command_timeout=15, statement_cache_size=0,
    )
    async with pool.acquire() as conn:
        role = await conn.fetchrow(
            """SELECT current_user = $1 AS role_matches,
                      r.rolsuper, r.rolbypassrls, r.rolinherit,
                      has_table_privilege(current_user, 'public.calendar_booking_requests', 'SELECT') AS can_read_queue,
                      has_column_privilege(current_user, 'public.calendar_booking_requests', 'status', 'UPDATE') AS can_update_queue,
                      has_column_privilege(current_user, 'public.calendar_booking_requests', 'user_id', 'UPDATE') AS can_change_tenant,
                      EXISTS (
                        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
                           AND c.relname <> 'calendar_booking_requests'
                           AND (has_table_privilege(current_user, c.oid, 'SELECT')
                             OR has_table_privilege(current_user, c.oid, 'INSERT')
                             OR has_table_privilege(current_user, c.oid, 'UPDATE')
                             OR has_table_privilege(current_user, c.oid, 'DELETE'))
                      ) AS has_other_public_table_access
                 FROM pg_roles r WHERE r.rolname = current_user""",
            expected_role,
        )
        if (
            role is None or not role["role_matches"] or role["rolsuper"]
            or not role["rolbypassrls"] or role["rolinherit"]
            or not role["can_read_queue"] or not role["can_update_queue"]
            or role["can_change_tenant"] or role["has_other_public_table_access"]
        ):
            await pool.close()
            raise RuntimeError("Database identity is not the restricted booking worker role")
    logger.info("Calendar booking worker started")
    try:
        while True:
            job = await claim_one(pool)
            if job is None:
                await asyncio.sleep(POLL_SECONDS)
                continue
            await process_booking_request(pool, job)
    finally:
        await pool.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    asyncio.run(run_worker())
