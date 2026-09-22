"""Authenticated, tenant-bound envelope encryption for integration secrets.

Local development may use a 32-byte URL-safe base64 key. Production uses AWS
KMS GenerateDataKey/Decrypt; only the encrypted data key is persisted alongside
the AES-GCM ciphertext. KMS plaintext keys and credential values are never
logged or returned by this module.
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
    return base64.urlsafe_b64decode(value.encode("ascii"))


def _environment() -> str:
    return os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).lower()


def _provider() -> str:
    provider = os.getenv("CREDENTIAL_KEY_PROVIDER", "env").lower()
    if _environment() in {"prod", "production"} and provider != "aws-kms":
        raise RuntimeError("production requires CREDENTIAL_KEY_PROVIDER=aws-kms")
    if provider not in {"env", "aws-kms"}:
        raise RuntimeError("unsupported CREDENTIAL_KEY_PROVIDER")
    return provider


def _kms_client():
    region = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION")
    if not region:
        raise RuntimeError("AWS_REGION is required for credential KMS")
    try:
        import boto3
    except ImportError as exc:
        raise RuntimeError("boto3 is required for credential KMS") from exc
    return boto3.client("kms", region_name=region)


def _master_key() -> bytes:
    """Read the development-only local key. Never usable in production."""
    if _provider() != "env" or _environment() in {"prod", "production"}:
        raise RuntimeError("environment credential key is disabled")
    raw = os.getenv("CREDENTIAL_ENCRYPTION_KEY", "")
    if not raw:
        raise RuntimeError("CREDENTIAL_ENCRYPTION_KEY is not configured")
    try:
        key = _unb64(raw)
    except Exception as exc:
        raise RuntimeError("CREDENTIAL_ENCRYPTION_KEY must be URL-safe base64") from exc
    if len(key) != 32:
        raise RuntimeError("CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes")
    return key


def _aad(context: dict[str, Any]) -> bytes:
    return json.dumps(context, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _kms_context(context: dict[str, Any]) -> dict[str, str]:
    # These values are non-secret and may appear in CloudTrail. Never add email,
    # OAuth material, customer names, or other sensitive data here.
    return {key: str(value) for key, value in context.items()}


def encrypt_secret(secret: str, *, company_id: str, provider: str, field: str) -> tuple[str, dict[str, Any]]:
    context = {"company_id": company_id, "provider": provider, "field": field, "version": 1}
    nonce = secrets.token_bytes(12)
    key_provider = _provider()
    if key_provider == "aws-kms":
        key_id = os.getenv("CREDENTIAL_KMS_KEY_ID", "")
        if not key_id:
            raise RuntimeError("CREDENTIAL_KMS_KEY_ID is required for credential KMS")
        generated = _kms_client().generate_data_key(
            KeyId=key_id,
            KeySpec="AES_256",
            EncryptionContext=_kms_context(context),
        )
        data_key = bytes(generated["Plaintext"])
        encrypted_data_key = bytes(generated["CiphertextBlob"])
        if len(data_key) != 32:
            raise RuntimeError("KMS returned an invalid data key")
        ciphertext = AESGCM(data_key).encrypt(nonce, secret.encode("utf-8"), _aad(context))
        return _b64(ciphertext), {
            "nonce": _b64(nonce),
            "context": context,
            "key_provider": "aws-kms",
            "encrypted_data_key": _b64(encrypted_data_key),
            "key_version": key_id,
        }

    ciphertext = AESGCM(_master_key()).encrypt(nonce, secret.encode("utf-8"), _aad(context))
    return _b64(ciphertext), {
        "nonce": _b64(nonce),
        "context": context,
        "key_provider": "env",
        "key_version": os.getenv("CREDENTIAL_ENCRYPTION_KEY_VERSION", "1"),
    }


def decrypt_secret(ciphertext: str, envelope: dict[str, Any], *, company_id: str, provider: str, field: str) -> str:
    context = {"company_id": company_id, "provider": provider, "field": field, "version": 1}
    if envelope.get("context") != context:
        raise ValueError("credential encryption context mismatch")
    nonce = _unb64(str(envelope["nonce"]))
    encrypted = _unb64(ciphertext)
    key_provider = _provider()
    envelope_provider = envelope.get("key_provider", "env")  # pre-KMS local envelopes
    if envelope_provider != key_provider:
        raise ValueError("credential key provider does not match envelope")

    if key_provider == "aws-kms":
        encrypted_data_key = _unb64(str(envelope["encrypted_data_key"]))
        response = _kms_client().decrypt(
            CiphertextBlob=encrypted_data_key,
            EncryptionContext=_kms_context(context),
        )
        data_key = bytes(response["Plaintext"])
        if len(data_key) != 32:
            raise RuntimeError("KMS returned an invalid data key")
    else:
        data_key = _master_key()
    return AESGCM(data_key).decrypt(nonce, encrypted, _aad(context)).decode("utf-8")
