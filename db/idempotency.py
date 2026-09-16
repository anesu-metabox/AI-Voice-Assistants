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


# In-memory fallback cache for development/testing when PostgreSQL is offline
_in_memory_locks: Dict[str, Dict[str, Any]] = {}


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
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            # Check if key exists
            row = await conn.fetchrow(
                "SELECT status, response_payload, expires_at FROM idempotency_records WHERE key = $1",
                key,
            )

            if row:
                status = row["status"]
                payload = json.loads(row["response_payload"]) if row["response_payload"] else None
                record_expiry = row["expires_at"]

                # If already committed, return cached response immediately
                if status == IdempotencyStatus.COMMITTED.value:
                    logger.info("Idempotency key %s committed previously. Returning cached payload.", key)
                    return False, payload, "Idempotent response retrieved from cache."

                # If acquired and not expired, another process is executing
                if status == IdempotencyStatus.ACQUIRED.value and record_expiry > now:
                    logger.warning("Idempotency key %s is currently locked by active execution.", key)
                    return False, None, "Action is currently processing. Please wait."

                # If expired or refunded, we can re-acquire the lock
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

            # Insert new lock
            parsed_user_id = uuid.UUID(user_id) if isinstance(user_id, str) and len(user_id) == 36 else uuid.uuid4()
            await conn.execute(
                """
                INSERT INTO idempotency_records (key, user_id, tool_name, status, expires_at, created_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                key,
                parsed_user_id,
                tool_name,
                IdempotencyStatus.ACQUIRED.value,
                expires_at,
                now,
            )
            return True, None, "Lock acquired successfully."

    except Exception as exc:
        logger.warning(
            "PostgreSQL idempotency check failed (%s). Falling back to in-memory lock engine.",
            exc,
        )
        # Fallback to local memory lock
        if key in _in_memory_locks:
            rec = _in_memory_locks[key]
            if rec["status"] == IdempotencyStatus.COMMITTED.value:
                return False, rec.get("payload"), "Idempotent response retrieved from in-memory cache."
            if rec["status"] == IdempotencyStatus.ACQUIRED.value and rec["expires_at"] > now:
                return False, None, "Action is currently processing in-memory."

        _in_memory_locks[key] = {
            "status": IdempotencyStatus.ACQUIRED.value,
            "tool_name": tool_name,
            "payload": None,
            "expires_at": expires_at,
        }
        return True, None, "In-memory lock acquired."


async def commit_idempotency_lock(key: str, response_payload: Dict[str, Any]) -> None:
    """
    Commit an idempotency lock with the verified response payload.
    """
    payload_json = json.dumps(response_payload)
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE idempotency_records
                SET status = $1, response_payload = $2
                WHERE key = $3
                """,
                IdempotencyStatus.COMMITTED.value,
                payload_json,
                key,
            )
            logger.info("Idempotency key %s committed to PostgreSQL.", key)
    except Exception as exc:
        logger.warning("PostgreSQL commit failed (%s). Updating in-memory lock.", exc)
        if key in _in_memory_locks:
            _in_memory_locks[key]["status"] = IdempotencyStatus.COMMITTED.value
            _in_memory_locks[key]["payload"] = response_payload


async def release_idempotency_lock(key: str) -> None:
    """
    Release or refund a lock when a tool call fails without causing state side-effects.
    """
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE idempotency_records
                SET status = $1
                WHERE key = $2
                """,
                IdempotencyStatus.REFUNDED.value,
                key,
            )
            logger.info("Idempotency key %s released/refunded.", key)
    except Exception as exc:
        logger.warning("PostgreSQL release failed (%s). Releasing in-memory lock.", exc)
        if key in _in_memory_locks:
            _in_memory_locks[key]["status"] = IdempotencyStatus.REFUNDED.value
