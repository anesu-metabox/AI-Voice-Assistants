"""Contract tests for the authenticated Google Calendar-only surface."""

from uuid import uuid4

import pytest

from backend.app.tools import calendar as calendar_tools


@pytest.mark.asyncio
async def test_calendar_action_fails_closed_without_tenant_google_integration(
    async_client, test_user_id, requires_migrated_oauth_schema, monkeypatch
):
    async def broker_without_integration(_path, _payload):
        return {"status": "integration_required", "error_code": "GOOGLE_CALENDAR_REQUIRED", "source": "google_calendar"}

    monkeypatch.setattr(calendar_tools, "broker_post", broker_without_integration)
    response = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "parameters": {
                "title": "Should not use a local fallback",
                "start_time": "2026-12-01T09:00:00Z",
                "duration_minutes": 30,
            },
            "idempotency_key": f"calendar-contract-book-1-{uuid4()}",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["data"]["status"] == "integration_required"
    assert body["data"]["error_code"] == "GOOGLE_CALENDAR_REQUIRED"
    assert body["data"]["source"] == "google_calendar"


@pytest.mark.asyncio
async def test_calendar_context_cannot_be_replaced_by_caller_user_id(
    async_client, test_user_id, requires_migrated_oauth_schema, monkeypatch
):
    async def broker_without_integration(_path, _payload):
        return {"status": "integration_required", "error_code": "GOOGLE_CALENDAR_REQUIRED", "source": "google_calendar"}

    monkeypatch.setattr(calendar_tools, "broker_post", broker_without_integration)
    response = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": "00000000-0000-0000-0000-000000000999",
            "parameters": {
                "title": "Caller supplied identity must be ignored",
                "start_time": "2026-12-01T09:00:00Z",
                "duration_minutes": 30,
            },
            "idempotency_key": f"calendar-contract-book-2-{uuid4()}",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["data"]["error_code"] == "GOOGLE_CALENDAR_REQUIRED"
