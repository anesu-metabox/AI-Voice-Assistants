"""Call-history queries expose only bounded, tenant-scoped display metadata."""

from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import uuid

import pytest
from fastapi import HTTPException

from backend.app.api import integrations
from db import threecx


class _Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False


class _Connection:
    def __init__(self, rows):
        self.execute = AsyncMock()
        self.fetch = AsyncMock(return_value=rows)

    def transaction(self):
        return _Transaction()


class _Acquire:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return False


@pytest.mark.asyncio
async def test_repository_scopes_call_history_and_selects_only_display_fields():
    row = {
        "did": "+23050000000",
        "direction": "inbound",
        "state": "ended",
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
        "ended_at": datetime.now(timezone.utc),
    }
    connection = _Connection([row])
    pool = SimpleNamespace(acquire=lambda: _Acquire(connection))

    with patch.object(threecx, "get_db_pool", new=AsyncMock(return_value=pool)):
        records = await threecx.list_threecx_call_sessions(
            company_id="4e6c8f78-d4f2-4a63-9dcf-a9c62059705c",
            limit=25,
        )

    assert records == [row]
    assert connection.execute.await_args.args[1] == "4e6c8f78-d4f2-4a63-9dcf-a9c62059705c"
    sql, company, limit = connection.fetch.await_args.args
    assert "WHERE company_id = $1" in sql
    assert "ORDER BY created_at DESC" in sql
    assert "pbx_call_id DESC" in sql
    assert "claim_token" not in sql and "livekit_room" not in sql
    assert company == uuid.UUID("4e6c8f78-d4f2-4a63-9dcf-a9c62059705c")
    assert limit == 25


@pytest.mark.asyncio
async def test_repository_rejects_unbounded_limits_before_database_access():
    with patch.object(threecx, "get_db_pool", new=AsyncMock()) as get_pool:
        with pytest.raises(ValueError):
            await threecx.list_threecx_call_sessions(
                company_id="4e6c8f78-d4f2-4a63-9dcf-a9c62059705c", limit=101
            )
    get_pool.assert_not_awaited()


def test_migration_indexes_tenant_scoped_recent_history_order():
    migration = Path(__file__).resolve().parents[2] / "db" / "migrations" / "019_threecx_call_history_index.sql"
    sql = migration.read_text(encoding="utf-8")
    assert "ON threecx_call_sessions (company_id, created_at DESC, pbx_call_id DESC)" in sql


@pytest.mark.asyncio
async def test_api_requires_verified_context_and_serializes_safe_metadata(monkeypatch):
    now = datetime.now(timezone.utc)
    context = SimpleNamespace(company_id="company", auth_subject="subject")
    monkeypatch.setattr(integrations, "verify_session_context", lambda _raw: None)
    with pytest.raises(HTTPException) as error:
        await integrations.list_3cx_calls(limit=50, verified_context_header="bad")
    assert error.value.status_code == 401

    monkeypatch.setattr(integrations, "verify_session_context", lambda _raw: context)
    monkeypatch.setattr(integrations, "ensure_company", AsyncMock())
    monkeypatch.setattr(
        integrations,
        "list_threecx_call_sessions",
        AsyncMock(return_value=[{
            "did": "+23050000000", "direction": "inbound", "state": "ended",
            "created_at": now, "updated_at": now, "ended_at": now,
            "pbx_call_id": "must-not-leak", "claim_token": "must-not-leak",
        }]),
    )

    result = await integrations.list_3cx_calls(limit=50, verified_context_header="signed")
    assert result["calls"][0]["did"] == "+23050000000"
    assert "pbx_call_id" not in result["calls"][0]
    assert "claim_token" not in result["calls"][0]
    assert "livekit_room" not in result["calls"][0]
