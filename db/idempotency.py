"""
Distributed Idempotency Engine
Enforces the Zero Duplication Guarantee (ADR-004) to prevent duplicate actions on network disconnects.
"""

from datetime import datetime, timedelta, timezone
from enum import Enum
import json
import logging
from typing import Any, Dict, Optional, Tuple
import uuid

from .connection import get_db_pool

logger = logging.getLogger("voice_bot.idempotency")


class IdempotencyStatus(str, Enum):
    ACQUIRED = "acquired"
    COMMITTED = "committed"
    REFUNDED = "refunded"


async def acquire_idempotency_lock(
    key: str,
    user_id: str,
    tool_name: str,
    ttl_seconds: int = 60,
) -> Tuple[bool, Optional[Dict[str, Any]], str]:
    """
    Attempt to acquire an idempotency lock for a tool execution.

    Returns:
        Tuple of (is_new_execution, cached_response_payload, message)
        - If is_new_execution is True: The caller can proceed with tool execution.
        - If is_new_execution is False and cached_response_payload is present: Cached result from previous run.
        - If is_new_execution is False and cached_response_payload is None: Another run is actively in-progress.
    """
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=ttl_seconds)

    try:
        parsed_user_id = uuid.UUID(user_id)
        pool = await get_db_pool()
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", str(parsed_user_id))
            # Serialize inspection and acquisition on the key. This avoids the
            # SELECT-then-INSERT race that previously surfaced as UniqueViolation.
            async with conn.transaction():
                await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", key)
                row = await conn.fetchrow(
                    """
                    SELECT status, response_payload, expires_at
                      FROM idempotency_records
                     WHERE key = $1
                     FOR UPDATE
                    """,
                    key,
                )

                if row:
                    status = row["status"]
                    payload = json.loads(row["response_payload"]) if row["response_payload"] else None
                    record_expiry = row["expires_at"]

                    if status == IdempotencyStatus.COMMITTED.value:
                        logger.info("Committed idempotency record found; returning cached payload.")
                        return False, payload, "Idempotent response retrieved from cache."

                    if status == IdempotencyStatus.ACQUIRED.value and record_expiry > now:
                        logger.warning("Idempotency record is currently locked by active execution.")
                        return False, None, "Action is currently processing. Please wait."

                    await conn.execute(
                        """
                        UPDATE idempotency_records
                           SET status = $1, response_payload = NULL, expires_at = $2, created_at = $3
                         WHERE key = $4
                        """,
                        IdempotencyStatus.ACQUIRED.value,
                        expires_at,
                        now,
                        key,
                    )
                    return True, None, "Lock re-acquired after expiration or refund."

                insert_result = await conn.execute(
                    """
                    INSERT INTO idempotency_records (key, user_id, tool_name, status, expires_at, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (key) DO NOTHING
                    """,
                    key,
                    parsed_user_id,
                    tool_name,
                    IdempotencyStatus.ACQUIRED.value,
                    expires_at,
                    now,
                )
                if insert_result.endswith(" 0"):
                    return False, None, "Idempotency key is already owned by another tenant."
                return True, None, "Lock acquired successfully."

    except Exception as exc:
        logger.error("PostgreSQL idempotency check failed (error_type=%s)", type(exc).__name__)
        raise RuntimeError("idempotency service unavailable") from exc


async def commit_idempotency_lock(key: str, response_payload: Dict[str, Any], user_id: str) -> None:
    """
    Commit an idempotency lock with the verified response payload.
    """
    payload_json = json.dumps(response_payload)
    try:
        parsed_user_id = uuid.UUID(user_id)
        pool = await get_db_pool()
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", str(parsed_user_id))
            await conn.execute(
                """
                UPDATE idempotency_records
                SET status = $1, response_payload = $2
                WHERE key = $3 AND user_id = $4
                """,
                IdempotencyStatus.COMMITTED.value,
                payload_json,
                key,
                parsed_user_id,
            )
            logger.info("Idempotency record committed to PostgreSQL.")
    except Exception as exc:
        logger.error("PostgreSQL idempotency commit failed (error_type=%s)", type(exc).__name__)
        raise RuntimeError("idempotency service unavailable") from exc


async def release_idempotency_lock(key: str, user_id: str) -> None:
    """
    Release or refund a lock when a tool call fails without causing state side-effects.
    """
    try:
        parsed_user_id = uuid.UUID(user_id)
        pool = await get_db_pool()
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", str(parsed_user_id))
            await conn.execute(
                """
                UPDATE idempotency_records
                SET status = $1
                WHERE key = $2 AND user_id = $3
                """,
                IdempotencyStatus.REFUNDED.value,
                key,
                parsed_user_id,
            )
            logger.info("Idempotency record released/refunded.")
    except Exception as exc:
        logger.error("PostgreSQL idempotency release failed (error_type=%s)", type(exc).__name__)
        raise RuntimeError("idempotency service unavailable") from exc
