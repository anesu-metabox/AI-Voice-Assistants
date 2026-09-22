"""OAuth PKCE state repository behavior under forced tenant RLS."""

from datetime import datetime, timezone

import pytest

from db import oauth_states


class _Transaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False


class _Connection:
    def __init__(self):
        self.calls: list[tuple[str, tuple]] = []
        self.in_transaction = False

    def transaction(self):
        return _Transaction()

    async def execute(self, query, *args):
        self.calls.append((query, args))
        return "INSERT 0 1"

    async def fetchrow(self, query, *args):
        self.calls.append((query, args))
        return {
            "company_id": args[1],
            "session_id": "session-a",
            "code_verifier": "secret-verifier",
        }


class _Acquire:
    def __init__(self, connection):
        self.connection = connection

    async def __aenter__(self):
        return self.connection

    async def __aexit__(self, *_args):
        return False


class _Pool:
    def __init__(self, connection):
        self.connection = connection

    def acquire(self):
        return _Acquire(self.connection)


@pytest.mark.asyncio
async def test_save_oauth_state_sets_tenant_context_before_insert(monkeypatch):
    connection = _Connection()
    async def get_pool():
        return _Pool(connection)

    monkeypatch.setattr(oauth_states, "get_db_pool", get_pool)

    await oauth_states.save_oauth_state(
        nonce="nonce-a",
        company_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        session_id="session-a",
        code_verifier="secret-verifier",
        expires_at=datetime.now(timezone.utc),
    )

    assert "set_config('app.company_id', $1, true)" in connection.calls[0][0]
    assert connection.calls[0][1] == ("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",)
    assert "INSERT INTO oauth_states" in connection.calls[1][0]


@pytest.mark.asyncio
async def test_consume_oauth_state_is_transactionally_company_scoped(monkeypatch):
    connection = _Connection()
    async def get_pool():
        return _Pool(connection)

    monkeypatch.setattr(oauth_states, "get_db_pool", get_pool)
    company_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

    row = await oauth_states.consume_oauth_state("nonce-a", company_id)

    assert row["company_id"] == company_id
    assert "set_config('app.company_id', $1, true)" in connection.calls[0][0]
    assert "company_id = $2::uuid" in connection.calls[1][0]
    assert connection.calls[1][1][0:2] == ("nonce-a", company_id)
