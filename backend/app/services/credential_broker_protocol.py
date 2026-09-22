"""HMAC authentication for the private backend-to-credential-broker channel."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
import time
import uuid

from fastapi import HTTPException, Request

from db.credential_broker import consume_broker_nonce


MAX_CLOCK_SKEW_SECONDS = 30


def canonical_request(method: str, path: str, timestamp: str, nonce: str, body: bytes) -> bytes:
    body_hash = hashlib.sha256(body).hexdigest()
    return f"{method.upper()}\n{path}\n{timestamp}\n{nonce}\n{body_hash}".encode("utf-8")


def sign_broker_request(method: str, path: str, timestamp: str, nonce: str, body: bytes, secret: str) -> str:
    return hmac.new(
        secret.encode("utf-8"), canonical_request(method, path, timestamp, nonce, body), hashlib.sha256
    ).hexdigest()


def require_broker_secret() -> str:
    secret = os.getenv("CREDENTIAL_BROKER_SHARED_SECRET", "")
    if len(secret) < 32:
        raise RuntimeError("CREDENTIAL_BROKER_SHARED_SECRET must be at least 32 characters")
    return secret


async def verify_broker_request(request: Request) -> dict:
    """Verify the signed request and consume its tenant-scoped one-time nonce."""
    try:
        secret = require_broker_secret()
        timestamp = request.headers["x-broker-timestamp"]
        nonce_text = request.headers["x-broker-nonce"]
        signature = request.headers["x-broker-signature"]
        timestamp_value = int(timestamp)
        nonce = uuid.UUID(nonce_text)
        if abs(int(time.time()) - timestamp_value) > MAX_CLOCK_SKEW_SECONDS:
            raise ValueError("expired broker request")
        body = await request.body()
        expected = sign_broker_request(request.method, request.url.path, timestamp, nonce_text, body, secret)
        if not hmac.compare_digest(signature, expected):
            raise ValueError("invalid broker signature")
        payload = json.loads(body)
        company_id = str(uuid.UUID(str(payload["company_id"])))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError, RuntimeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid broker authorization") from exc

    try:
        consumed = await consume_broker_nonce(
            company_id, nonce,
            datetime.fromtimestamp(timestamp_value, timezone.utc) + timedelta(seconds=MAX_CLOCK_SKEW_SECONDS),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Broker replay protection unavailable") from exc
    if not consumed:
        raise HTTPException(status_code=401, detail="Broker request replay rejected")
    return payload
