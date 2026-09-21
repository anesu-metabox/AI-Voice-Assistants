"""Database-backed, single-use confirmation tokens for destructive actions."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
import logging
import secrets
from typing import Any, Optional

from .connection import get_db_pool

logger = logging.getLogger("voice_bot.confirmation")


def canonical_parameters(parameters: dict[str, Any]) -> str:
    return json.dumps(parameters, sort_keys=True, separators=(",", ":"), default=str)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def issue_confirmation_token(
    *,
    user_id: str,
    tool_name: str,
    event_id: str,
    parameters: dict[str, Any],
    ttl_seconds: int = 300,
) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO confirmation_tokens
                (token_hash, user_id, tool_name, event_id, parameters, expires_at)
            VALUES ($1, $2::uuid, $3, $4, $5::jsonb, $6)
            """,
            hash_token(token),
            user_id,
            tool_name,
            event_id,
            canonical_parameters(parameters),
            expires_at,
        )
    return token, expires_at


async def consume_confirmation_token(
    *,
    token: str,
    user_id: str,
    tool_name: str,
    event_id: str,
    parameters: dict[str, Any],
) -> tuple[bool, str]:
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE confirmation_tokens
               SET consumed_at = NOW()
             WHERE token_hash = $1
               AND user_id = $2::uuid
               AND tool_name = $3
               AND event_id = $4
               AND parameters = $5::jsonb
               AND consumed_at IS NULL
               AND expires_at > NOW()
         RETURNING token_hash
            """,
            hash_token(token),
            user_id,
            tool_name,
            event_id,
            canonical_parameters(parameters),
        )
    if row:
        return True, "Confirmation accepted."
    return False, "Confirmation token is invalid, expired, already used, or does not match the requested action."
