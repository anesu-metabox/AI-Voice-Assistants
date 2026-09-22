from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.app.api import settings as settings_api
from db import idempotency as idempotency_db


@pytest.mark.asyncio
async def test_company_profile_failure_does_not_return_or_log_exception_text(monkeypatch, caplog):
    secret_marker = "sentinel-private-provider-payload"
    context = SimpleNamespace(company_id="company-test", auth_subject="subject-test")

    monkeypatch.setattr(settings_api, "verify_session_context", lambda _: context)

    async def ensure_company(*args, **kwargs):
        return None

    async def fail_profile_lookup(*args, **kwargs):
        raise RuntimeError(secret_marker)

    monkeypatch.setattr(settings_api, "ensure_company", ensure_company)
    monkeypatch.setattr(settings_api, "get_company_profile", fail_profile_lookup)

    with pytest.raises(HTTPException) as raised:
        await settings_api.fetch_company_profile("verified-context")

    assert raised.value.status_code == 500
    assert raised.value.detail == "Company profile service is unavailable."
    assert secret_marker not in caplog.text


@pytest.mark.asyncio
async def test_idempotency_failure_does_not_log_database_error_or_request_key(monkeypatch, caplog):
    error_marker = "sentinel-private-database-detail"
    request_key = "sentinel-request-idempotency-key"

    async def fail_pool_init():
        raise RuntimeError(error_marker)

    monkeypatch.setattr(idempotency_db, "get_db_pool", fail_pool_init)

    with pytest.raises(RuntimeError, match="idempotency service unavailable"):
        await idempotency_db.acquire_idempotency_lock(
            key=request_key,
            user_id="00000000-0000-4000-8000-000000000001",
            tool_name="book_event",
        )

    assert error_marker not in caplog.text
    assert request_key not in caplog.text
