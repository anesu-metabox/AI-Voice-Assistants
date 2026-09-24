"""Cross-company RLS tests for the migrated Neon schema."""

import re
import uuid
from pathlib import Path

import asyncpg
import pytest
from db.tenant_tables import TENANT_TABLES


def _tenant_probe_rows(company_id: uuid.UUID, tag: str):
    """Return rollback-only row inserts and narrow probes for tenant tables."""
    return [
        ("company_memberships", "INSERT INTO company_memberships (company_id, user_id) VALUES ($1, $2)", (company_id, f"rls-user-{tag}"), "user_id = $1", (f"rls-user-{tag}",)),
        ("agent_profile_versions", "INSERT INTO agent_profile_versions (company_id, version, created_by) VALUES ($1, 1, $2)", (company_id, f"rls-user-{tag}"), "company_id = $1", (company_id,)),
        ("google_integrations", "INSERT INTO google_integrations (company_id, google_subject, google_email, access_token_ciphertext, encryption_envelope, expires_at) VALUES ($1, $2, $3, 'ciphertext', '{}'::jsonb, NOW() + interval '1 hour')", (company_id, f"subject-{tag}", f"{tag}@example.invalid"), "company_id = $1", (company_id,)),
        ("threecx_integrations", "INSERT INTO threecx_integrations (company_id, connection_name, pbx_hostname, route_point_dn, api_key_ciphertext, encryption_envelope) VALUES ($1, 'RLS test', 'pbx.example.invalid', '8000', 'ciphertext', '{}'::jsonb)", (company_id,), "company_id = $1", (company_id,)),
        ("threecx_call_sessions", "INSERT INTO threecx_call_sessions (company_id, pbx_call_id, did, direction, claim_token, lease_expires_at, livekit_room) VALUES ($1, $2, '+23050000001', 'inbound', $3, NOW() + interval '1 minute', $4)", (company_id, f"pbx-call-{tag}", uuid.uuid4(), f"threecx-test-{tag}"), "pbx_call_id = $1", (f"pbx-call-{tag}",)),
        ("threecx_event_inbox", "INSERT INTO threecx_event_inbox (company_id, event_id, pbx_call_id, event_type) VALUES ($1, $2, $3, 'RLSFixture')", (company_id, f"pbx-event-{tag}", f"pbx-call-{tag}"), "event_id = $1", (f"pbx-event-{tag}",)),
        ("credential_broker_nonces", "INSERT INTO credential_broker_nonces (company_id, nonce, expires_at) VALUES ($1, $2, NOW() + interval '1 minute')", (company_id, uuid.uuid4()), "company_id = $1", (company_id,)),
        ("integration_action_limits", "INSERT INTO integration_action_limits (company_id, action, window_started_at, attempt_count) VALUES ($1, 'threecx_test', NOW(), 1)", (company_id,), "company_id = $1 AND action = 'threecx_test'", (company_id,)),
        ("voice_sessions", "INSERT INTO voice_sessions (company_id, user_id, session_id) VALUES ($1, $2, $3)", (company_id, f"rls-user-{tag}", f"voice-{tag}"), "session_id = $1", (f"voice-{tag}",)),
        ("company_profiles", "INSERT INTO company_profiles (user_id, company_name) VALUES ($1, $2)", (company_id, f"RLS profile {tag}"), "user_id = $1", (company_id,)),
        ("assistant_configs", "INSERT INTO assistant_configs (user_id) VALUES ($1)", (company_id,), "user_id = $1", (company_id,)),
        ("user_preferences", "INSERT INTO user_preferences (user_id) VALUES ($1)", (company_id,), "company_id = $1", (company_id,)),
        ("tasks", "INSERT INTO tasks (user_id, title, status, tool_name) VALUES ($1, $2, 'pending', 'test')", (company_id, f"RLS task {tag}"), "title = $1", (f"RLS task {tag}",)),
        ("idempotency_records", "INSERT INTO idempotency_records (key, user_id, tool_name, status, expires_at) VALUES ($1, $2, 'test', 'acquired', NOW() + interval '1 hour')", (f"rls-idem-{tag}", company_id), "key = $1", (f"rls-idem-{tag}",)),
        ("confirmation_tokens", "INSERT INTO confirmation_tokens (token_hash, user_id, tool_name, event_id, expires_at) VALUES ($1, $2, 'cancel_event', $3, NOW() + interval '1 hour')", ((tag * 64)[:64], company_id, f"event-{tag}"), "token_hash = $1", ((tag * 64)[:64],)),
        ("calendar_events", "INSERT INTO calendar_events (user_id, title, start_time, end_time) VALUES ($1, $2, NOW() + interval '2 days', NOW() + interval '2 days 30 minutes')", (company_id, f"RLS event {tag}"), "title = $1", (f"RLS event {tag}",)),
        ("oauth_tokens", "INSERT INTO oauth_tokens (user_id, provider, access_token_ciphertext, encryption_envelope, expires_at) VALUES ($1, 'google', 'ciphertext', '{}'::jsonb, NOW() + interval '1 hour')", (company_id,), "user_id = $1 AND provider = 'google'", (company_id,)),
        ("livekit_sessions", "INSERT INTO livekit_sessions (user_id, session_id, room_name) VALUES ($1, $2, $3)", (str(company_id), f"lk-{tag}", f"room-{tag}"), "session_id = $1", (f"lk-{tag}",)),
        ("oauth_states", "INSERT INTO oauth_states (nonce, company_id, session_id, code_verifier, expires_at) VALUES ($1, $2, $3, 'test-verifier', NOW() + interval '1 hour')", (f"oauth-{tag}", company_id, f"oauth-session-{tag}"), "nonce = $1", (f"oauth-{tag}",)),
        ("integration_audit_events", "INSERT INTO integration_audit_events (company_id, provider, action, outcome) VALUES ($1, 'google', 'rls_test', 'success')", (company_id,), "company_id = $1 AND action = 'rls_test'", (company_id,)),
        ("calendar_booking_requests", "INSERT INTO calendar_booking_requests (user_id, idempotency_key, request_payload) VALUES ($1, $2, $3::jsonb)", (company_id, f"booking-{tag}", "{}"), "idempotency_key = $1", (f"booking-{tag}",)),
    ]


def test_rls_behavioral_fixture_covers_every_non_company_tenant_table():
    probes = _tenant_probe_rows(uuid.uuid4(), "fixture-check")
    assert {probe[0] for probe in probes} == TENANT_TABLES - {"companies"}
    assert all(probe[1].startswith("INSERT INTO ") and probe[3] for probe in probes)


def test_migrations_force_rls_and_define_scoped_policies_for_every_tenant_table():
    migration_dir = Path(__file__).resolve().parents[2] / "db" / "migrations"
    migration_sql = "\n".join(path.read_text(encoding="utf-8") for path in sorted(migration_dir.glob("*.sql")))
    forced_tables = {
        table.lower()
        for table in re.findall(
            r"ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+FORCE\s+ROW\s+LEVEL\s+SECURITY",
            migration_sql,
            flags=re.IGNORECASE,
        )
    }
    policy_tables = {
        table.lower()
        for table in re.findall(
            r"CREATE\s+POLICY\s+[a-z_][a-z0-9_]*\s+ON\s+([a-z_][a-z0-9_]*)",
            migration_sql,
            flags=re.IGNORECASE,
        )
    }

    assert TENANT_TABLES <= forced_tables, f"tenant tables missing FORCE RLS: {TENANT_TABLES - forced_tables}"
    assert TENANT_TABLES <= policy_tables, f"tenant tables missing policies: {TENANT_TABLES - policy_tables}"


@pytest.mark.asyncio
async def test_tenant_tables_force_rls_and_hide_cross_company_rows(
    db_pool: asyncpg.Pool, requires_migrated_oauth_schema
) -> None:
    company_a = uuid.uuid4()
    company_b = uuid.uuid4()

    async with db_pool.acquire() as conn:
        role_flags = await conn.fetchrow(
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
        )
        if role_flags["rolsuper"] or role_flags["rolbypassrls"]:
            pytest.skip(
                "RLS isolation must run with the dedicated NOSUPERUSER NOBYPASSRLS runtime role"
            )
        forced = await conn.fetch(
            """
            SELECT c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = ANY($1::text[])
              AND c.relforcerowsecurity
            """,
            list(TENANT_TABLES),
        )
        assert {row["relname"] for row in forced} == TENANT_TABLES

        policies = await conn.fetch(
            """
            SELECT tablename, qual, with_check
            FROM pg_policies
            WHERE schemaname = 'public' AND tablename = ANY($1::text[])
            """,
            list(TENANT_TABLES),
        )
        by_table = {}
        for policy in policies:
            by_table.setdefault(policy["tablename"], []).append(policy)
        assert set(by_table) == TENANT_TABLES
        for table_name, table_policies in by_table.items():
            # These tenant tables are row-scoped; a table-level unconditional
            # policy would silently negate FORCE ROW LEVEL SECURITY.
            assert all(policy["qual"] and policy["with_check"] for policy in table_policies), table_name
            assert all(
                "current_company_id" in policy["qual"]
                and "current_company_id" in policy["with_check"]
                for policy in table_policies
            ), table_name

        tx = conn.transaction()
        await tx.start()
        try:
            for company_id in (company_a, company_b):
                await conn.execute("SELECT set_config('app.company_id', $1, true)", str(company_id))
                await conn.execute(
                    "INSERT INTO companies (id, display_name) VALUES ($1, $2)",
                    company_id, f"RLS test {company_id}",
                )

            await conn.execute("SELECT set_config('app.company_id', $1, true)", str(company_a))
            probes = _tenant_probe_rows(company_a, uuid.uuid4().hex[:16])
            for table, insert_sql, insert_args, predicate, predicate_args in probes:
                await conn.execute(insert_sql, *insert_args)

            assert await conn.fetchval("SELECT 1 FROM companies WHERE id = $1", company_a) == 1
            await conn.execute("SELECT set_config('app.company_id', $1, true)", str(company_b))
            assert await conn.fetchval("SELECT 1 FROM companies WHERE id = $1", company_a) is None
            for table, _, _, predicate, predicate_args in probes:
                visible_to_other = await conn.fetchval(
                    f"SELECT count(*) FROM {table} WHERE {predicate}", *predicate_args
                )
                assert visible_to_other == 0, f"{table} leaked a company A row to company B"

            await conn.execute("SELECT set_config('app.company_id', $1, true)", str(company_a))
            for table, _, _, predicate, predicate_args in probes:
                visible_to_owner = await conn.fetchval(
                    f"SELECT count(*) FROM {table} WHERE {predicate}", *predicate_args
                )
                assert visible_to_owner == 1, f"company A cannot read its {table} row"

            await conn.execute("SELECT set_config('app.company_id', $1, true)", str(company_a))
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                async with conn.transaction():
                    await conn.execute(
                        "INSERT INTO companies (id, display_name) VALUES ($1, 'cross-company write')",
                        uuid.uuid4(),
                    )
        finally:
            await tx.rollback()
