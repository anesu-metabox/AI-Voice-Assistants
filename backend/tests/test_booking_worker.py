from __future__ import annotations

import json

import pytest

from backend import booking_worker
from backend.app.tools import calendar
from fastapi import HTTPException


class FakeConnection:
    def __init__(self, state):
        self.state = state

    def transaction(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def execute(self, _query, *args):
        self.state["updates"].append(args)
        return "UPDATE 1"

    async def fetchrow(self, query, *args):
        if query.lstrip().startswith("SELECT id, user_id"):
            return self.state["candidate"]
        return self.state["claimed"]


class FakePool:
    def __init__(self):
        self.state = {"updates": [], "candidate": None, "claimed": None}

    def acquire(self):
        return FakeConnection(self.state)


def job(*, attempts=1):
    return {
        "id": "48d110d0-a1c4-4b17-b912-3a9c1a2aec8d",
        "user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "idempotency_key": "booking-operation-key",
        "attempt_count": attempts,
        "payload": {
            "title": "Review", "start_time": "2026-10-01T06:00:00Z",
            "duration_minutes": 30, "attendees": [], "timezone": "Indian/Mauritius",
            "location": "Google Meet", "business_hours": None,
        },
    }


@pytest.mark.asyncio
async def test_claim_atomically_transitions_job_and_increments_attempt_count():
    pool = FakePool()
    original = job(attempts=3)
    pool.state["candidate"] = {
        "id": original["id"], "user_id": original["user_id"],
        "idempotency_key": original["idempotency_key"],
        "request_payload": json.dumps(original["payload"]), "attempt_count": 3,
        "status": "pending",
    }
    pool.state["claimed"] = {**pool.state["candidate"], "attempt_count": 4}
    claimed = await booking_worker.claim_one(pool)
    assert claimed["id"] == original["id"]
    assert claimed["attempt_count"] == 4
    assert claimed["payload"] == original["payload"]


@pytest.mark.asyncio
async def test_worker_reconciles_existing_provider_event_before_availability_check():
    pool = FakePool()
    calls = []

    async def provider(path, payload):
        calls.append(path)
        return {"status": "confirmed", "event_id": "existing-event"}

    assert await booking_worker.process_booking_request(pool, job(), provider_call=provider) == "completed"
    assert calls == ["/internal/v1/calendar/book-status"]
    assert pool.state["updates"][-1][1] == "completed"


@pytest.mark.asyncio
async def test_worker_rechecks_availability_and_books_when_slot_is_still_free():
    pool = FakePool()
    calls = []

    async def provider(path, payload):
        calls.append((path, payload))
        if path.endswith("book-status"):
            return {"status": "not_found"}
        if path.endswith("availability"):
            return {"available_slots": ["2026-10-01T06:00:00Z"]}
        return {"status": "confirmed", "event_id": "new-event"}

    assert await booking_worker.process_booking_request(pool, job(), provider_call=provider) == "completed"
    assert [call[0] for call in calls] == [
        "/internal/v1/calendar/book-status",
        "/internal/v1/calendar/availability",
        "/internal/v1/calendar/book",
    ]
    assert calls[-1][1]["request_key"] == "booking-operation-key"
    assert pool.state["updates"][-1][1] == "completed"


@pytest.mark.asyncio
async def test_worker_fails_without_booking_when_requested_slot_was_taken():
    pool = FakePool()
    calls = []

    async def provider(path, payload):
        calls.append(path)
        if path.endswith("book-status"):
            return {"status": "not_found"}
        return {"available_slots": ["2026-10-01T06:30:00Z"]}

    assert await booking_worker.process_booking_request(pool, job(), provider_call=provider) == "failed"
    assert calls[-1].endswith("availability")
    assert not any(path.endswith("/book") for path in calls)
    assert pool.state["updates"][-1][1] == "failed"
    assert "no booking was made" in pool.state["updates"][-1][3]


@pytest.mark.asyncio
async def test_worker_retries_temporary_outage_and_stops_after_attempt_limit():
    pool = FakePool()

    async def provider(_path, _payload):
        return {"status": "temporarily_unavailable", "retryable": True}

    assert await booking_worker.process_booking_request(pool, job(attempts=2), provider_call=provider) == "pending"
    assert pool.state["updates"][-1][1] == "pending"
    assert pool.state["updates"][-1][4] > 0

    assert await booking_worker.process_booking_request(pool, job(attempts=booking_worker.MAX_ATTEMPTS), provider_call=provider) == "failed"
    assert pool.state["updates"][-1][1] == "failed"


@pytest.mark.asyncio
async def test_worker_pauses_for_calendar_reconnection_without_retrying():
    pool = FakePool()

    async def provider(_path, _payload):
        return {"status": "needs_reconnect"}

    assert await booking_worker.process_booking_request(pool, job(), provider_call=provider) == "needs_reconnect"
    assert pool.state["updates"][-1][1] == "needs_reconnect"


def test_retry_backoff_grows_exponentially_and_stays_bounded():
    assert booking_worker.retry_delay_seconds(1, random_value=0) == 15
    assert booking_worker.retry_delay_seconds(2, random_value=0) == 30
    assert booking_worker.retry_delay_seconds(20, random_value=1) == booking_worker.MAX_BACKOFF_SECONDS


@pytest.mark.asyncio
async def test_api_converts_broker_outage_to_persisted_unconfirmed_request(monkeypatch):
    stored = {}

    async def unavailable(*_args, **_kwargs):
        raise HTTPException(status_code=503, detail="unavailable")

    async def create(**kwargs):
        stored.update(kwargs)
        return {"id": "48d110d0-a1c4-4b17-b912-3a9c1a2aec8d", "status": "pending"}

    monkeypatch.setattr(calendar, "broker_post", unavailable)
    monkeypatch.setattr(calendar, "create_booking_request", create)
    result = await calendar.book_event(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Review", "2026-10-01T10:00:00",
        timezone="Indian/Mauritius", idempotency_key="booking-operation-key",
    )
    assert result["status"] == "pending_confirmation"
    assert "not confirmed yet" in result["message"]
    assert stored["idempotency_key"] == "booking-operation-key"
    assert stored["payload"]["start_time"] == "2026-10-01T06:00:00Z"


@pytest.mark.asyncio
async def test_api_persists_reconnect_required_booking_for_resume_after_oauth(monkeypatch):
    stored = {}

    async def reauth(*_args, **_kwargs):
        return {"status": "needs_reconnect", "error_code": "GOOGLE_CALENDAR_REAUTH_REQUIRED"}

    async def create(**kwargs):
        stored.update(kwargs)
        return {"id": "48d110d0-a1c4-4b17-b912-3a9c1a2aec8d", "status": kwargs["status"]}

    monkeypatch.setattr(calendar, "broker_post", reauth)
    monkeypatch.setattr(calendar, "create_booking_request", create)
    result = await calendar.book_event(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Review", "2026-10-01T10:00:00",
        timezone="Indian/Mauritius", idempotency_key="booking-operation-key",
    )
    assert result["status"] == "needs_reconnect"
    assert result["booking_request_id"] == "48d110d0-a1c4-4b17-b912-3a9c1a2aec8d"
    assert "not confirmed yet" in result["message"]
    assert stored["status"] == "needs_reconnect"
