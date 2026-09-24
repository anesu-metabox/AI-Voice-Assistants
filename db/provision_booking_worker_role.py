"""Provision a database identity limited to claiming calendar booking jobs.

This role must never be shared with the API, broker, or LiveKit worker. It has
BYPASSRLS because it must claim work across tenants, but receives table grants
only on calendar_booking_requests; it cannot read OAuth tokens or app records.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
from urllib.parse import urlsplit

import asyncpg
from dotenv import load_dotenv

try:
    from .connection import assert_database_branch_is_safe
except ImportError:
    from connection import assert_database_branch_is_safe

ROLE_PATTERN = re.compile(r"^[a-z_][a-z0-9_]{2,62}$")


async def provision(*, allow_production: bool = False) -> None:
    load_dotenv()
    dsn = os.getenv("DATABASE_URL_UNPOOLED", "").strip()
    branch = os.getenv("NEON_BRANCH", "").strip().lower()
    role = os.getenv("BOOKING_WORKER_DB_ROLE", "calendar_booking_worker").strip()
    password = os.getenv("BOOKING_WORKER_DB_PASSWORD", "")
    if not dsn or not branch:
        raise RuntimeError("DATABASE_URL_UNPOOLED and NEON_BRANCH are required")
    if branch in {"production", "main", "primary"} and not allow_production:
        raise RuntimeError("Refusing production role provisioning without --allow-production")
    assert_database_branch_is_safe(allow_protected=allow_production)
    if "pooler" in (urlsplit(dsn).hostname or "").lower():
        raise RuntimeError("Use a direct/unpooled database endpoint for role provisioning")
    if not ROLE_PATTERN.fullmatch(role) or len(password) < 32:
        raise RuntimeError("Worker role name or password does not meet policy")

    conn = await asyncpg.connect(dsn)
    quoted_role = '"' + role.replace('"', '""') + '"'
    try:
        database_name = await conn.fetchval("SELECT current_database()")
        quoted_database = '"' + str(database_name).replace('"', '""') + '"'
        password_literal = await conn.fetchval("SELECT quote_literal($1)", password)
        existing = await conn.fetchrow(
            "SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit FROM pg_roles WHERE rolname=$1",
            role,
        )
        if existing and (
            not existing["rolcanlogin"] or existing["rolsuper"] or not existing["rolbypassrls"]
            or existing["rolcreatedb"] or existing["rolcreaterole"] or existing["rolinherit"]
        ):
            raise RuntimeError("Existing booking worker role does not match the restricted role contract")
        memberships = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = (SELECT oid FROM pg_roles WHERE rolname=$1) OR member = (SELECT oid FROM pg_roles WHERE rolname=$1))",
            role,
        )
        if memberships:
            raise RuntimeError("Booking worker role must not have or grant role memberships")
        if existing:
            await conn.execute(f"ALTER ROLE {quoted_role} PASSWORD {password_literal}")
        else:
            await conn.execute(
                f"CREATE ROLE {quoted_role} LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD {password_literal}"
            )
        await conn.execute(f"GRANT CONNECT ON DATABASE {quoted_database} TO {quoted_role}")
        await conn.execute(f"GRANT USAGE ON SCHEMA public TO {quoted_role}")
        await conn.execute(f"REVOKE CREATE ON SCHEMA public FROM {quoted_role}")
        await conn.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {quoted_role}")
        await conn.execute(f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM {quoted_role}")
        await conn.execute(f"GRANT SELECT ON TABLE public.calendar_booking_requests TO {quoted_role}")
        await conn.execute(
            f"GRANT UPDATE (status, attempt_count, next_attempt_at, lease_until, result_payload, error_message, updated_at) ON TABLE public.calendar_booking_requests TO {quoted_role}"
        )
        print(f"Provisioned restricted booking worker role '{role}' on Neon branch '{branch}'.")
    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Provision the restricted calendar booking worker DB role")
    parser.add_argument("--allow-production", action="store_true")
    asyncio.run(provision(allow_production=parser.parse_args().allow_production))
