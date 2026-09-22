"""Tenant-scoped, redacted operational audit events."""

from __future__ import annotations

import json
import uuid
from typing import Any

from .connection import get_db_pool


async def record_integration_event(
    *, company_id: str, provider: str, action: str, outcome: str, metadata: dict[str, Any] | None = None
) -> None:
    company_uuid = uuid.UUID(company_id)
    if outcome not in {"success", "failure"}:
        raise ValueError("invalid audit outcome")
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        await conn.execute(
            """INSERT INTO integration_audit_events
               (company_id, provider, action, outcome, metadata)
               VALUES ($1, $2, $3, $4, $5::jsonb)""",
            company_uuid,
            provider[:64],
            action[:64],
            outcome,
            json.dumps(metadata or {}, separators=(",", ":")),
        )
