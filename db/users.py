"""
Users Database Repository
Manages durable storage, retrieval, and registration of user profiles in Neon PostgreSQL.
"""

from datetime import datetime, timezone
import logging
from typing import Any, Dict, Optional
import uuid

from .connection import get_db_pool

logger = logging.getLogger("voice_bot.db.users")


def _parse_uuid(uid: Any) -> Optional[uuid.UUID]:
    if isinstance(uid, uuid.UUID):
        return uid
    try:
        return uuid.UUID(str(uid))
    except (ValueError, TypeError, AttributeError):
        return None


async def get_or_create_google_user(
    email: str,
    google_sub: Optional[str] = None,
    name: Optional[str] = None,
    picture_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Look up an existing user by email or Google subject ID, or create a new user profile.
    Updates name and picture_url if provided.
    """
    clean_email = email.strip().lower()
    pool = await get_db_pool()

    async with pool.acquire() as conn:
        # Check if user exists by email or google_sub
        row = None
        if google_sub:
            row = await conn.fetchrow(
                "SELECT id, email, name, picture_url, google_sub, created_at, updated_at FROM users WHERE google_sub = $1;",
                google_sub,
            )

        if not row:
            row = await conn.fetchrow(
                "SELECT id, email, name, picture_url, google_sub, created_at, updated_at FROM users WHERE LOWER(email) = $1;",
                clean_email,
            )

        if row:
            user_dict = dict(row)
            # Update fields if new data provided
            updates = []
            params = [user_dict["id"]]
            idx = 2

            if google_sub and not user_dict.get("google_sub"):
                updates.append(f"google_sub = ${idx}")
                params.append(google_sub)
                idx += 1
            if name and name != user_dict.get("name"):
                updates.append(f"name = ${idx}")
                params.append(name)
                idx += 1
            if picture_url and picture_url != user_dict.get("picture_url"):
                updates.append(f"picture_url = ${idx}")
                params.append(picture_url)
                idx += 1

            if updates:
                query = f"UPDATE users SET {', '.join(updates)}, updated_at = NOW() WHERE id = $1 RETURNING id, email, name, picture_url, google_sub, created_at, updated_at;"
                updated_row = await conn.fetchrow(query, *params)
                if updated_row:
                    user_dict = dict(updated_row)

            logger.info("Retrieved existing user %s (%s)", user_dict["id"], clean_email)
            return user_dict

        # Create new user
        new_row = await conn.fetchrow(
            """
            INSERT INTO users (email, name, picture_url, google_sub, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            RETURNING id, email, name, picture_url, google_sub, created_at, updated_at;
            """,
            clean_email,
            name or clean_email.split("@")[0],
            picture_url,
            google_sub,
        )
        new_user = dict(new_row)
        logger.info("Registered new user %s (%s)", new_user["id"], clean_email)
        return new_user


async def get_user_by_id(user_id: Any) -> Optional[Dict[str, Any]]:
    """Retrieve user record by UUID."""
    parsed_uuid = _parse_uuid(user_id)
    if not parsed_uuid:
        return None

    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, email, name, picture_url, google_sub, created_at, updated_at FROM users WHERE id = $1;",
            parsed_uuid,
        )
        return dict(row) if row else None


async def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    """Retrieve user record by email address."""
    clean_email = email.strip().lower()
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, email, name, picture_url, google_sub, created_at, updated_at FROM users WHERE LOWER(email) = $1;",
            clean_email,
        )
        return dict(row) if row else None
