"""Provision a least-privilege, non-bypass-RLS runtime database role.

Run this with an administrative/unpooled connection after migrations. The
password is supplied only through the process environment and is never logged.
The migration role and runtime role must be different in production.
"""

from __future__ import annotations

import asyncio
import argparse
import os
import re
from urllib.parse import urlsplit

import asyncpg
from dotenv import load_dotenv

try:
    from .connection import assert_database_branch_is_safe
    from .tenant_tables import TENANT_TABLES
except ImportError:  # Support direct `python db/provision_runtime_role.py` invocation.
    from connection import assert_database_branch_is_safe
    from tenant_tables import TENANT_TABLES


ROLE_PATTERN = re.compile(r"^[a-z_][a-z0-9_]{2,62}$")


def validate_provisioning_target(*, allow_production: bool = False) -> tuple[str, str, str, str]:
    dsn = os.getenv("DATABASE_URL_UNPOOLED", "").strip()
    branch = os.getenv("NEON_BRANCH", "").strip().lower()
    role = os.getenv("RUNTIME_DB_ROLE", "voice_bot_runtime")
    password = os.getenv("RUNTIME_DB_PASSWORD", "")
    if not dsn:
        raise RuntimeError("DATABASE_URL_UNPOOLED is required for runtime-role provisioning")
    if not branch:
        raise RuntimeError("NEON_BRANCH must explicitly identify the target branch")
    if branch in {"production", "main", "primary"} and not allow_production:
        raise RuntimeError("Refusing production role provisioning without --allow-production")
    assert_database_branch_is_safe(allow_protected=allow_production)
    hostname = urlsplit(dsn).hostname or ""
    if "pooler" in hostname.lower():
        raise RuntimeError("Runtime-role provisioning requires a direct/unpooled Neon endpoint")
    if not ROLE_PATTERN.fullmatch(role):
        raise RuntimeError("RUNTIME_DB_ROLE must be a lowercase PostgreSQL identifier")
    if len(password) < 32:
        raise RuntimeError("RUNTIME_DB_PASSWORD must contain at least 32 characters")
    return dsn, branch, role, password


async def provision(*, allow_production: bool = False) -> None:
    load_dotenv()
    dsn, branch, role, password = validate_provisioning_target(allow_production=allow_production)

    quoted_role = '"' + role.replace('"', '""') + '"'
    conn = await asyncpg.connect(dsn)
    try:
        database_name = await conn.fetchval("SELECT current_database()")
        quoted_database = '"' + str(database_name).replace('"', '""') + '"'
        password_literal = await conn.fetchval("SELECT quote_literal($1)", password)
        existing = await conn.fetchrow(
            """SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreatedb,
                      rolcreaterole, rolinherit
               FROM pg_roles WHERE rolname = $1""",
            role,
        )
        if existing:
            if (
                not existing["rolcanlogin"]
                or existing["rolsuper"]
                or existing["rolbypassrls"]
                or existing["rolcreatedb"]
                or existing["rolcreaterole"]
                or existing["rolinherit"]
            ):
                raise RuntimeError(
                    f"existing runtime role '{role}' does not satisfy the non-bypass-RLS least-privilege contract"
                )
        else:
            await conn.execute(
                f"CREATE ROLE {quoted_role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD {password_literal}",
            )
        await conn.execute(f"GRANT CONNECT ON DATABASE {quoted_database} TO {quoted_role}")
        await conn.execute(f"GRANT USAGE ON SCHEMA public TO {quoted_role}")
        for table in TENANT_TABLES:
            await conn.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.{table} TO {quoted_role}")
        await conn.execute(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {quoted_role}")
        await conn.execute(f"GRANT EXECUTE ON FUNCTION public.current_company_id() TO {quoted_role}")
        action = "verified and refreshed grants for" if existing else "provisioned"
        print(f"{action.capitalize()} runtime role '{role}' on Neon branch '{branch}' with NOSUPERUSER, NOBYPASSRLS, and tenant-table grants.")
    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Provision a non-bypass-RLS Neon runtime role")
    parser.add_argument(
        "--allow-production",
        action="store_true",
        help="Explicitly authorize role provisioning when NEON_BRANCH is production/main/primary",
    )
    args = parser.parse_args()
    asyncio.run(provision(allow_production=args.allow_production))
