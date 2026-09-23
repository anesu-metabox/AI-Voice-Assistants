"""Typed caller for the isolated integration credential broker."""

from __future__ import annotations

import ipaddress
import json
import logging
import os
import time
import uuid
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

from ..config import settings
from .credential_broker_protocol import sign_broker_request

logger = logging.getLogger("voice_bot.services.credential_broker_client")


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
    headers = {
        "content-type": "application/json",
        "x-broker-timestamp": timestamp,
        "x-broker-nonce": nonce,
        "x-broker-signature": signature,
    }
    try:
        async with httpx.AsyncClient(timeout=12.0, trust_env=False) as client:
            response = await client.post(f"{_broker_base_url()}{path}", content=body, headers=headers)
        response.raise_for_status()
        result = response.json()
        if not isinstance(result, dict):
            raise ValueError("invalid broker response")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "Credential broker request failed (%s, status=%s)",
            type(exc).__name__,
            getattr(getattr(exc, "response", None), "status_code", None),
        )
        # Do not propagate provider errors or raw responses that could contain secrets.
        raise HTTPException(status_code=503, detail="Credential broker operation failed") from exc

