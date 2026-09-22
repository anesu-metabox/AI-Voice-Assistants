"""The credential broker authenticates every call and never returns secrets."""

import asyncio
import json
import time
import uuid

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from backend.app.services import credential_broker_protocol as protocol
from backend.credential_broker import main as broker


@pytest.mark.asyncio
async def test_threecx_probe_rejects_work_when_process_capacity_is_exhausted(monkeypatch):
    async def should_not_probe(*_args):
        raise AssertionError("probe should not start without an available slot")

    monkeypatch.setattr(broker, "_threecx_probe_slots", asyncio.Semaphore(0))
    monkeypatch.setattr(broker, "_THREECX_PROBE_QUEUE_TIMEOUT_SECONDS", 0.001)
    monkeypatch.setattr(broker, "probe_pbx", should_not_probe)
    with pytest.raises(HTTPException) as error:
        await broker._probe_threecx("https://pbx.example.invalid", "8000", "sensitive-key")
    assert error.value.status_code == 503
    assert "sensitive-key" not in str(error.value.detail)


def _request(payload, *, method="POST", path="/internal/v1/calendar/list", secret="s" * 48, timestamp=None, nonce=None):
    timestamp = str(int(time.time())) if timestamp is None else str(timestamp)
    nonce = str(uuid.uuid4()) if nonce is None else str(nonce)
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    signature = protocol.sign_broker_request(method, path, timestamp, nonce, body, secret)
    headers = [
        (b"x-broker-timestamp", timestamp.encode()),
        (b"x-broker-nonce", nonce.encode()),
        (b"x-broker-signature", signature.encode()),
    ]
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
        "query_string": b"", "root_path": "", "headers": headers,
        "client": ("127.0.0.1", 1234), "server": ("127.0.0.1", 8001),
    }
    return Request(scope, receive), body


@pytest.mark.asyncio
async def test_broker_request_signature_binds_method_path_and_body(monkeypatch):
    secret = "x" * 48
    monkeypatch.setenv("CREDENTIAL_BROKER_SHARED_SECRET", secret)
    consumed = []

    async def consume(company_id, nonce, expires_at):
        consumed.append((company_id, nonce))
        return True

    monkeypatch.setattr(protocol, "consume_broker_nonce", consume)
    company_id = str(uuid.uuid4())
    request, _ = _request({"company_id": company_id}, secret=secret)
    assert (await protocol.verify_broker_request(request))["company_id"] == company_id
    assert consumed and consumed[0][0] == company_id

    request, _ = _request({"company_id": company_id}, secret=secret)
    request.scope["path"] = "/internal/v1/calendar/book"
    with pytest.raises(HTTPException) as tampered:
        await protocol.verify_broker_request(request)
    assert tampered.value.status_code == 401


@pytest.mark.asyncio
async def test_broker_rejects_replayed_nonce_and_stale_timestamp(monkeypatch):
    secret = "y" * 48
    monkeypatch.setenv("CREDENTIAL_BROKER_SHARED_SECRET", secret)

    async def replayed(*_args):
        return False

    monkeypatch.setattr(protocol, "consume_broker_nonce", replayed)
    request, _ = _request({"company_id": str(uuid.uuid4())}, secret=secret)
    with pytest.raises(HTTPException) as replay:
        await protocol.verify_broker_request(request)
    assert replay.value.status_code == 401
    assert replay.value.detail == "Broker request replay rejected"

    stale, _ = _request(
        {"company_id": str(uuid.uuid4())}, secret=secret,
        timestamp=int(time.time()) - 120,
    )
    with pytest.raises(HTTPException) as stale_error:
        await protocol.verify_broker_request(stale)
    assert stale_error.value.status_code == 401


@pytest.mark.asyncio
async def test_oauth_completion_returns_only_connection_metadata(monkeypatch):
    saved = {}

    async def exchange_code_for_tokens(**_kwargs):
        return {
            "access_token": "must-not-return-access",
            "refresh_token": "must-not-return-refresh",
            "expires_in": 3600,
            "scope": "calendar",
        }

    async def fetch_google_identity(_token):
        return {"subject": "google-subject", "email": "calendar@example.invalid"}

    async def save_oauth_tokens(**kwargs):
        saved.update(kwargs)

    monkeypatch.setattr(broker, "exchange_code_for_tokens", exchange_code_for_tokens)
    monkeypatch.setattr(broker, "fetch_google_identity", fetch_google_identity)
    monkeypatch.setattr(broker, "save_oauth_tokens", save_oauth_tokens)
    company_id = str(uuid.uuid4())
    result = await broker.google_oauth_complete({
        "company_id": company_id,
        "code": "one-time-code",
        "code_verifier": "v" * 43,
    })
    assert result["connected"] is True
    assert result["google_email"] == "calendar@example.invalid"
    assert "access_token" not in result and "refresh_token" not in result
    assert saved["access_token"] == "must-not-return-access"
    assert saved["refresh_token"] == "must-not-return-refresh"


@pytest.mark.asyncio
async def test_threecx_save_returns_only_redacted_connection_metadata(monkeypatch):
    encrypted = {}

    async def fake_probe_pbx(_url, app_id, client_secret):
        assert app_id == "service-principal-client-id"
        assert client_secret == "sensitive-api-key"
        return "pbx.example.invalid", ("203.0.113.20",)

    def fake_encrypt(secret, **context):
        encrypted["secret"] = secret
        encrypted["context"] = context
        return "ciphertext-value", {"key_provider": "test"}

    async def fake_save(**kwargs):
        assert kwargs["app_id"] == "service-principal-client-id"
        assert kwargs["client_secret_ciphertext"] == "ciphertext-value"
        assert kwargs["failure_action"] == "disconnect"
        assert kwargs["failure_destination"] is None
        return {"connection_name": kwargs["connection_name"], "pbx_hostname": kwargs["pbx_hostname"], "state": "active"}

    monkeypatch.setattr(broker, "probe_pbx", fake_probe_pbx)
    monkeypatch.setattr(broker, "encrypt_secret", fake_encrypt)
    monkeypatch.setattr(broker, "save_threecx_integration", fake_save)
    company_id = str(uuid.uuid4())
    result = await broker.threecx_save({
        "company_id": company_id,
        "connection_name": "Office PBX",
        "pbx_url": "https://pbx.example.invalid",
        "app_id": "service-principal-client-id",
        "route_point_dn": "8000",
        "client_secret": "sensitive-api-key",
        "dids": ["+23050000001"],
        "transfer_destinations": [],
        "failure_action": "disconnect",
        "failure_destination": None,
    })
    assert result == {
        "configured": True,
        "connectionName": "Office PBX",
        "pbxHost": "pbx.example.invalid",
        "state": "active",
    }
    assert "sensitive-api-key" not in json.dumps(result)
    assert encrypted["context"] == {
        "company_id": company_id,
        "provider": "threecx", "field": "client_secret",
    }
