from __future__ import annotations

import uuid

import pytest

from db import agent_profiles


class _Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False


class _Connection:
    def __init__(self):
        self.statements: list[str] = []

    def transaction(self):
        return _Transaction()

    async def execute(self, query, *_args):
        self.statements.append(query)

    async def fetchval(self, query, *_args):
        self.statements.append(query)
        return 3

    async def fetchrow(self, query, *_args):
        self.statements.append(query)
        return {"company_id": uuid.uuid4(), "version": 3, "lifecycle_state": "draft"}


class _Pool:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return False

    def acquire(self):
        return self


@pytest.mark.asyncio
async def test_profile_version_allocation_is_serialized_per_company(monkeypatch):
    connection = _Connection()

    async def get_pool():
        return _Pool(connection)

    monkeypatch.setattr(agent_profiles, "get_db_pool", get_pool)
    company_id = str(uuid.uuid4())

    await agent_profiles.save_agent_profile_version(
        company_id=company_id,
        created_by=company_id,
        profile={"assistant_name": "Test"},
        compiled_policy={"platformPolicyVersion": "v1"},
        published=False,
    )

    lock_index = next(i for i, query in enumerate(connection.statements) if "pg_advisory_xact_lock" in query)
    allocation_index = next(i for i, query in enumerate(connection.statements) if "MAX(version)" in query)
    assert lock_index < allocation_index
