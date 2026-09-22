"""Replay-protected service request ledger for the credential broker."""

from __future__ import annotations

from datetime import datetime, timezone
import uuid

from .connection import get_db_pool


async def consume_broker_nonce(company_id: str, nonce: uuid.UUID, expires_at: datetime) -> bool:
    company_uuid = uuid.UUID(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
            await conn.execute(
                "DELETE FROM credential_broker_nonces WHERE company_id = $1 AND expires_at < NOW()",
                company_uuid,
            )
            row = await conn.fetchrow(
                """INSERT INTO credential_broker_nonces (company_id, nonce, expires_at)
                   VALUES ($1, $2, $3) ON CONFLICT (company_id, nonce) DO NOTHING
                   RETURNING nonce""",
                company_uuid, nonce, expires_at.astimezone(timezone.utc),
            )
            return row is not None
