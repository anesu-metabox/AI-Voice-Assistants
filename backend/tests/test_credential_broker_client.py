"""Unit tests for the isolated integration credential broker client."""

import pytest
from fastapi import HTTPException

from backend.app.config import settings
from backend.app.services.credential_broker_client import _broker_base_url, broker_post


def test_broker_base_url_accepts_railway_private_mesh(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setattr(settings, "credential_broker_url", "http://credential-broker.railway.internal:8001")
    assert _broker_base_url() == "http://credential-broker.railway.internal:8001"

    monkeypatch.setenv("APP_ENV", "development")
    assert _broker_base_url() == "http://credential-broker.railway.internal:8001"


def test_broker_base_url_accepts_localhost_and_loopback(monkeypatch):
    monkeypatch.setattr(settings, "credential_broker_url", "http://localhost:8001")
    assert _broker_base_url() == "http://localhost:8001"

    monkeypatch.setattr(settings, "credential_broker_url", "http://127.0.0.1:8001")
    assert _broker_base_url() == "http://127.0.0.1:8001"


def test_broker_base_url_accepts_https(monkeypatch):
    monkeypatch.setattr(settings, "credential_broker_url", "https://broker.example.com")
    assert _broker_base_url() == "https://broker.example.com"


def test_broker_base_url_rejects_unencrypted_public_http(monkeypatch):
    monkeypatch.setattr(settings, "credential_broker_url", "http://public.example.com")
    with pytest.raises(RuntimeError) as exc:
        _broker_base_url()
    assert "unencrypted credential broker HTTP is allowed only on private or loopback networks" in str(exc.value)


def test_broker_base_url_rejects_credentials_and_paths(monkeypatch):
    monkeypatch.setattr(settings, "credential_broker_url", "http://user:pass@localhost:8001")
    with pytest.raises(RuntimeError):
        _broker_base_url()

    monkeypatch.setattr(settings, "credential_broker_url", "http://localhost:8001/api/v1")
    with pytest.raises(RuntimeError):
        _broker_base_url()

    monkeypatch.setattr(settings, "credential_broker_url", "http://localhost:8001?query=1")
    with pytest.raises(RuntimeError):
        _broker_base_url()


@pytest.mark.asyncio
async def test_broker_post_requires_shared_secret(monkeypatch):
    monkeypatch.setattr(settings, "credential_broker_shared_secret", "short")
    with pytest.raises(HTTPException) as exc:
        await broker_post("/internal/v1/test", {"test": True})
    assert exc.value.status_code == 503
    assert exc.value.detail == "Credential broker is not configured"


@pytest.mark.asyncio
async def test_broker_post_rejects_non_internal_paths(monkeypatch):
    monkeypatch.setattr(settings, "credential_broker_shared_secret", "s" * 32)
    with pytest.raises(ValueError):
        await broker_post("/external/v1/test", {})


@pytest.mark.asyncio
async def test_broker_post_dispatches_signed_request(monkeypatch):
    monkeypatch.setattr(settings, "credential_broker_shared_secret", "s" * 32)
    monkeypatch.setattr(settings, "credential_broker_url", "http://credential-broker.railway.internal:8001")

    captured_request = {}

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"connected": True}

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

        async def post(self, url, content=None, headers=None):
            captured_request["url"] = url
            captured_request["content"] = content
            captured_request["headers"] = headers
            return FakeResponse()

    monkeypatch.setattr("httpx.AsyncClient", FakeAsyncClient)

    result = await broker_post("/internal/v1/google/oauth/complete", {"company_id": "00000000-0000-0000-0000-000000000000"})
    assert result == {"connected": True}
    assert captured_request["url"] == "http://credential-broker.railway.internal:8001/internal/v1/google/oauth/complete"
    assert "x-broker-signature" in captured_request["headers"]
    assert "x-broker-nonce" in captured_request["headers"]
    assert "x-broker-timestamp" in captured_request["headers"]
