from __future__ import annotations

import asyncio
import uuid
from typing import Any

import asyncpg
import pytest

from db import assistant_configuration
from db.agent_profiles import list_agent_profile_versions
from db.companies import ensure_company
from db.settings import get_assistant_config


class _Transaction:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        self.connection.transaction_active = True
        return self

    async def __aexit__(self, exc_type, *_args):
        self.connection.transaction_active = False
        self.connection.rolled_back = exc_type is not None
        self.connection.committed = exc_type is None
        return False


class _Connection:
    def __init__(self):
        self.transaction_active = False
        self.rolled_back = False
        self.committed = False
        self.statements = []

    def transaction(self):
        return _Transaction(self)

    async def execute(self, query, *args):
        self.statements.append((query, args))


class _Pool:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return False

    def acquire(self):
        return self


def _request(company_id: str, is_deployed: bool = False) -> dict[str, Any]:
    return {
        "company_id": company_id,
        "created_by": f"auth:{company_id}",
        "assistant_name": "Test Assistant",
        "voice_engine": "Aoede",
        "inbound_greeting": "Hello",
        "system_prompt": "Calendar only",
        "knowledge_base_notes": "",
        "is_deployed": is_deployed,
        "profile": {"assistant_name": "Test Assistant"},
        "compiled_policy": {"platformPolicyVersion": "test-v1"},
    }


@pytest.mark.asyncio
async def test_legacy_and_version_writes_share_one_transaction(monkeypatch):
    company_id = str(uuid.uuid4())
    connection = _Connection()
    calls = []

    async def get_pool():
        return _Pool(connection)

    async def save_legacy(conn, **kwargs):
        calls.append(("legacy", conn, conn.transaction_active))
        return {"assistant_name": kwargs["assistant_name"]}

    async def save_version(conn, **kwargs):
        calls.append(("version", conn, conn.transaction_active))
        return {"version": 7}

    monkeypatch.setattr(assistant_configuration, "get_db_pool", get_pool)
    monkeypatch.setattr(assistant_configuration, "save_assistant_config_on_connection", save_legacy)
    monkeypatch.setattr(assistant_configuration, "save_agent_profile_version_on_connection", save_version)

    result = await assistant_configuration.save_assistant_configuration(**_request(company_id))

    assert result[0]["assistant_name"] == "Test Assistant"
    assert result[1]["version"] == 7
    assert [call[0] for call in calls] == ["legacy", "version"]
    assert all(call[1] is connection and call[2] for call in calls)
    assert connection.committed is True
    assert connection.rolled_back is False
    assert "set_config('app.company_id'" in connection.statements[0][0]


@pytest.mark.asyncio
async def test_profile_failure_rolls_back_transaction_and_logs_no_payload(monkeypatch, caplog):
    company_id = str(uuid.uuid4())
    connection = _Connection()

    async def get_pool():
        return _Pool(connection)

    async def save_legacy(conn, **_kwargs):
        assert conn.transaction_active
        return {"system_prompt": "must-not-be-logged"}

    async def save_version(conn, **_kwargs):
        assert conn.transaction_active
        error = RuntimeError("failure containing must-not-be-logged")
        error.sqlstate = "42P08"
        raise error

    monkeypatch.setattr(assistant_configuration, "get_db_pool", get_pool)
    monkeypatch.setattr(assistant_configuration, "save_assistant_config_on_connection", save_legacy)
    monkeypatch.setattr(assistant_configuration, "save_agent_profile_version_on_connection", save_version)

    with pytest.raises(RuntimeError):
        await assistant_configuration.save_assistant_configuration(**_request(company_id))

    assert connection.committed is False
    assert connection.rolled_back is True
    assert "stage=profile_version_insert" in caplog.text
    assert "sqlstate=42P08" in caplog.text
    assert "must-not-be-logged" not in caplog.text


@pytest.mark.asyncio
async def test_live_postgres_save_assistant_configuration_draft_and_publish(db_pool: asyncpg.Pool):
    """Verify live PostgreSQL atomic persistence for draft and publish workflows."""
    company_id = str(uuid.uuid4())
    auth_subject = f"auth:{company_id}"

    async with db_pool.acquire() as conn:
        role_flags = await conn.fetchrow(
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
        )
        if role_flags["rolsuper"] or role_flags["rolbypassrls"]:
            pytest.skip("Must run with the dedicated NOSUPERUSER NOBYPASSRLS runtime role")

    await ensure_company(company_id=company_id, auth_subject=auth_subject, display_name="Integration Co")

    # 1. Save draft
    req_draft = _request(company_id, is_deployed=False)
    req_draft["assistant_name"] = "Draft Bot"
    req_draft["system_prompt"] = "Draft Prompt"
    legacy_draft, profile_draft = await assistant_configuration.save_assistant_configuration(**req_draft)

    assert legacy_draft["assistant_name"] == "Draft Bot"
    assert legacy_draft["is_deployed"] is False
    assert profile_draft["version"] == 1
    assert profile_draft["lifecycle_state"] == "draft"
    assert profile_draft["published_at"] is None

    # Verify reads from database
    config_read = await get_assistant_config(user_id=company_id)
    assert config_read is not None
    assert config_read["assistant_name"] == "Draft Bot"
    assert config_read["is_deployed"] is False

    versions = await list_agent_profile_versions(company_id=company_id)
    assert len(versions) == 1
    assert versions[0]["version"] == 1
    assert versions[0]["lifecycle_state"] == "draft"

    # 2. Save published
    req_pub = _request(company_id, is_deployed=True)
    req_pub["assistant_name"] = "Published Bot"
    req_pub["system_prompt"] = "Published Prompt"
    legacy_pub, profile_pub = await assistant_configuration.save_assistant_configuration(**req_pub)

    assert legacy_pub["assistant_name"] == "Published Bot"
    assert legacy_pub["is_deployed"] is True
    assert profile_pub["version"] == 2
    assert profile_pub["lifecycle_state"] == "published"
    assert profile_pub["published_at"] is not None

    versions_after = await list_agent_profile_versions(company_id=company_id)
    assert len(versions_after) == 2
    by_version = {v["version"]: v for v in versions_after}
    assert by_version[1]["lifecycle_state"] == "draft"
    assert by_version[2]["lifecycle_state"] == "published"

    # 3. Publish a new version: check that v2 transitions to superseded
    req_pub2 = _request(company_id, is_deployed=True)
    req_pub2["assistant_name"] = "Published Bot v2"
    legacy_pub2, profile_pub2 = await assistant_configuration.save_assistant_configuration(**req_pub2)

    assert profile_pub2["version"] == 3
    assert profile_pub2["lifecycle_state"] == "published"

    versions_final = await list_agent_profile_versions(company_id=company_id)
    by_version_final = {v["version"]: v for v in versions_final}
    assert by_version_final[2]["lifecycle_state"] == "superseded"
    assert by_version_final[3]["lifecycle_state"] == "published"


@pytest.mark.asyncio
async def test_live_postgres_transaction_rollback_on_profile_failure(db_pool: asyncpg.Pool, monkeypatch):
    """Verify that if profile version write fails, the legacy assistant_configs write is rolled back."""
    company_id = str(uuid.uuid4())
    auth_subject = f"auth:{company_id}"

    async with db_pool.acquire() as conn:
        role_flags = await conn.fetchrow(
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
        )
        if role_flags["rolsuper"] or role_flags["rolbypassrls"]:
            pytest.skip("Must run with the dedicated NOSUPERUSER NOBYPASSRLS runtime role")

    await ensure_company(company_id=company_id, auth_subject=auth_subject, display_name="Rollback Co")

    req = _request(company_id, is_deployed=False)
    req["assistant_name"] = "Initial State"
    await assistant_configuration.save_assistant_configuration(**req)

    # Now attempt a save where profile write fails
    req_fail = _request(company_id, is_deployed=True)
    req_fail["assistant_name"] = "Attempted Mutation"

    async def fail_save_profile(*args, **kwargs):
        raise asyncpg.CheckViolationError("Simulated failure in profile insertion")

    monkeypatch.setattr(assistant_configuration, "save_agent_profile_version_on_connection", fail_save_profile)

    with pytest.raises(asyncpg.CheckViolationError):
        await assistant_configuration.save_assistant_configuration(**req_fail)

    # Check that database was rolled back to Initial State
    config_after = await get_assistant_config(user_id=company_id)
    assert config_after["assistant_name"] == "Initial State"
    assert config_after["is_deployed"] is False


@pytest.mark.asyncio
async def test_live_postgres_concurrent_saves_allocate_sequential_versions(db_pool: asyncpg.Pool):
    """Verify that concurrent saves for the same company serialize on advisory lock and allocate distinct versions."""
    company_id = str(uuid.uuid4())
    auth_subject = f"auth:{company_id}"

    async with db_pool.acquire() as conn:
        role_flags = await conn.fetchrow(
            "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
        )
        if role_flags["rolsuper"] or role_flags["rolbypassrls"]:
            pytest.skip("Must run with the dedicated NOSUPERUSER NOBYPASSRLS runtime role")

    await ensure_company(company_id=company_id, auth_subject=auth_subject, display_name="Concurrency Co")

    # Run 5 concurrent saves
    async def do_save(idx: int):
        req = _request(company_id, is_deployed=False)
        req["assistant_name"] = f"Concurrent Bot {idx}"
        return await assistant_configuration.save_assistant_configuration(**req)

    results = await asyncio.gather(*(do_save(i) for i in range(5)))
    versions_allocated = sorted([res[1]["version"] for res in results])
    assert versions_allocated == [1, 2, 3, 4, 5]

    all_versions = await list_agent_profile_versions(company_id=company_id)
    assert len(all_versions) == 5
