"""Authenticated, tenant-bound envelope encryption for integration secrets.

Local development and Railway deployments use a 32-byte URL-safe base64 key
injected into the private credential-broker process. Railway stores the key as
a service secret; only the broker receives it. The key itself is never persisted
with ciphertext, logged, or returned by this module.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii")


def _unb64(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def _master_key(name: str = "CREDENTIAL_ENCRYPTION_KEY") -> bytes:
    """Read a broker-only key injected by local config or Railway secrets."""
    raw = os.getenv(name, "")
    if not raw:
        raise RuntimeError(f"{name} is not configured")
    try:
        key = _unb64(raw)
    except Exception as exc:
        raise RuntimeError(f"{name} must be URL-safe base64") from exc
    if len(key) != 32:
        raise RuntimeError(f"{name} must decode to 32 bytes")
    return key


def _key_version() -> str:
    return os.getenv("CREDENTIAL_ENCRYPTION_KEY_VERSION", "1").strip()


def _aad(context: dict[str, Any]) -> bytes:
    return json.dumps(context, sort_keys=True, separators=(",", ":")).encode("utf-8")


def encrypt_secret(secret: str, *, company_id: str, provider: str, field: str) -> tuple[str, dict[str, Any]]:
    context = {"company_id": company_id, "provider": provider, "field": field, "version": 1}
    nonce = secrets.token_bytes(12)
    ciphertext = AESGCM(_master_key()).encrypt(nonce, secret.encode("utf-8"), _aad(context))
    return _b64(ciphertext), {
        "nonce": _b64(nonce),
        "context": context,
        "key_provider": "env",
        "key_version": _key_version(),
    }


def decrypt_secret(ciphertext: str, envelope: dict[str, Any], *, company_id: str, provider: str, field: str) -> str:
    context = {"company_id": company_id, "provider": provider, "field": field, "version": 1}
    if envelope.get("context") != context:
        raise ValueError("credential encryption context mismatch")
    nonce = _unb64(str(envelope["nonce"]))
    encrypted = _unb64(ciphertext)
    envelope_provider = envelope.get("key_provider", "env")  # pre-KMS local envelopes
    if envelope_provider != "env":
        raise ValueError("credential key provider does not match envelope")
    current_version = _key_version()
    envelope_version = str(envelope.get("key_version", "1"))
    if envelope_version == current_version:
        data_key = _master_key()
    elif envelope_version == os.getenv("CREDENTIAL_ENCRYPTION_PREVIOUS_KEY_VERSION", ""):
        data_key = _master_key("CREDENTIAL_ENCRYPTION_PREVIOUS_KEY")
    else:
        raise RuntimeError("credential encryption key version is unavailable")
    return AESGCM(data_key).decrypt(nonce, encrypted, _aad(context)).decode("utf-8")
