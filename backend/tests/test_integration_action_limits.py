"""Persistent 3CX attempt budgets stay tenant-scoped and atomic at the repository boundary."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from backend.app.api import integrations
from db import integration_limits


class _Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False


class _Connection:
    def __init__(self, consumed, retry_after=0):
        self.execute = AsyncMock()
        self.fetchrow = AsyncMock(return_value=consumed)
        self.fetchval = AsyncMock(return_value=retry_after)

    def transaction(self):
        return _Transaction()


class _Pool:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return False


@pytest.mark.asyncio
async def test_budget_consumption_sets_tenant_scope_and_uses_atomic_upsert():
    conn = _Connection({"attempt_count": 1})
    pool = SimpleNamespace(acquire=lambda: _Pool(conn))
    with patch.object(integration_limits, "get_db_pool", new=AsyncMock(return_value=pool)):
        result = await integration_limits.consume_integration_action_budget(
            company_id="4e6c8f78-d4f2-4a63-9dcf-a9c62059705c",
            action="threecx_test",
            limit=5,
            window_seconds=900,
        )

    assert result is None
    assert conn.execute.await_args.args[1] == "4e6c8f78-d4f2-4a63-9dcf-a9c62059705c"
    sql = conn.fetchrow.await_args.args[0]
    assert "ON CONFLICT (company_id, action) DO UPDATE" in sql
    assert "attempt_count < $3" in sql


@pytest.mark.asyncio
async def test_exhausted_budget_returns_retry_after_without_incrementing_again():
    conn = _Connection(None, retry_after=417)
    pool = SimpleNamespace(acquire=lambda: _Pool(conn))
    with patch.object(integration_limits, "get_db_pool", new=AsyncMock(return_value=pool)):
        retry_after = await integration_limits.consume_integration_action_budget(
            company_id="4e6c8f78-d4f2-4a63-9dcf-a9c62059705c",
            action="threecx_save",
            limit=3,
            window_seconds=900,
        )

    assert retry_after == 417
    conn.fetchval.assert_awaited_once()


@pytest.mark.asyncio
async def test_api_rejects_exhausted_3cx_budget_with_retry_after(monkeypatch):
    monkeypatch.setattr(
        integrations,
        "consume_integration_action_budget",
        AsyncMock(return_value=180),
    )
    with pytest.raises(HTTPException) as error:
        await integrations._enforce_threecx_budget("company", "threecx_test")

    assert error.value.status_code == 429
    assert error.value.headers["Retry-After"] == "180"


def test_runtime_role_receives_only_the_rls_limited_rate_budget_table():
    from db.tenant_tables import TENANT_TABLES

    assert "integration_action_limits" in TENANT_TABLES
