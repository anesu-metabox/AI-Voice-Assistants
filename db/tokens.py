"""
OAuth Tokens Database Repository
Manages durable storage, retrieval, and updates of OAuth credentials in Neon PostgreSQL.
"""

from datetime import datetime, timezone
import asyncio
import logging
import json
from typing import Any, Dict, Optional
import uuid

from .connection import get_db_pool
try:
    from backend.app.services.credential_envelope import decrypt_secret, encrypt_secret
except ModuleNotFoundError:  # backend launched with backend/ as its import root
    from app.services.credential_envelope import decrypt_secret, encrypt_secret

logger = logging.getLogger("voice_bot.db.tokens")


def _parse_user_uuid(user_id: Any) -> uuid.UUID:
    if isinstance(user_id, uuid.UUID):
        return user_id
    try:
        return uuid.UUID(str(user_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("A verified company UUID is required for OAuth token access") from exc


async def save_oauth_tokens(
    user_id: str,
    provider: str,
    access_token: str,
    expires_at: datetime,
    refresh_token: Optional[str] = None,
    token_type: str = "Bearer",
    scope: Optional[str] = None,
    google_subject: Optional[str] = None,
    google_email: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Persist or update OAuth tokens for a specific user and provider.
    Uses ON CONFLICT DO UPDATE to preserve existing refresh_token if a new one is not supplied.
    """
    user_uuid = _parse_user_uuid(user_id)

    # Ensure expires_at has timezone
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    access_ciphertext, access_envelope = await asyncio.to_thread(
        encrypt_secret, access_token, company_id=str(user_uuid), provider=provider, field="access_token"
    )
    refresh_ciphertext = None
    refresh_envelope = None
    if refresh_token:
        refresh_ciphertext, refresh_envelope = await asyncio.to_thread(
            encrypt_secret, refresh_token, company_id=str(user_uuid), provider=provider, field="refresh_token"
        )
    envelope = {"access_token": access_envelope, "refresh_token": refresh_envelope}

    query = """
    INSERT INTO oauth_tokens (
        user_id, provider, access_token_ciphertext,
        refresh_token_ciphertext, encryption_envelope, google_subject, google_email,
        token_type, scope, expires_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, NOW())
    ON CONFLICT (user_id, provider) DO UPDATE SET
        access_token_ciphertext = EXCLUDED.access_token_ciphertext,
        refresh_token_ciphertext = COALESCE(EXCLUDED.refresh_token_ciphertext, oauth_tokens.refresh_token_ciphertext),
        encryption_envelope = CASE WHEN EXCLUDED.refresh_token_ciphertext IS NULL
            THEN jsonb_set(oauth_tokens.encryption_envelope, '{access_token}', EXCLUDED.encryption_envelope->'access_token')
            ELSE EXCLUDED.encryption_envelope END,
        google_subject = COALESCE(EXCLUDED.google_subject, oauth_tokens.google_subject),
        google_email = COALESCE(EXCLUDED.google_email, oauth_tokens.google_email),
        token_type = EXCLUDED.token_type,
        scope = COALESCE(EXCLUDED.scope, oauth_tokens.scope),
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
    RETURNING id, user_id, provider, token_type, expires_at, scope, updated_at;
    """

    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", str(user_uuid))
        row = await conn.fetchrow(
            query,
            user_uuid,
            provider,
            access_ciphertext,
            refresh_ciphertext,
            json.dumps(envelope),
            google_subject,
            google_email,
            token_type,
            scope,
            expires_at,
        )
        logger.info("Persisted OAuth credentials for provider %s", provider)
        return dict(row)


async def get_oauth_tokens(user_id: str, provider: str = "google") -> Optional[Dict[str, Any]]:
    """
    Retrieve stored OAuth tokens for a user and provider.
    """
    user_uuid = _parse_user_uuid(user_id)

    query = """
    SELECT id, user_id, provider, access_token_ciphertext, refresh_token_ciphertext,
           encryption_envelope, google_subject, google_email, token_type, scope,
           expires_at, created_at, updated_at
    FROM oauth_tokens
    WHERE user_id = $1 AND provider = $2;
    """

    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", str(user_uuid))
        row = await conn.fetchrow(query, user_uuid, provider)
        if row:
            record = dict(row)
            envelope = record.get("encryption_envelope") or {}
            try:
                record["access_token"] = await asyncio.to_thread(decrypt_secret,
                    record["access_token_ciphertext"], envelope["access_token"],
                    company_id=str(user_uuid), provider=provider, field="access_token"
                ) if record.get("access_token_ciphertext") else None
                record["refresh_token"] = await asyncio.to_thread(decrypt_secret,
                    record["refresh_token_ciphertext"], envelope["refresh_token"],
                    company_id=str(user_uuid), provider=provider, field="refresh_token"
                ) if record.get("refresh_token_ciphertext") else None
            except (KeyError, TypeError, ValueError):
                logger.error("Encrypted Google credential failed integrity validation")
                return None
            return record
        return None


async def get_oauth_connection_metadata(user_id: str, provider: str = "google") -> Optional[Dict[str, Any]]:
    """Return status/display metadata without decrypting provider credentials."""
    user_uuid = _parse_user_uuid(user_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", str(user_uuid))
            row = await conn.fetchrow(
                """SELECT user_id, provider, google_subject, google_email, token_type,
                          scope, expires_at, created_at, updated_at,
                          (refresh_token_ciphertext IS NOT NULL) AS has_refresh_token
                   FROM oauth_tokens WHERE user_id = $1 AND provider = $2""",
                user_uuid, provider,
            )
            return dict(row) if row else None


async def delete_oauth_tokens(user_id: str, provider: str = "google") -> bool:
    """
    Delete stored OAuth tokens for a user (used during disconnect / revocation).
    """
    user_uuid = _parse_user_uuid(user_id)

    query = "DELETE FROM oauth_tokens WHERE user_id = $1 AND provider = $2;"

    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", str(user_uuid))
        result = await conn.execute(query, user_uuid, provider)
        # result looks like "DELETE 1"
        deleted = result.endswith("1")
        logger.info("OAuth credentials deleted (provider=%s, deleted=%s)", provider, deleted)
        return deleted

