"""Tenant-scoped user/company preference persistence."""

from __future__ import annotations

import json
import uuid
from typing import Any

from .connection import get_db_pool


async def get_preferences(company_id: str) -> dict[str, Any]:
    company_uuid = uuid.UUID(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        row = await conn.fetchrow(
            "SELECT preferences, onboarding_complete FROM user_preferences WHERE company_id = $1 OR user_id = $1",
            company_uuid,
        )
    if not row:
        return {"preferences": {}, "onboarding_complete": False}
    return {"preferences": dict(row["preferences"] or {}), "onboarding_complete": bool(row["onboarding_complete"])}


async def save_preferences(*, company_id: str, preferences: dict[str, Any], onboarding_complete: bool | None = None) -> dict[str, Any]:
    company_uuid = uuid.UUID(company_id)
    current = await get_preferences(company_id)
    complete = current["onboarding_complete"] if onboarding_complete is None else onboarding_complete
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        row = await conn.fetchrow(
            """INSERT INTO user_preferences
               (user_id, company_id, preferences, onboarding_complete, updated_at)
               VALUES ($1, $1, $2::jsonb, $3, NOW())
               ON CONFLICT (user_id) DO UPDATE SET
                 company_id = EXCLUDED.company_id, preferences = EXCLUDED.preferences,
                 onboarding_complete = EXCLUDED.onboarding_complete, updated_at = NOW()
               RETURNING preferences, onboarding_complete""",
            company_uuid, json.dumps(preferences, separators=(",", ":")), complete,
        )
    return {"preferences": dict(row["preferences"] or {}), "onboarding_complete": bool(row["onboarding_complete"])}
