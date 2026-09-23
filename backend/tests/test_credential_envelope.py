import base64

import pytest

from backend.app.services import credential_envelope as envelope


def _identity():
    return {"company_id": "tenant-1", "provider": "google", "field": "access_token"}


def test_local_envelope_round_trips(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"l" * 32).decode())
    ciphertext, metadata = envelope.encrypt_secret("secret-value", **_identity())
    assert envelope.decrypt_secret(ciphertext, metadata, **_identity()) == "secret-value"


def test_railway_production_envelope_round_trips_with_broker_key(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"l" * 32).decode())
    ciphertext, metadata = envelope.encrypt_secret("secret-value", **_identity())
    assert metadata["key_provider"] == "env"
    assert "encrypted_data_key" not in metadata
    assert "secret-value" not in str(metadata)
    assert envelope.decrypt_secret(ciphertext, metadata, **_identity()) == "secret-value"


def test_current_and_previous_key_versions_support_rotation(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"o" * 32).decode())
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY_VERSION", "1")
    old_ciphertext, old_metadata = envelope.encrypt_secret("older-secret", **_identity())
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"n" * 32).decode())
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY_VERSION", "2")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_PREVIOUS_KEY", base64.urlsafe_b64encode(b"o" * 32).decode())
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_PREVIOUS_KEY_VERSION", "1")
    assert envelope.decrypt_secret(old_ciphertext, old_metadata, **_identity()) == "older-secret"


def test_decryption_rejects_different_tenant(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"l" * 32).decode())
    ciphertext, metadata = envelope.encrypt_secret("secret-value", **_identity())
    with pytest.raises(ValueError, match="context mismatch"):
        envelope.decrypt_secret(ciphertext, metadata, **{**_identity(), "company_id": "tenant-2"})
