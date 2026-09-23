"""Health diagnostics must not disclose database details in production."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from backend.app.main import database_health_check


@pytest.mark.asyncio
async def test_production_database_diagnostic_is_disabled_without_connecting(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    with patch("db.connection.check_db_connection", new_callable=AsyncMock) as probe:
        with pytest.raises(HTTPException) as error:
            await database_health_check()

    assert error.value.status_code == 404
    probe.assert_not_awaited()


@pytest.mark.asyncio
async def test_database_diagnostic_never_returns_raw_connection_errors(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    with patch(
        "db.connection.check_db_connection",
        new_callable=AsyncMock,
        side_effect=RuntimeError("postgresql://user:secret@example.invalid/db"),
    ):
        response = await database_health_check()

    assert response == {"status": "error", "database": "unreachable"}
    assert "secret" not in str(response)


@pytest.mark.asyncio
async def test_security_headers_injected_on_responses():
    from httpx import AsyncClient, ASGITransport
    from backend.app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        assert resp.headers.get("Strict-Transport-Security") == "max-age=31536000; includeSubDomains; preload"
        assert resp.headers.get("X-Content-Type-Options") == "nosniff"
        assert resp.headers.get("X-Frame-Options") == "DENY"
        assert resp.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
