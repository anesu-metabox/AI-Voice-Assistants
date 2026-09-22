"""SSRF-safe 3CX v20 Service Principal health probe (credential-broker only)."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import socket
from urllib.parse import urlsplit

import httpcore
import httpx
from fastapi import HTTPException

_DNS_RESOLUTION_TIMEOUT_SECONDS = 2.0
_DNS_RESOLUTION_QUEUE_TIMEOUT_SECONDS = 0.25
_DNS_RESOLUTION_CONCURRENCY = 4
_HTTP_RESPONSE_CHUNK_BYTES = 16 * 1024
_MAX_TOKEN_RESPONSE_BYTES = 64 * 1024
_MAX_CALL_CONTROL_RESPONSE_BYTES = 1024 * 1024
_dns_resolution_slots = asyncio.Semaphore(_DNS_RESOLUTION_CONCURRENCY)


class _PinnedDNSBackend(httpcore.AsyncNetworkBackend):
    """Connect one validated hostname to its vetted address without changing TLS SNI."""

    def __init__(self, hostname: str, address: str):
        self.hostname = hostname.rstrip(".").lower()
        self.address = address
        self._delegate = httpcore.AnyIOBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        if str(host).rstrip(".").lower() != self.hostname:
            raise OSError("3CX transport refused an unexpected hostname")
        return await self._delegate.connect_tcp(
            self.address, port, timeout=timeout, local_address=local_address,
            socket_options=socket_options,
        )


class _PinnedHTTPSAsyncTransport(httpx.AsyncHTTPTransport):
    """HTTPS transport with TCP pinning and normal hostname certificate validation."""

    def __init__(self, hostname: str, address: str):
        import ssl

        super().__init__(verify=True, trust_env=False, retries=0)
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=ssl.create_default_context(),
            max_connections=2,
            max_keepalive_connections=0,
            retries=0,
            network_backend=_PinnedDNSBackend(hostname, address),
        )


async def resolve_public_endpoint(url: str) -> tuple[str, tuple[str, ...]]:
    parsed = urlsplit(url)
    try:
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="PBX URL contains an invalid port") from exc
    if (
        parsed.scheme != "https" or parsed.username or parsed.password
        or parsed.fragment or parsed.query or parsed.path not in ("", "/")
    ):
        raise HTTPException(status_code=400, detail="PBX URL must be an HTTPS hostname without credentials")
    if port not in (None, 443):
        raise HTTPException(status_code=400, detail="Only HTTPS port 443 is supported")
    host = (parsed.hostname or "").rstrip(".").lower()
    if not host or "." not in host or host == "localhost":
        raise HTTPException(status_code=400, detail="PBX URL must use a public hostname")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise HTTPException(status_code=400, detail="PBX URL must use a public hostname")
    try:
        first = {item[4][0] for item in await _getaddrinfo_bounded(host)}
        second = {item[4][0] for item in await _getaddrinfo_bounded(host)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="PBX hostname could not be resolved") from exc
    if not first or first != second:
        raise HTTPException(status_code=400, detail="PBX DNS resolution is unstable")
    for address in first:
        ip = ipaddress.ip_address(address)
        if not ip.is_global or ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise HTTPException(status_code=400, detail="PBX hostname resolves to a prohibited network")
    return host, tuple(sorted(first))


async def _getaddrinfo_bounded(host: str):
    try:
        await asyncio.wait_for(
            _dns_resolution_slots.acquire(), timeout=_DNS_RESOLUTION_QUEUE_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=503, detail="PBX DNS resolution capacity is temporarily unavailable") from exc

    slot_transferred_to_lookup = False
    try:
        lookup = asyncio.create_task(
            asyncio.to_thread(socket.getaddrinfo, host, 443, type=socket.SOCK_STREAM)
        )
        try:
            return await asyncio.wait_for(
                asyncio.shield(lookup), timeout=_DNS_RESOLUTION_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            lookup.add_done_callback(lambda _task: _dns_resolution_slots.release())
            slot_transferred_to_lookup = True
            raise
        except asyncio.CancelledError:
            lookup.add_done_callback(lambda _task: _dns_resolution_slots.release())
            slot_transferred_to_lookup = True
            raise
    finally:
        if not slot_transferred_to_lookup:
            _dns_resolution_slots.release()


async def probe_pbx(url: str, app_id: str, app_secret: str) -> tuple[str, tuple[str, ...]]:
    host, addresses = await resolve_public_endpoint(url)
    if not addresses:
        raise HTTPException(status_code=400, detail="PBX hostname has no usable address")
    token_url = f"{url.rstrip('/')}/connect/token"
    call_control_url = f"{url.rstrip('/')}/callcontrol"
    try:
        transport = _PinnedHTTPSAsyncTransport(host, addresses[0])
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(5.0, connect=2.0), follow_redirects=False,
            trust_env=False, transport=transport,
        ) as client:
            async with client.stream(
                "POST",
                token_url,
                data={"client_id": app_id, "client_secret": app_secret, "grant_type": "client_credentials"},
                headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
            ) as token_response:
                if token_response.is_redirect or token_response.status_code in (401, 403):
                    raise HTTPException(status_code=502, detail="3CX credentials were rejected")
                if token_response.status_code >= 400:
                    raise HTTPException(status_code=502, detail="3CX token exchange returned an error")
                token_body = await _read_limited_response(token_response, _MAX_TOKEN_RESPONSE_BYTES)
            try:
                token_payload = json.loads(token_body)
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                raise HTTPException(status_code=502, detail="3CX token exchange returned invalid data") from exc
            access_token = str(token_payload.get("access_token") or "") if isinstance(token_payload, dict) else ""
            if not access_token:
                raise HTTPException(status_code=502, detail="3CX token exchange returned no access token")
            async with client.stream(
                "GET",
                call_control_url,
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            ) as response:
                if response.is_redirect or response.status_code in (401, 403):
                    raise HTTPException(status_code=502, detail="3CX credentials were rejected")
                if response.status_code >= 400:
                    raise HTTPException(status_code=502, detail="3CX connection test returned an error")
                await _read_limited_response(response, _MAX_CALL_CONTROL_RESPONSE_BYTES)
    except HTTPException:
        raise
    except (httpx.HTTPError, OSError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="3CX connection test failed") from exc
    return host, addresses


async def _read_limited_response(response: httpx.Response, limit: int) -> bytes:
    body = bytearray()
    async for chunk in response.aiter_bytes(chunk_size=_HTTP_RESPONSE_CHUNK_BYTES):
        if len(body) + len(chunk) > limit:
            raise HTTPException(status_code=502, detail="3CX connection test response was too large")
        body.extend(chunk)
    return bytes(body)
