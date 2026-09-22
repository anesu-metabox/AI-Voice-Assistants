"""Versioned, tenant-scoped assistant profile persistence."""

from __future__ import annotations

import json
import uuid
from typing import Any

from .connection import get_db_pool


def validate_profile_transition(
    current_state: str,
    target_state: str,
    allowed_source_states: set[str] | None = None,
) -> None:
    """Enforce the profile lifecycle before any database state mutation."""
    if allowed_source_states is not None and current_state not in allowed_source_states:
        raise ValueError("profile lifecycle transition is not allowed from the current state")
    if current_state == target_state:
        raise ValueError("profile is already in the requested lifecycle state")


async def save_agent_profile_version(
    *, company_id: str, created_by: str, profile: dict[str, Any], compiled_policy: dict[str, Any], published: bool,
) -> dict[str, Any]:
    company_uuid = uuid.UUID(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
            # Version numbers are company-local. Serialize writers for this company
            # before reading MAX(version), otherwise simultaneous saves can choose
            # the same version and one will fail the unique constraint.
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                company_id,
            )
            version = await conn.fetchval(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM agent_profile_versions WHERE company_id = $1",
                company_uuid,
            )
            if published:
                await conn.execute(
                    "UPDATE agent_profile_versions SET lifecycle_state='superseded' WHERE company_id=$1 AND lifecycle_state='published'",
                    company_uuid,
                )
            row = await conn.fetchrow(
                """INSERT INTO agent_profile_versions
                   (company_id, version, lifecycle_state, profile, compiled_policy,
                    policy_version, created_by, published_at)
                   VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,CASE WHEN $3='published' THEN NOW() END)
                   RETURNING company_id, version, lifecycle_state, policy_version, created_at, published_at""",
                company_uuid, version, "published" if published else "draft",
                json.dumps(profile), json.dumps(compiled_policy),
                compiled_policy.get("platformPolicyVersion"), created_by,
            )
            return dict(row)


async def list_agent_profile_versions(*, company_id: str) -> list[dict[str, Any]]:
    company_uuid = uuid.UUID(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        rows = await conn.fetch(
            """SELECT version, lifecycle_state, policy_version, created_by,
                      created_at, published_at
               FROM agent_profile_versions
               WHERE company_id = $1 ORDER BY version DESC""",
            company_uuid,
        )
    return [dict(row) for row in rows]


async def get_latest_agent_profile(*, company_id: str) -> dict[str, Any] | None:
    """Return the newest draft or published profile for configuration editing."""
    company_uuid = uuid.UUID(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        row = await conn.fetchrow(
            """SELECT version, lifecycle_state, profile, compiled_policy,
                      policy_version, created_at, published_at
               FROM agent_profile_versions
               WHERE company_id = $1 ORDER BY version DESC LIMIT 1""",
            company_uuid,
        )
    if not row:
        return None
    result = dict(row)
    for key in ("profile", "compiled_policy"):
        if isinstance(result.get(key), str):
            result[key] = json.loads(result[key])
    return result


async def get_agent_profile_version(*, company_id: str, version: int) -> dict[str, Any] | None:
    """Return one exact profile version, always constrained to the verified tenant."""
    company_uuid = uuid.UUID(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        row = await conn.fetchrow(
            """SELECT version, lifecycle_state, profile, compiled_policy,
                      policy_version, created_at, published_at
               FROM agent_profile_versions
               WHERE company_id = $1 AND version = $2""",
            company_uuid,
            version,
        )
    if not row:
        return None
    result = dict(row)
    for key in ("profile", "compiled_policy"):
        if isinstance(result.get(key), str):
            result[key] = json.loads(result[key])
    return result


async def get_published_agent_profile(
    *, company_id: str, version: int | None = None
) -> dict[str, Any] | None:
    """Return the immutable published profile or a specific session snapshot."""
    company_uuid = uuid.UUID(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        row = await conn.fetchrow(
            """SELECT version, lifecycle_state, profile, compiled_policy,
                      policy_version, created_at, published_at
               FROM agent_profile_versions
               WHERE company_id = $1
                 AND (( $2::integer IS NULL AND lifecycle_state = 'published') OR version = $2)
               ORDER BY version DESC LIMIT 1""",
            company_uuid,
            version,
        )
    if not row:
        return None
    result = dict(row)
    for key in ("profile", "compiled_policy"):
        if isinstance(result.get(key), str):
            result[key] = json.loads(result[key])
    return result


async def transition_agent_profile(
    *, company_id: str, version: int, lifecycle_state: str,
    allowed_source_states: set[str] | None = None,
) -> dict[str, Any]:
    if lifecycle_state not in {"validated", "tested", "published", "rolled_back"}:
        raise ValueError("unsupported profile lifecycle transition")
    company_uuid = uuid.UUID(company_id)
    pool = await get_db_pool()
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("SELECT set_config('app.company_id', $1, true)", company_id)
        current_state = await conn.fetchval(
            """SELECT lifecycle_state
               FROM agent_profile_versions
               WHERE company_id = $1 AND version = $2
               FOR UPDATE""",
            company_uuid,
            version,
        )
        if current_state is None:
            raise LookupError("profile version not found")
        validate_profile_transition(current_state, lifecycle_state, allowed_source_states)
        if lifecycle_state == "published":
            await conn.execute(
                "UPDATE agent_profile_versions SET lifecycle_state='superseded' WHERE company_id=$1 AND lifecycle_state='published'",
                company_uuid,
            )
        row = await conn.fetchrow(
            """UPDATE agent_profile_versions
               SET lifecycle_state = $1,
                   published_at = CASE WHEN $1 = 'published' THEN NOW() ELSE published_at END
               WHERE company_id = $2 AND version = $3
               RETURNING company_id, version, lifecycle_state, policy_version, created_at, published_at""",
            lifecycle_state, company_uuid, version,
        )
    if not row:
        raise LookupError("profile version not found")
    return dict(row)
