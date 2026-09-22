"""One-time, tenant-bound OAuth state and PKCE verifier storage."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from .connection import get_db_pool


async def save_oauth_state(
    *, nonce: str, company_id: str, session_id: str, code_verifier: str, expires_at: datetime,
) -> None:
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
            await conn.execute(
                """INSERT INTO oauth_states (nonce, company_id, session_id, code_verifier, expires_at)
                   VALUES ($1, $2::uuid, $3, $4, $5)""",
                nonce, company_id, session_id, code_verifier, expires_at,
            )


async def consume_oauth_state(nonce: str, company_id: str) -> Optional[dict[str, str]]:
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
            row = await conn.fetchrow(
                """UPDATE oauth_states
                   SET used_at = NOW()
                   WHERE nonce = $1 AND company_id = $2::uuid
                     AND used_at IS NULL AND expires_at > $3
                   RETURNING company_id::text AS company_id, session_id, code_verifier""",
                nonce, company_id, datetime.now(timezone.utc),
            )
            return dict(row) if row else None
