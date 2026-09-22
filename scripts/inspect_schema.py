"""Read-only Neon schema/migration inventory for deployment verification."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
import sys

import asyncpg
from dotenv import load_dotenv

_root_path = str(Path(__file__).resolve().parents[1])
if _root_path not in sys.path:
    sys.path.insert(0, _root_path)

from db.connection import assert_database_branch_is_safe


async def main() -> None:
    load_dotenv()
    database_url = os.getenv("DATABASE_URL_UNPOOLED") or os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL_UNPOOLED or DATABASE_URL is required")
    # This inventory is intentionally read-only and may target production, but
    # the selected branch must still match the repository link exactly.
    assert_database_branch_is_safe(allow_protected=True)
    conn = await asyncpg.connect(database_url, ssl="require")
    try:
        migrations = await conn.fetch("SELECT version FROM schema_migrations ORDER BY version")
        tables = await conn.fetch(
            """SELECT table_name FROM information_schema.tables
               WHERE table_schema = 'public'
                 AND table_name = ANY($1::text[])
               ORDER BY table_name""",
            [
                "companies",
                "agent_profile_versions",
                "voice_sessions",
                "livekit_sessions",
                "oauth_states",
                "integration_audit_events",
                "threecx_call_sessions",
                "threecx_event_inbox",
                "credential_broker_nonces",
                "integration_action_limits",
            ],
        )
        print("schema_migrations=" + ",".join(row["version"] for row in migrations))
        print("roadmap_tables=" + ",".join(row["table_name"] for row in tables))
        legacy_tables = await conn.fetch(
            """SELECT table_name FROM information_schema.tables
               WHERE table_schema = 'public'
                 AND table_name = ANY($1::text[])
               ORDER BY table_name""",
            [
                "company_profiles",
                "assistant_configs",
                "user_preferences",
                "oauth_tokens",
                "tasks",
                "calendar_events",
                "idempotency_records",
                "confirmation_tokens",
            ],
        )
        print("legacy_tables=" + ",".join(row["table_name"] for row in legacy_tables))
        for table in ("company_profiles", "assistant_configs", "oauth_tokens"):
            exists = any(row["table_name"] == table for row in legacy_tables)
            if exists:
                count = await conn.fetchval(f'SELECT COUNT(*) FROM "{table}"')
                print(f"{table}_rows={count}")
        oauth_columns = await conn.fetch(
            """SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'oauth_tokens'
               ORDER BY ordinal_position"""
        )
        print("oauth_columns=" + ",".join(row["column_name"] for row in oauth_columns))
        livekit_columns = await conn.fetch(
            """SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'livekit_sessions'
               ORDER BY ordinal_position"""
        )
        print("livekit_columns=" + ",".join(row["column_name"] for row in livekit_columns))
        rls = await conn.fetch(
            """SELECT relname FROM pg_class
               WHERE relnamespace = 'public'::regnamespace AND relrowsecurity
               ORDER BY relname"""
        )
        print("rls_tables=" + ",".join(row["relname"] for row in rls))
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
