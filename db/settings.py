"""
Database Operations for Company Profiles and Assistant Configurations
Persists user settings into Neon Serverless PostgreSQL.
"""

from datetime import datetime, timezone
import logging
from typing import Any, Dict, Optional
import uuid

from .connection import get_db_pool

logger = logging.getLogger("voice_bot.db.settings")

def _parse_user_uuid(user_id: Any) -> uuid.UUID:
    if isinstance(user_id, uuid.UUID):
        return user_id
    try:
        return uuid.UUID(str(user_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("A verified company UUID is required for settings access") from exc


# ─── Company Profile Operations ───────────────────────────────────────────────

async def get_company_profile(user_id: Any) -> Dict[str, Any]:
    """
    Retrieve company profile for a given user.
    Returns an empty onboarding profile if no record exists yet.
    """
    user_uuid = _parse_user_uuid(user_id)
    pool = await get_db_pool()
    query = """
    SELECT id, user_id, company_name, website_url, company_phone, support_email, timezone, created_at, updated_at
    FROM company_profiles
    WHERE user_id = $1;
    """
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", str(user_uuid))
        row = await conn.fetchrow(query, user_uuid)
        if row:
            return {
                "id": str(row["id"]),
                "user_id": str(row["user_id"]),
                "company_name": row["company_name"],
                "website_url": row["website_url"] or "",
                "company_phone": row["company_phone"] or "",
                "support_email": row["support_email"] or "",
                "timezone": row["timezone"],
                "created_at": row["created_at"].isoformat(),
                "updated_at": row["updated_at"].isoformat(),
            }

    return {
        "user_id": str(user_uuid),
        "company_name": "",
        "website_url": "",
        "company_phone": "",
        "support_email": "",
        "timezone": "Indian/Mauritius",
    }


async def save_company_profile(
    user_id: Any,
    company_name: str,
    website_url: Optional[str] = None,
    company_phone: Optional[str] = None,
    support_email: Optional[str] = None,
    timezone: str = "Indian/Mauritius",
) -> Dict[str, Any]:
    """
    Insert or update the company profile for the user.
    """
    user_uuid = _parse_user_uuid(user_id)
    pool = await get_db_pool()
    query = """
    INSERT INTO company_profiles (
        user_id, company_name, website_url, company_phone, support_email, timezone
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        website_url = EXCLUDED.website_url,
        company_phone = EXCLUDED.company_phone,
        support_email = EXCLUDED.support_email,
        timezone = EXCLUDED.timezone,
        updated_at = NOW()
    RETURNING id, user_id, company_name, website_url, company_phone, support_email, timezone, updated_at;
    """
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", str(user_uuid))
        row = await conn.fetchrow(
            query,
            user_uuid,
            company_name,
            website_url,
            company_phone,
            support_email,
            timezone,
        )
        return {
            "id": str(row["id"]),
            "user_id": str(row["user_id"]),
            "company_name": row["company_name"],
            "website_url": row["website_url"],
            "company_phone": row["company_phone"],
            "support_email": row["support_email"],
            "timezone": row["timezone"],
            "updated_at": row["updated_at"].isoformat(),
        }


# ─── Assistant Configuration Operations ───────────────────────────────────────

async def get_assistant_config(user_id: Any) -> Dict[str, Any]:
    """
    Retrieve assistant configuration for a given user.
    Returns an empty assistant draft if no record exists yet.
    """
    user_uuid = _parse_user_uuid(user_id)
    pool = await get_db_pool()
    query = """
    SELECT id, user_id, assistant_name, voice_engine, inbound_greeting, system_prompt, knowledge_base_notes, is_deployed, created_at, updated_at
    FROM assistant_configs
    WHERE user_id = $1;
    """
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", str(user_uuid))
        row = await conn.fetchrow(query, user_uuid)
        if row:
            return {
                "id": str(row["id"]),
                "user_id": str(row["user_id"]),
                "assistant_name": row["assistant_name"],
                "voice_engine": row["voice_engine"],
                "inbound_greeting": row["inbound_greeting"],
                "system_prompt": row["system_prompt"],
                "knowledge_base_notes": row["knowledge_base_notes"] or "",
                "is_deployed": row["is_deployed"],
                "created_at": row["created_at"].isoformat(),
                "updated_at": row["updated_at"].isoformat(),
            }

    return {
        "user_id": str(user_uuid),
        "assistant_name": "",
        "voice_engine": "Aoede",
        "inbound_greeting": "",
        "system_prompt": "",
        "knowledge_base_notes": "",
        "is_deployed": False,
    }


async def save_assistant_config(
    user_id: Any,
    assistant_name: str,
    voice_engine: str = "Aoede",
    inbound_greeting: str = "",
    system_prompt: str = "",
    knowledge_base_notes: Optional[str] = None,
    is_deployed: bool = False,
) -> Dict[str, Any]:
    """
    Insert or update the assistant configuration for the user.
    """
    user_uuid = _parse_user_uuid(user_id)
    pool = await get_db_pool()
    query = """
    INSERT INTO assistant_configs (
        user_id, assistant_name, voice_engine, inbound_greeting, system_prompt, knowledge_base_notes, is_deployed
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id) DO UPDATE SET
        assistant_name = EXCLUDED.assistant_name,
        voice_engine = EXCLUDED.voice_engine,
        inbound_greeting = EXCLUDED.inbound_greeting,
        system_prompt = EXCLUDED.system_prompt,
        knowledge_base_notes = EXCLUDED.knowledge_base_notes,
        is_deployed = EXCLUDED.is_deployed,
        updated_at = NOW()
    RETURNING id, user_id, assistant_name, voice_engine, inbound_greeting, system_prompt, knowledge_base_notes, is_deployed, updated_at;
    """
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", str(user_uuid))
        row = await conn.fetchrow(
            query,
            user_uuid,
            assistant_name,
            voice_engine,
            inbound_greeting,
            system_prompt,
            knowledge_base_notes,
            is_deployed,
        )
        return {
            "id": str(row["id"]),
            "user_id": str(row["user_id"]),
            "assistant_name": row["assistant_name"],
            "voice_engine": row["voice_engine"],
            "inbound_greeting": row["inbound_greeting"],
            "system_prompt": row["system_prompt"],
            "knowledge_base_notes": row["knowledge_base_notes"],
            "is_deployed": row["is_deployed"],
            "updated_at": row["updated_at"].isoformat(),
        }
