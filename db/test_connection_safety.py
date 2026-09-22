import asyncio
import json

import pytest

from db import connection
from scripts import inspect_schema


def test_local_process_refuses_protected_branch_from_environment(monkeypatch, tmp_path):
    monkeypatch.setattr(connection, "_root_dir", tmp_path)
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NEON_BRANCH", "production")

    with pytest.raises(RuntimeError, match="cannot connect to the protected Neon branch"):
        connection.assert_database_branch_is_safe()


def test_database_access_requires_an_explicit_branch(monkeypatch, tmp_path):
    monkeypatch.setattr(connection, "_root_dir", tmp_path)
    monkeypatch.delenv("NEON_BRANCH", raising=False)
    monkeypatch.setenv("APP_ENV", "development")

    with pytest.raises(RuntimeError, match="NEON_BRANCH must explicitly identify"):
        connection.assert_database_branch_is_safe()


def test_linked_branch_and_environment_must_match(monkeypatch, tmp_path):
    monkeypatch.setattr(connection, "_root_dir", tmp_path)
    (tmp_path / ".neon").write_text(json.dumps({"branch": "production"}), encoding="utf-8")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NEON_BRANCH", "isolated-test")

    with pytest.raises(RuntimeError, match="does not match the linked Neon branch"):
        connection.assert_database_branch_is_safe()


def test_production_runtime_may_select_production_branch(monkeypatch, tmp_path):
    monkeypatch.setattr(connection, "_root_dir", tmp_path)
    (tmp_path / ".neon").write_text(json.dumps({"branch": "production"}), encoding="utf-8")
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("NEON_BRANCH", "production")

    connection.assert_database_branch_is_safe()


def test_protected_branch_guard_runs_before_any_database_connection(monkeypatch, tmp_path):
    monkeypatch.setattr(connection, "_root_dir", tmp_path)
    (tmp_path / ".neon").write_text(json.dumps({"branch": "production"}), encoding="utf-8")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NEON_BRANCH", "production")
    monkeypatch.setattr(connection, "_pool", None)

    async def unexpected_connect(**_kwargs):
        pytest.fail("database pool must not be opened for a protected development target")

    monkeypatch.setattr(connection.asyncpg, "create_pool", unexpected_connect)
    with pytest.raises(RuntimeError, match="cannot connect to the protected Neon branch"):
        asyncio.run(connection.get_db_pool("postgresql://example.invalid/database"))


def test_read_only_schema_inventory_rejects_a_stale_branch_label(monkeypatch, tmp_path):
    monkeypatch.setattr(connection, "_root_dir", tmp_path)
    (tmp_path / ".neon").write_text(json.dumps({"branch": "production"}), encoding="utf-8")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("NEON_BRANCH", "codex-test")
    monkeypatch.setenv("DATABASE_URL", "postgresql://example.invalid/database")

    async def unexpected_connect(*_args, **_kwargs):
        pytest.fail("schema inventory must validate the linked branch before connecting")

    monkeypatch.setattr(inspect_schema.asyncpg, "connect", unexpected_connect)
    with pytest.raises(RuntimeError, match="does not match the linked Neon branch"):
        asyncio.run(inspect_schema.main())
