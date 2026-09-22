"""Tenant-scoped, database-backed budgets for expensive integration actions."""

from __future__ import annotations

import uuid

from .connection import get_db_pool


async def consume_integration_action_budget(
    *,
    company_id: str,
    action: str,
    limit: int,
    window_seconds: int,
) -> int | None:
    """Consume one attempt; return Retry-After seconds when the budget is exhausted.

    The single-row upsert is atomic across API workers and stores no request
    payload, IP address, credential, or transcript. Caller identity is always
    the verified company context.
    """
    if action not in {"threecx_test", "threecx_save"}:
        raise ValueError("unsupported integration action budget")
    if not 1 <= limit <= 100 or not 60 <= window_seconds <= 86_400:
        raise ValueError("integration action budget is outside safe bounds")

    company_uuid = uuid.UUID(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "SELECT set_config('app.company_id', $1, true)", str(company_uuid)
            )
            consumed = await conn.fetchrow(
                """INSERT INTO integration_action_limits
                     (company_id, action, window_started_at, attempt_count, updated_at)
                   VALUES ($1, $2, NOW(), 1, NOW())
                   ON CONFLICT (company_id, action) DO UPDATE SET
                     window_started_at = CASE
                       WHEN integration_action_limits.window_started_at
                            <= NOW() - ($4::DOUBLE PRECISION * INTERVAL '1 second')
                       THEN NOW() ELSE integration_action_limits.window_started_at END,
                     attempt_count = CASE
                       WHEN integration_action_limits.window_started_at
                            <= NOW() - ($4::DOUBLE PRECISION * INTERVAL '1 second')
                       THEN 1 ELSE integration_action_limits.attempt_count + 1 END,
                     updated_at = NOW()
                   WHERE integration_action_limits.window_started_at
                           <= NOW() - ($4::DOUBLE PRECISION * INTERVAL '1 second')
                      OR integration_action_limits.attempt_count < $3
                   RETURNING attempt_count""",
                company_uuid,
                action,
                limit,
                window_seconds,
            )
            if consumed:
                return None

            retry = await conn.fetchval(
                """SELECT GREATEST(
                         1,
                         CEIL(EXTRACT(EPOCH FROM
                           window_started_at + ($3::DOUBLE PRECISION * INTERVAL '1 second') - NOW())
                         )::INTEGER
                       )
                   FROM integration_action_limits
                   WHERE company_id = $1 AND action = $2""",
                company_uuid,
                action,
                window_seconds,
            )
            if retry is None:
                raise RuntimeError("integration action budget row disappeared")
            return int(retry)
