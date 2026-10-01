"""Focused contracts for the response-latency fast paths."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
import uuid

import pytest

from backend.app.services import credential_broker_client, google_calendar, google_oauth, profile_cache
from backend.app.services.calendar_read_cache import CalendarReadCache
from backend.app.services.latency import normalized_trace_id
from backend.app.config import settings
from db import calendar_mirror


def test_trace_ids_are_bounded_and_untrusted_values_are_replaced():
    assert normalized_trace_id("agent-123") == "agent-123"
    assert len(normalized_trace_id("bad value with spaces")) == 32
    assert len(normalized_trace_id("x" * 1000)) == 32


@pytest.mark.asyncio
async def test_broker_http_pool_is_reused_and_closed(monkeypatch):
    await credential_broker_client.close_broker_http_client()
    created = 0

    class Response:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"ok": True}

    class Client:
        is_closed = False

        def __init__(self, **_kwargs):
            nonlocal created
            created += 1

        async def post(self, *_args, **_kwargs):
            return Response()

        async def aclose(self):
            self.is_closed = True

    monkeypatch.setattr(credential_broker_client.httpx, "AsyncClient", Client)
    monkeypatch.setattr(settings, "credential_broker_shared_secret", "s" * 32)
    monkeypatch.setattr(settings, "credential_broker_url", "http://localhost:8001")
    await credential_broker_client.broker_post(
        "/internal/v1/test", {"company_id": str(uuid.uuid4())}
    )
    await credential_broker_client.broker_post(
        "/internal/v1/test", {"company_id": str(uuid.uuid4())}
    )
    assert created == 1
    await credential_broker_client.close_broker_http_client()


@pytest.mark.asyncio
async def test_profile_snapshot_cache_coalesces_and_returns_copies(monkeypatch):
    await profile_cache.clear_profile_snapshot_cache()
    calls = 0

    async def load(**_kwargs):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0)
        return {"version": 7, "compiled_policy": {"allowedTools": []}}

    monkeypatch.setattr(profile_cache, "get_published_agent_profile", load)
    company_id = str(uuid.uuid4())
    first, second = await asyncio.gather(
        profile_cache.get_cached_published_agent_profile(company_id=company_id, version=7),
        profile_cache.get_cached_published_agent_profile(company_id=company_id, version=7),
    )
    assert calls == 1
    assert first == second
    first["compiled_policy"]["allowedTools"].append("mutated")
    third = await profile_cache.get_cached_published_agent_profile(
        company_id=company_id, version=7
    )
    assert third["compiled_policy"]["allowedTools"] == []


@pytest.mark.asyncio
async def test_access_token_cache_avoids_repeated_database_decryption(monkeypatch):
    await google_oauth.clear_access_token_cache()
    calls = 0
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)

    async def get_tokens(**_kwargs):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0)
        return {"access_token": "access", "expires_at": expires_at}

    monkeypatch.setattr(google_oauth, "get_oauth_tokens", get_tokens)
    company_id = str(uuid.uuid4())
    results = await asyncio.gather(
        *(google_oauth.get_valid_access_token(company_id) for _ in range(5))
    )
    assert results == ["access"] * 5
    assert calls == 1


@pytest.mark.asyncio
async def test_calendar_read_cache_coalesces_and_invalidates_by_company():
    cache = CalendarReadCache(max_entries=4)
    company_id = str(uuid.uuid4())
    calls = 0

    async def load():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0)
        return {"events": [], "source": "google_calendar_live"}

    key = (company_id, "list", "2026-10-01")
    results = await asyncio.gather(
        *(cache.get_or_load(key, ttl_seconds=30, loader=load) for _ in range(5))
    )
    assert calls == 1
    assert all(result == results[0] for result in results)
    await cache.invalidate_company(company_id)
    await cache.get_or_load(key, ttl_seconds=30, loader=load)
    assert calls == 2


@pytest.mark.asyncio
async def test_active_calendar_mirrors_are_periodically_reconciled(monkeypatch):
    await google_calendar.clear_active_calendar_companies()
    company_id = str(uuid.uuid4())
    calls = []

    async def sync(user_id, *, timezone_name, force_full=False, register_active=True):
        calls.append((user_id, timezone_name, force_full, register_active))
        return True

    monkeypatch.setattr(google_calendar, "sync_google_calendar_mirror", sync)
    await google_calendar.note_active_calendar_company(company_id, "Indian/Mauritius")
    result = await google_calendar.reconcile_active_calendar_mirrors_once()

    assert result == {"active": 1, "succeeded": 1, "failed": 0}
    assert calls == [(company_id, "Indian/Mauritius", False, False)]
    await google_calendar.clear_active_calendar_companies()


@pytest.mark.asyncio
async def test_confirmed_provider_write_marks_enabled_mirror_stale(monkeypatch):
    calls = []

    async def mark(company_id):
        calls.append(company_id)

    monkeypatch.setattr(settings, "calendar_mirror_enabled", True)
    monkeypatch.setattr(calendar_mirror, "mark_calendar_sync_stale", mark)
    company_id = str(uuid.uuid4())

    await google_calendar._mark_calendar_mirror_stale_after_write(company_id)

    assert calls == [company_id]


@pytest.mark.asyncio
async def test_live_event_list_is_bounded_for_realtime_voice(monkeypatch):
    captured = {}

    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {
                "items": [
                    {
                        "id": f"event-{index}",
                        "summary": f"Event {index}",
                        "start": {"dateTime": "2026-10-01T09:00:00+04:00"},
                        "end": {"dateTime": "2026-10-01T09:30:00+04:00"},
                    }
                    for index in range(google_calendar.MAX_VOICE_CALENDAR_EVENTS + 1)
                ]
            }

    class Client:
        async def get(self, _url, *, headers, params):
            captured.update(params=params)
            return Response()

    async def token(_company_id):
        return "token"

    monkeypatch.setattr(google_calendar, "get_valid_access_token", token)
    monkeypatch.setattr(google_calendar, "get_http_client", lambda: Client())
    result = await google_calendar._list_google_calendar_events_live(
        str(uuid.uuid4()), "2026-10-01", "2026-10-01"
    )

    assert captured["params"]["maxResults"] == str(
        google_calendar.MAX_VOICE_CALENDAR_EVENTS + 1
    )
    assert result["count"] == google_calendar.MAX_VOICE_CALENDAR_EVENTS
    assert len(result["events"]) == google_calendar.MAX_VOICE_CALENDAR_EVENTS
    assert result["truncated"] is True


def test_mirror_normalizes_timed_and_cancelled_events():
    timed = google_calendar._mirror_event_record(
        {
            "id": "event-1",
            "summary": "Review",
            "start": {"dateTime": "2026-10-01T09:00:00+04:00"},
            "end": {"dateTime": "2026-10-01T09:30:00+04:00"},
            "updated": "2026-09-30T10:00:00Z",
        },
        "Indian/Mauritius",
    )
    assert timed["start_time"].isoformat() == "2026-10-01T05:00:00+00:00"
    assert timed["event_payload"]["title"] == "Review"
    assert google_calendar._mirror_event_record(
        {"id": "event-1", "status": "cancelled"}, "Indian/Mauritius"
    ) == {"event_id": "event-1", "status": "cancelled"}


def test_calendar_mirror_migration_is_tenant_scoped_and_indexed():
    migration = (
        Path(__file__).resolve().parents[2]
        / "db"
        / "migrations"
        / "024_calendar_event_mirror.sql"
    ).read_text(encoding="utf-8")
    assert "FORCE ROW LEVEL SECURITY" in migration
    assert migration.count("current_company_id()") >= 4
    assert "idx_calendar_event_mirror_company_range" in migration
    assert "UNIQUE" not in migration or "PRIMARY KEY" in migration


@pytest.mark.asyncio
async def test_prewrite_interval_check_is_always_live(monkeypatch):
    captured = {}

    class Response:
        status_code = 200

        def json(self):
            return {"calendars": {"primary": {"busy": [{"start": "x", "end": "y"}]}}}

    class Client:
        async def post(self, url, *, headers, json):
            captured.update(url=url, payload=json)
            return Response()

    async def token(_company_id):
        return "token"

    monkeypatch.setattr(google_calendar, "get_valid_access_token", token)
    monkeypatch.setattr(google_calendar, "get_http_client", lambda: Client())
    result = await google_calendar.check_google_calendar_interval_free(
        str(uuid.uuid4()), "2026-10-01T05:00:00Z", 30
    )
    assert result == {"status": "conflict"}
    assert captured["url"].endswith("/freeBusy")
    assert captured["payload"]["timeMin"] == "2026-10-01T05:00:00+00:00"


@pytest.mark.asyncio
async def test_incremental_calendar_sync_commits_only_after_next_sync_token(monkeypatch):
    company_id = str(uuid.uuid4())
    committed = {}

    async def state(_company_id):
        return {"sync_status": "ready", "sync_token": "old", "last_synced_at": None}

    async def no_op(*_args, **_kwargs):
        return None

    async def commit(*args, **kwargs):
        committed.update(events=args[1], sync_token=args[2], **kwargs)

    class Response:
        status_code = 200

        def json(self):
            return {
                "items": [{
                    "id": "event-1",
                    "summary": "Review",
                    "start": {"dateTime": "2026-10-01T09:00:00+04:00"},
                    "end": {"dateTime": "2026-10-01T09:30:00+04:00"},
                }],
                "nextSyncToken": "new",
            }

    class Client:
        async def get(self, _url, *, headers, params):
            assert params["syncToken"] == "old"
            return Response()

    monkeypatch.setattr(calendar_mirror, "get_calendar_sync_state", state)
    monkeypatch.setattr(calendar_mirror, "mark_calendar_sync_started", no_op)
    monkeypatch.setattr(calendar_mirror, "mark_calendar_sync_failed", no_op)
    monkeypatch.setattr(calendar_mirror, "commit_calendar_sync", commit)
    monkeypatch.setattr(google_calendar, "get_valid_access_token", lambda _id: asyncio.sleep(0, result="token"))
    monkeypatch.setattr(google_calendar, "get_http_client", lambda: Client())

    assert await google_calendar.sync_google_calendar_mirror(company_id)
    assert committed["sync_token"] == "new"
    assert committed["full_sync"] is False
    assert committed["events"][0]["event_id"] == "event-1"
