from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock
import uuid

import pytest

from backend.app.api import settings as settings_api
from db import livekit_sessions


def _install_pool(monkeypatch, connection):
    class Pool:
        @asynccontextmanager
        async def acquire(self):
            yield connection

    async def get_pool():
        return Pool()

    monkeypatch.setattr(livekit_sessions, "get_db_pool", get_pool)


@pytest.mark.asyncio
async def test_livekit_retry_reuses_only_the_original_profile_binding(monkeypatch):
    connection = MagicMock()
    connection.transaction = MagicMock()

    @asynccontextmanager
    async def transaction():
        yield

    connection.transaction = transaction
    connection.execute = AsyncMock()
    connection.fetchrow = AsyncMock(return_value={
        "room_name": "room-one", "dispatch_id": "dispatch-one", "profile_version": 7,
    })
    _install_pool(monkeypatch, connection)
    company_id = str(uuid.uuid4())
    create_dispatch = AsyncMock(return_value="should-not-be-created")

    reused = await livekit_sessions.get_or_create_session(
        user_id=company_id, session_id="session-12345678", room_name="room-one",
        create_dispatch=create_dispatch, profile_version=7,
    )
    assert reused["reused"] is True
    assert reused["profile_version"] == 7
    create_dispatch.assert_not_awaited()

    with pytest.raises(livekit_sessions.SessionProfileConflict):
        await livekit_sessions.get_or_create_session(
            user_id=company_id, session_id="session-12345678", room_name="room-one",
            create_dispatch=create_dispatch, profile_version=8,
        )


@pytest.mark.asyncio
async def test_livekit_preview_accepts_only_own_unpublished_profile(monkeypatch):
    company_id = str(uuid.uuid4())
    get_version = AsyncMock(return_value={
        "version": 3,
        "lifecycle_state": "draft",
        "profile": {"assistant_name": "Draft"},
        "compiled_policy": {"allowedTools": []},
    })
    monkeypatch.setattr(settings_api, "get_agent_profile_version", get_version)
    result = await settings_api.resolve_livekit_profile(company_id, 3)
    assert result["version"] == 3
    get_version.assert_awaited_once_with(company_id=company_id, version=3)

    get_version.return_value = {"version": 2, "lifecycle_state": "published", "profile": {}, "compiled_policy": {}}
    with pytest.raises(settings_api.HTTPException) as raised:
        await settings_api.resolve_livekit_profile(company_id, 2)
    assert raised.value.status_code == 409

    get_version.return_value = None
    with pytest.raises(settings_api.HTTPException) as raised:
        await settings_api.resolve_livekit_profile(company_id, 99)
    assert raised.value.status_code == 404


def test_livekit_token_requires_a_published_or_preview_profile():
    with pytest.raises(settings_api.HTTPException) as raised:
        settings_api.require_livekit_profile(None)
    assert raised.value.status_code == 409

    with pytest.raises(settings_api.HTTPException):
        settings_api.require_livekit_profile({"profile": {}})

    profile = {"version": 4, "lifecycle_state": "published"}
    assert settings_api.require_livekit_profile(profile) is profile
