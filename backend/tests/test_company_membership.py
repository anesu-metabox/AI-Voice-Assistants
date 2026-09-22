"""Company provisioning binds ownership to the authenticated Neon subject."""

from contextlib import asynccontextmanager
import uuid
from unittest.mock import AsyncMock

import pytest

from db import companies


@pytest.mark.asyncio
async def test_company_provisioning_persists_auth_subject_not_company_uuid(monkeypatch):
    company_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    auth_subject = "neon-user-subject-1"
    conn = AsyncMock()
    conn.fetchrow.side_effect = [None, {"company_id": company_id, "status": "active"}]

    @asynccontextmanager
    async def transaction():
        yield

    conn.transaction = transaction

    class Pool:
        @asynccontextmanager
        async def acquire(self):
            yield conn

    async def get_db_pool():
        return Pool()

    monkeypatch.setattr(companies, "get_db_pool", get_db_pool)
    await companies.ensure_company(company_id, auth_subject, "Example")

    membership_insert = next(
        call for call in conn.execute.await_args_list
        if "INSERT INTO company_memberships" in call.args[0]
    )
    assert membership_insert.args[1:] == (
        uuid.UUID(company_id), auth_subject,
    )
    assert auth_subject != company_id


@pytest.mark.asyncio
async def test_company_provisioning_rejects_membership_bound_to_another_company(monkeypatch):
    conn = AsyncMock()
    conn.fetchrow.return_value = {
        "company_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "status": "active",
    }

    @asynccontextmanager
    async def transaction():
        yield

    conn.transaction = transaction

    class Pool:
        @asynccontextmanager
        async def acquire(self):
            yield conn

    async def get_db_pool():
        return Pool()

    monkeypatch.setattr(companies, "get_db_pool", get_db_pool)
    with pytest.raises(PermissionError, match="another company"):
        await companies.ensure_company(
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "neon-user-subject-1"
        )
    assert not any("INSERT INTO company_memberships" in call.args[0] for call in conn.execute.await_args_list)
