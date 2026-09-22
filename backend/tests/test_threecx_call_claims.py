"""Unit coverage for the tenant-scoped 3CX durable claim boundary."""

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock
import uuid

import pytest

from db import threecx
from db.tenant_tables import TENANT_TABLES as RUNTIME_TABLE_GRANTS


def _pool_for_connection(conn):
    class Pool:
        @asynccontextmanager
        async def acquire(self):
            yield conn

    return Pool()


def _install_pool(monkeypatch, conn):
    pool = _pool_for_connection(conn)

    async def get_db_pool():
        return pool

    monkeypatch.setattr(threecx, "get_db_pool", get_db_pool)


def test_threecx_room_name_is_opaque_and_deterministic_per_company():
    room_a = threecx.threecx_room_name("company-a", "pbx-call-123")
    assert room_a == threecx.threecx_room_name("company-a", "pbx-call-123")
    assert room_a != threecx.threecx_room_name("company-b", "pbx-call-123")
    assert "pbx-call-123" not in room_a


@pytest.mark.asyncio
async def test_claim_accepts_one_new_event_and_creates_exactly_one_call(monkeypatch):
    company_id = str(uuid.uuid4())
    conn = AsyncMock()
    conn.fetchrow.side_effect = [
        {"dids": '["+23050000001"]', "state": "active"},
        {"event_id": "event-1"},
        {
            "company_id": uuid.UUID(company_id), "pbx_call_id": "pbx-call-1",
            "did": "+23050000001", "direction": "inbound", "state": "claimed",
            "claim_token": uuid.uuid4(), "livekit_room": "threecx-hash",
            "lease_expires_at": None, "livekit_dispatch_id": None,
        },
    ]

    @asynccontextmanager
    async def transaction():
        yield

    conn.transaction = transaction
    _install_pool(monkeypatch, conn)

    result = await threecx.claim_threecx_call(
        company_id=company_id, pbx_call_id="pbx-call-1", event_id="event-1",
        event_type="Ringing", did="+23050000001", direction="inbound",
    )

    assert result["claimed"] is True
    assert result["reason"] == "processed"
    assert len([call for call in conn.fetchrow.await_args_list if "INSERT INTO threecx_call_sessions" in call.args[0]]) == 1
    assert "ON CONFLICT (company_id, pbx_call_id) DO NOTHING" in conn.fetchrow.await_args_list[2].args[0]
    conn.execute.assert_any_await("SELECT set_config('app.company_id', $1, true)", company_id)


@pytest.mark.asyncio
async def test_duplicate_event_returns_before_call_claim(monkeypatch):
    conn = AsyncMock()
    conn.fetchrow.side_effect = [
        {"dids": ["+23050000001"], "state": "active"},
        None,
    ]

    @asynccontextmanager
    async def transaction():
        yield

    conn.transaction = transaction
    _install_pool(monkeypatch, conn)
    result = await threecx.claim_threecx_call(
        company_id=str(uuid.uuid4()), pbx_call_id="pbx-call-1", event_id="event-1",
        event_type="Ringing", did="+23050000001", direction="inbound",
    )
    assert result == {"claimed": False, "reason": "duplicate_event"}
    assert not any("INSERT INTO threecx_call_sessions" in call.args[0] for call in conn.fetchrow.await_args_list)


@pytest.mark.asyncio
async def test_distinct_event_for_existing_call_cannot_create_a_second_claim(monkeypatch):
    company_id = str(uuid.uuid4())
    existing_token = uuid.uuid4()
    existing_call = {
        "company_id": uuid.UUID(company_id), "pbx_call_id": "pbx-call-1",
        "did": "+23050000001", "direction": "inbound", "state": "active",
        "claim_token": existing_token, "livekit_room": "same-room",
        "lease_expires_at": None, "livekit_dispatch_id": "one-dispatch",
    }
    conn = AsyncMock()
    conn.fetchrow.side_effect = [
        {"dids": ["+23050000001"], "state": "active"},
        {"event_id": "event-2"},
        None,
        existing_call,
    ]

    @asynccontextmanager
    async def transaction():
        yield

    conn.transaction = transaction
    _install_pool(monkeypatch, conn)
    result = await threecx.claim_threecx_call(
        company_id=company_id, pbx_call_id="pbx-call-1", event_id="event-2",
        event_type="CallUpdated", did="+23050000001", direction="inbound",
    )

    assert result["claimed"] is False
    assert result["reason"] == "duplicate"
    assert result["call"]["claim_token"] == existing_token
    assert result["call"]["livekit_dispatch_id"] == "one-dispatch"
    conn.fetchrow.assert_awaited()
    call_insert_sql = next(
        call.args[0] for call in conn.fetchrow.await_args_list
        if "INSERT INTO threecx_call_sessions" in call.args[0]
    )
    assert "ON CONFLICT (company_id, pbx_call_id) DO NOTHING" in call_insert_sql


@pytest.mark.asyncio
async def test_claim_fails_closed_for_inactive_or_unconfigured_did(monkeypatch):
    conn = AsyncMock()
    conn.fetchrow.return_value = {"dids": '["+23050000002"]', "state": "active"}

    @asynccontextmanager
    async def transaction():
        yield

    conn.transaction = transaction
    _install_pool(monkeypatch, conn)
    with pytest.raises(PermissionError, match="active 3CX integration"):
        await threecx.claim_threecx_call(
            company_id=str(uuid.uuid4()), pbx_call_id="pbx-call-1", event_id="event-1",
            event_type="Ringing", did="+23050000001", direction="inbound",
        )
    assert conn.fetchrow.await_count == 1


@pytest.mark.asyncio
async def test_call_transition_is_compare_and_set_and_terminal_states_cannot_resurrect(monkeypatch):
    conn = AsyncMock()
    conn.execute.return_value = "UPDATE 1"

    @asynccontextmanager
    async def transaction():
        yield

    conn.transaction = transaction
    _install_pool(monkeypatch, conn)

    with pytest.raises(ValueError, match="illegal 3CX call transition"):
        await threecx.transition_threecx_call(
            company_id=str(uuid.uuid4()), pbx_call_id="pbx-call-1", claim_token=uuid.uuid4(),
            expected_state="ended", new_state="active",
        )
    assert conn.execute.await_count == 0

    assert await threecx.transition_threecx_call(
        company_id=str(uuid.uuid4()), pbx_call_id="pbx-call-1", claim_token=uuid.uuid4(),
        expected_state="claimed", new_state="connecting", livekit_dispatch_id="dispatch-1",
    ) is True
    sql = conn.execute.await_args_list[-1].args[0]
    assert "AND state = $4" in sql and "claim_token = $3" in sql


@pytest.mark.asyncio
async def test_call_lease_renewal_cannot_revive_an_expired_claim(monkeypatch):
    conn = AsyncMock()
    conn.execute.return_value = "UPDATE 0"

    @asynccontextmanager
    async def transaction():
        yield

    conn.transaction = transaction
    _install_pool(monkeypatch, conn)
    company_id = str(uuid.uuid4())
    claim_token = uuid.uuid4()

    renewed = await threecx.renew_threecx_call_lease(
        company_id=company_id,
        pbx_call_id="opaque-pbx-call",
        claim_token=claim_token,
    )

    assert renewed is False
    sql = conn.execute.await_args_list[-1].args[0]
    assert "lease_expires_at > NOW()" in sql
    assert conn.execute.await_args_list[-1].args[1:4] == (uuid.UUID(company_id), "opaque-pbx-call", claim_token)


def test_call_transition_graph_is_explicit_and_terminal():
    assert threecx.THREECX_CALL_TRANSITIONS["active"] == {"transferring", "ending", "failed"}
    assert threecx.THREECX_CALL_TRANSITIONS["ended"] == set()
    assert threecx.THREECX_CALL_TRANSITIONS["failed"] == set()


def test_new_threecx_call_tables_are_granted_to_the_non_bypass_runtime_role():
    assert {"threecx_call_sessions", "threecx_event_inbox"} <= set(RUNTIME_TABLE_GRANTS)
    assert "credential_broker_nonces" in RUNTIME_TABLE_GRANTS
