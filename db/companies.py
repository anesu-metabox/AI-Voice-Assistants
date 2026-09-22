"""Idempotent provisioning of the v1 one-company-per-auth-user boundary."""

from __future__ import annotations

import uuid

from .connection import get_db_pool


async def ensure_company(company_id: str, auth_subject: str, display_name: str = "") -> None:
    if not auth_subject.strip():
        raise ValueError("Verified auth subject is required to provision company membership")
    company_uuid = uuid.UUID(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
            existing = await conn.fetchrow(
                "SELECT company_id, status FROM company_memberships WHERE user_id = $1 FOR UPDATE",
                auth_subject,
            )
            if existing and (
                str(existing["company_id"]) != str(company_uuid)
                or existing["status"] != "active"
            ):
                raise PermissionError("Authenticated user is already assigned to another company")
            await conn.execute(
                """INSERT INTO companies (id, display_name) VALUES ($1, $2)
                   ON CONFLICT (id) DO NOTHING""",
                company_uuid, display_name[:255] or "New Company",
            )
            # Remove only the old v1 placeholder membership. Company IDs used
            # to be written into user_id before signed Auth subjects were carried.
            await conn.execute(
                "DELETE FROM company_memberships WHERE company_id = $1 AND user_id = $2",
                company_uuid, company_id,
            )
            await conn.execute(
                """INSERT INTO company_memberships (company_id, user_id, role)
                   VALUES ($1, $2, 'owner') ON CONFLICT (user_id) DO NOTHING""",
                company_uuid, auth_subject,
            )
            membership = await conn.fetchrow(
                "SELECT company_id, status FROM company_memberships WHERE user_id = $1",
                auth_subject,
            )
            if (
                not membership
                or str(membership["company_id"]) != str(company_uuid)
                or membership["status"] != "active"
            ):
                raise PermissionError("Authenticated user is not an active member of this company")
