import base64

import pytest

from backend.app.services import credential_envelope as envelope


class FakeKms:
    def __init__(self):
        self.data_key = b"d" * 32
        self.encrypted_data_key = b"wrapped-data-key"
        self.encrypt_context = None
        self.decrypt_context = None

    def generate_data_key(self, **kwargs):
        self.encrypt_context = kwargs["EncryptionContext"]
        assert kwargs["KeySpec"] == "AES_256"
        return {"Plaintext": self.data_key, "CiphertextBlob": self.encrypted_data_key}

    def decrypt(self, **kwargs):
        self.decrypt_context = kwargs["EncryptionContext"]
        assert kwargs["CiphertextBlob"] == self.encrypted_data_key
        return {"Plaintext": self.data_key}


def _identity():
    return {"company_id": "tenant-1", "provider": "google", "field": "access_token"}


def test_local_envelope_round_trips(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("CREDENTIAL_KEY_PROVIDER", "env")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"l" * 32).decode())
    ciphertext, metadata = envelope.encrypt_secret("secret-value", **_identity())
    assert envelope.decrypt_secret(ciphertext, metadata, **_identity()) == "secret-value"


def test_production_rejects_environment_key_even_if_present(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CREDENTIAL_KEY_PROVIDER", "env")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"l" * 32).decode())
    with pytest.raises(RuntimeError, match="aws-kms"):
        envelope.encrypt_secret("secret-value", **_identity())


def test_aws_kms_envelope_round_trips_with_tenant_context(monkeypatch):
    fake_kms = FakeKms()
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CREDENTIAL_KEY_PROVIDER", "aws-kms")
    monkeypatch.setenv("CREDENTIAL_KMS_KEY_ID", "arn:aws:kms:us-east-1:123456789012:key/example")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", "must-not-be-used")
    monkeypatch.setattr(envelope, "_kms_client", lambda: fake_kms)

    ciphertext, metadata = envelope.encrypt_secret("secret-value", **_identity())
    assert metadata["key_provider"] == "aws-kms"
    assert "encrypted_data_key" in metadata
    assert "secret-value" not in str(metadata)
    assert envelope.decrypt_secret(ciphertext, metadata, **_identity()) == "secret-value"
    assert fake_kms.encrypt_context == fake_kms.decrypt_context
    assert fake_kms.encrypt_context == {
        "company_id": "tenant-1", "provider": "google", "field": "access_token", "version": "1"
    }


def test_kms_key_and_region_are_mandatory(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CREDENTIAL_KEY_PROVIDER", "aws-kms")
    monkeypatch.delenv("CREDENTIAL_KMS_KEY_ID", raising=False)
    with pytest.raises(RuntimeError, match="CREDENTIAL_KMS_KEY_ID"):
        envelope.encrypt_secret("secret-value", **_identity())


def test_decryption_rejects_different_tenant_before_kms_call(monkeypatch):
    fake_kms = FakeKms()
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CREDENTIAL_KEY_PROVIDER", "aws-kms")
    monkeypatch.setenv("CREDENTIAL_KMS_KEY_ID", "kms-key")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setattr(envelope, "_kms_client", lambda: fake_kms)
    ciphertext, metadata = envelope.encrypt_secret("secret-value", **_identity())
    with pytest.raises(ValueError, match="context mismatch"):
        envelope.decrypt_secret(ciphertext, metadata, **{**_identity(), "company_id": "tenant-2"})
    assert fake_kms.decrypt_context is None
