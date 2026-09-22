"""Focused SSRF and URL-boundary tests for the tenant-owned 3CX connector."""

import socket
import json

import pytest
from fastapi import HTTPException

from backend.app.services import threecx_probe
from backend.app.services.threecx_probe import (
    _PinnedDNSBackend, _PinnedHTTPSAsyncTransport, probe_pbx, resolve_public_endpoint,
)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "https://100.64.0.1",
        "http://pbx.example.com",
        "https://user:password@pbx.example.com",
        "https://pbx.example.com:8443",
        "https://pbx.example.com/callcontrol",
        "https://pbx.example.com?redirect=http://127.0.0.1",
        "https://8.8.8.8",
        "https://localhost",
    ],
)
async def test_3cx_url_rejects_unsafe_or_non_fqdn_forms(url: str) -> None:
    with pytest.raises(HTTPException) as error:
        await resolve_public_endpoint(url)
    assert error.value.status_code == 400


@pytest.mark.asyncio
async def test_3cx_url_rejects_private_dns_results(monkeypatch: pytest.MonkeyPatch) -> None:
    def private_resolution(*args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.8", 443))]

    monkeypatch.setattr(socket, "getaddrinfo", private_resolution)
    with pytest.raises(HTTPException, match="prohibited network"):
        await resolve_public_endpoint("https://pbx.example.com")


@pytest.mark.asyncio
async def test_3cx_url_rejects_dns_rebinding(monkeypatch: pytest.MonkeyPatch) -> None:
    resolutions = ["198.51.100.10", "198.51.100.11"]

    def changing_resolution(*args, **kwargs):
        address = resolutions.pop(0)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]

    monkeypatch.setattr(socket, "getaddrinfo", changing_resolution)
    with pytest.raises(HTTPException, match="unstable"):
        await resolve_public_endpoint("https://pbx.example.com")


@pytest.mark.asyncio
async def test_3cx_url_bounds_dns_resolution_time(monkeypatch: pytest.MonkeyPatch) -> None:
    async def slow_to_thread(*_args, **_kwargs):
        import asyncio

        await asyncio.sleep(0.05)

    monkeypatch.setattr(threecx_probe, "_DNS_RESOLUTION_TIMEOUT_SECONDS", 0.001)
    monkeypatch.setattr(threecx_probe.asyncio, "to_thread", slow_to_thread)
    with pytest.raises(HTTPException, match="could not be resolved"):
        await resolve_public_endpoint("https://pbx.example.com")


@pytest.mark.asyncio
async def test_3cx_url_fails_fast_when_dns_worker_slots_are_saturated(monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    monkeypatch.setattr(threecx_probe, "_DNS_RESOLUTION_QUEUE_TIMEOUT_SECONDS", 0.001)
    monkeypatch.setattr(threecx_probe, "_dns_resolution_slots", asyncio.Semaphore(0))
    with pytest.raises(HTTPException) as error:
        await resolve_public_endpoint("https://pbx.example.com")
    assert error.value.status_code == 503


@pytest.mark.asyncio
async def test_3cx_connection_test_exchanges_service_principal_for_bearer_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, dict]] = []

    async def trusted_endpoint(_url: str):
        return "pbx.example.com", ("198.51.100.10",)

    class Response:
        is_redirect = False

        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self.body = json.dumps(payload).encode()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def aiter_bytes(self, chunk_size=None):
            yield self.body

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        def stream(self, method: str, url: str, **kwargs):
            calls.append((url, kwargs))
            payload = {"access_token": "short-lived-test-token"} if method == "POST" else {"status": "ok"}
            return Response(200, payload)

    monkeypatch.setattr(threecx_probe, "resolve_public_endpoint", trusted_endpoint)
    monkeypatch.setattr(threecx_probe.httpx, "AsyncClient", lambda **_kwargs: Client())

    await probe_pbx(
        "https://pbx.example.com",
        "app-id-100",
        "app-secret-200",
    )

    assert calls[0][0].endswith("/connect/token")
    form = calls[0][1]["data"]
    assert calls[0][1]["headers"]["Content-Type"] == "application/x-www-form-urlencoded"
    assert form == {
        "client_id": "app-id-100",
        "client_secret": "app-secret-200",
        "grant_type": "client_credentials",
    }
    assert calls[1][0].endswith("/callcontrol")
    assert calls[1][1]["headers"]["Authorization"] == "Bearer short-lived-test-token"


@pytest.mark.asyncio
async def test_3cx_connection_test_fails_closed_when_token_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def trusted_endpoint(_url: str):
        return "pbx.example.com", ("198.51.100.10",)

    class Response:
        is_redirect = False
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def aiter_bytes(self, chunk_size=None):
            yield b"{}"

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        def stream(self, *_args, **_kwargs):
            return Response()

    monkeypatch.setattr(threecx_probe, "resolve_public_endpoint", trusted_endpoint)
    monkeypatch.setattr(threecx_probe.httpx, "AsyncClient", lambda **_kwargs: Client())

    with pytest.raises(HTTPException, match="no access token"):
        await probe_pbx("https://pbx.example.com", "app-id", "secret")


@pytest.mark.asyncio
async def test_3cx_connection_test_rejects_oversized_token_response(monkeypatch: pytest.MonkeyPatch) -> None:
    async def trusted_endpoint(_url: str):
        return "pbx.example.com", ("198.51.100.10",)

    class Response:
        is_redirect = False
        status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def aiter_bytes(self, chunk_size=None):
            yield b"x" * (threecx_probe._MAX_TOKEN_RESPONSE_BYTES + 1)

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        def stream(self, *_args, **_kwargs):
            return Response()

    monkeypatch.setattr(threecx_probe, "resolve_public_endpoint", trusted_endpoint)
    monkeypatch.setattr(threecx_probe.httpx, "AsyncClient", lambda **_kwargs: Client())
    with pytest.raises(HTTPException, match="response was too large"):
        await probe_pbx("https://pbx.example.com", "app-id", "secret")


@pytest.mark.asyncio
async def test_pinned_dns_backend_connects_to_validated_ip_without_resolving_again(monkeypatch):
    connected = []

    async def connect_tcp(_self, host, port, **kwargs):
        connected.append((host, port, kwargs))
        return "connected"

    monkeypatch.setattr("httpcore.AnyIOBackend.connect_tcp", connect_tcp)
    backend = _PinnedDNSBackend("pbx.example.com", "198.51.100.10")

    result = await backend.connect_tcp(host="pbx.example.com", port=443)

    assert result == "connected"
    assert connected[0][0:2] == ("198.51.100.10", 443)
    with pytest.raises(OSError, match="unexpected hostname"):
        await backend.connect_tcp(host="metadata.internal", port=443)


def test_pinned_https_transport_keeps_certificate_hostname_verification_enabled():
    transport = _PinnedHTTPSAsyncTransport("pbx.example.com", "198.51.100.10")
    try:
        assert transport._pool._ssl_context.check_hostname is True
        assert transport._pool._ssl_context.verify_mode == 2  # ssl.CERT_REQUIRED
        assert isinstance(transport._pool._network_backend, _PinnedDNSBackend)
    finally:
        import asyncio

        asyncio.run(transport.aclose())
