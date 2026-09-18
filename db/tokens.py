"""
OAuth Tokens Database Repository
Manages durable storage, retrieval, and updates of OAuth credentials in Neon PostgreSQL.
"""

from datetime import datetime, timezone
import logging
from typing import Any, Dict, Optional
import uuid

from .connection import get_db_pool

logger = logging.getLogger("voice_bot.db.tokens")


def _parse_user_uuid(user_id: Any) -> uuid.UUID:
    if isinstance(user_id, uuid.UUID):
        return user_id
    try:
        return uuid.UUID(str(user_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError(f"Invalid user_id UUID format: '{user_id}'") from exc


async def save_oauth_tokens(
    user_id: str,
    provider: str,
    access_token: str,
    expires_at: datetime,
    refresh_token: Optional[str] = None,
    token_type: str = "Bearer",
    scope: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Persist or update OAuth tokens for a specific user and provider.
    Uses ON CONFLICT DO UPDATE to preserve existing refresh_token if a new one is not supplied.
    """
    user_uuid = _parse_user_uuid(user_id)

    # Ensure expires_at has timezone
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    query = """
    INSERT INTO oauth_tokens (
        user_id, provider, access_token, refresh_token, token_type, scope, expires_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (user_id, provider) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
        token_type = EXCLUDED.token_type,
        scope = COALESCE(EXCLUDED.scope, oauth_tokens.scope),
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
    RETURNING id, user_id, provider, token_type, expires_at, scope, updated_at;
    """

    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            query,
            user_uuid,
            provider,
            access_token,
            refresh_token,
            token_type,
            scope,
            expires_at,
        )
        logger.info("Persisted OAuth tokens for user %s (provider: %s)", user_uuid, provider)
        return dict(row)


async def get_oauth_tokens(user_id: str, provider: str = "google") -> Optional[Dict[str, Any]]:
    """
    Retrieve stored OAuth tokens for a user and provider.
    """
    user_uuid = _parse_user_uuid(user_id)

    query = """
    SELECT id, user_id, provider, access_token, refresh_token, token_type, scope, expires_at, created_at, updated_at
    FROM oauth_tokens
    WHERE user_id = $1 AND provider = $2;
    """

    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(query, user_uuid, provider)
        if row:
            return dict(row)
        return None


async def delete_oauth_tokens(user_id: str, provider: str = "google") -> bool:
    """
    Delete stored OAuth tokens for a user (used during disconnect / revocation).
    """
    user_uuid = _parse_user_uuid(user_id)

    query = "DELETE FROM oauth_tokens WHERE user_id = $1 AND provider = $2;"

    pool = await get_db_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(query, user_uuid, provider)
        # result looks like "DELETE 1"
        deleted = result.endswith("1")
        logger.info("Deleted OAuth tokens for user %s (provider: %s, deleted=%s)", user_uuid, provider, deleted)
        return deleted

