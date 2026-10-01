"""Typed caller for the isolated integration credential broker."""

from __future__ import annotations

import ipaddress
import json
import logging
import os
import time
import uuid
from typing import Optional
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

from ..config import settings
from .credential_broker_protocol import sign_broker_request
from .latency import bind_trace_id, current_trace_id, log_latency, reset_trace_id

logger = logging.getLogger("voice_bot.services.credential_broker_client")
_broker_http_client: Optional[httpx.AsyncClient] = None


def get_broker_http_client() -> httpx.AsyncClient:
    """Return the process-wide pool used for private broker traffic."""
    global _broker_http_client
    if _broker_http_client is None or getattr(_broker_http_client, "is_closed", False):
        _broker_http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=2.0, read=12.0, write=5.0, pool=2.0),
            limits=httpx.Limits(
                max_keepalive_connections=20,
                max_connections=50,
                keepalive_expiry=60.0,
            ),
            trust_env=False,
        )
    return _broker_http_client


async def close_broker_http_client() -> None:
    global _broker_http_client
    if _broker_http_client is not None and not getattr(_broker_http_client, "is_closed", False):
        close = getattr(_broker_http_client, "aclose", None)
        if close is not None:
            await close()
    _broker_http_client = None


def _is_private_or_local_host(hostname: str) -> bool:
    clean = hostname.rstrip(".").lower()
    if clean in {"localhost", "127.0.0.1", "::1"}:
        return True
    if clean.endswith(".railway.internal") or clean.endswith(".internal") or clean.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(clean)
        return ip.is_private or ip.is_loopback
    except ValueError:
        return False


def _broker_base_url() -> str:
    value = settings.credential_broker_url.rstrip("/")
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise RuntimeError("CREDENTIAL_BROKER_URL must be an HTTP(S) origin without credentials")
    if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise RuntimeError("CREDENTIAL_BROKER_URL must not include a path, query, or fragment")
    if parsed.scheme == "http" and not _is_private_or_local_host(parsed.hostname):
        raise RuntimeError("unencrypted credential broker HTTP is allowed only on private or loopback networks")
    return value


async def broker_post(path: str, payload: dict) -> dict:
    """Send a signed, body-bound one-time request; never log request/response data."""
    secret = settings.credential_broker_shared_secret
    if len(secret) < 32:
        raise HTTPException(status_code=503, detail="Credential broker is not configured")
    if not path.startswith("/internal/v1/") or "?" in path:
        raise ValueError("invalid internal broker path")
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    timestamp = str(int(time.time()))
    nonce = str(uuid.uuid4())
    signature = sign_broker_request("POST", path, timestamp, nonce, body, secret)
    local_trace_token = None
    trace_id = current_trace_id()
    if not trace_id:
        trace_id, local_trace_token = bind_trace_id()
    headers = {
        "content-type": "application/json",
        "x-broker-timestamp": timestamp,
        "x-broker-nonce": nonce,
        "x-broker-signature": signature,
        "x-request-id": trace_id,
    }
    started_at = time.perf_counter()
    try:
        client = get_broker_http_client()
        response = await client.post(f"{_broker_base_url()}{path}", content=body, headers=headers)
        response.raise_for_status()
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError("invalid broker response")
        log_latency(logger, "backend_to_broker", started_at)
        return result
    except HTTPException:
        raise
    except Exception as exc:
        log_latency(logger, "backend_to_broker", started_at, outcome="error")
        status_code = getattr(getattr(exc, "response", None), "status_code", 503)
        detail = "Credential broker operation failed"
        if hasattr(exc, "response") and exc.response is not None:
            try:
                err_data = exc.response.json()
                if isinstance(err_data, dict) and "detail" in err_data:
                    safe_detail = str(err_data["detail"])
                    if len(safe_detail) <= 255 and "\n" not in safe_detail:
                        detail = safe_detail
            except Exception:
                pass
        logger.error(
            "Credential broker request failed (%s, status=%s, detail=%s)",
            type(exc).__name__,
            status_code,
            detail,
        )
        raise HTTPException(
            status_code=status_code if isinstance(status_code, int) and 400 <= status_code < 600 else 503,
            detail=detail,
        ) from exc
    finally:
        if local_trace_token is not None:
            reset_trace_id(local_trace_token)

