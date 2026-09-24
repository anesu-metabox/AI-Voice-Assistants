"""Tenant-scoped persistence for deferred Google Calendar booking requests."""

from __future__ import annotations

import json
import uuid
from typing import Any

from .connection import get_db_pool


async def create_booking_request(
    *, user_id: str, session_id: str | None, idempotency_key: str,
    payload: dict[str, Any], status: str = "pending", message: str | None = None,
) -> dict[str, Any]:
    if status not in {"pending", "needs_reconnect"}:
        raise ValueError("Invalid initial booking request status")
    company_id = uuid.UUID(user_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", str(company_id))
        row = await conn.fetchrow(
            """INSERT INTO calendar_booking_requests
                   (user_id, session_id, idempotency_key, request_payload, status, error_message)
                 VALUES ($1, $2, $3, $4::jsonb, $5, $6)
                 ON CONFLICT (user_id, idempotency_key) DO UPDATE
                    SET idempotency_key = EXCLUDED.idempotency_key
                 RETURNING id, status, created_at""",
            company_id, session_id, idempotency_key, json.dumps(payload), status, message,
        )
    return {"id": str(row["id"]), "status": row["status"], "created_at": row["created_at"]}


async def get_booking_request(*, request_id: str, user_id: str) -> dict[str, Any] | None:
    company_id = uuid.UUID(user_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", str(company_id))
        row = await conn.fetchrow(
            """SELECT id, user_id, status, result_payload, error_message,
                      attempt_count, created_at, updated_at
                 FROM calendar_booking_requests
                WHERE id = $1 AND user_id = $2""",
            uuid.UUID(request_id), company_id,
        )
    if not row:
        return None
    return {
        "request_id": str(row["id"]), "status": row["status"],
        "result": json.loads(row["result_payload"]) if row["result_payload"] else None,
        "message": row["error_message"], "attempt_count": row["attempt_count"],
        "created_at": row["created_at"], "updated_at": row["updated_at"],
    }


async def list_booking_requests(*, user_id: str, limit: int = 20) -> list[dict[str, Any]]:
    company_id = uuid.UUID(user_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", str(company_id))
        rows = await conn.fetch(
            """SELECT id, request_payload->>'title' AS title, status,
                      result_payload, error_message, attempt_count, created_at, updated_at
                 FROM calendar_booking_requests
                WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
                ORDER BY created_at DESC LIMIT $2""",
            company_id, max(1, min(limit, 50)),
        )
    return [
        {
            "request_id": str(row["id"]), "title": row["title"] or "Calendar booking",
            "status": row["status"],
            "result": json.loads(row["result_payload"]) if row["result_payload"] else None,
            "message": row["error_message"], "attempt_count": row["attempt_count"],
            "created_at": row["created_at"], "updated_at": row["updated_at"],
        }
        for row in rows
    ]


async def cancel_booking_request(*, request_id: str, user_id: str) -> bool:
    company_id = uuid.UUID(user_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", str(company_id))
        result = await conn.execute(
            """UPDATE calendar_booking_requests
                  SET status = 'cancelled', lease_until = NULL,
                      error_message = 'Cancelled by the client.'
                WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'needs_reconnect')""",
            uuid.UUID(request_id), company_id,
        )
    return result != "UPDATE 0"


async def resume_needs_reconnect_bookings(*, user_id: str) -> int:
    company_id = uuid.UUID(user_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", str(company_id))
        result = await conn.execute(
            """UPDATE calendar_booking_requests
                  SET status = 'pending', next_attempt_at = NOW(), lease_until = NULL,
                      error_message = NULL
                WHERE user_id = $1 AND status = 'needs_reconnect'""",
            company_id,
        )
    return int(result.rsplit(" ", 1)[-1])
