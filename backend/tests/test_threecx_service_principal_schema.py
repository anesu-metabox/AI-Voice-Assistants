"""Protect the distinct 3CX Service Principal ID and Route Point DN contract."""

from pathlib import Path


def test_migration_adds_service_principal_id_and_degrades_unmigrated_credentials():
    migration = (
        Path(__file__).resolve().parents[2]
        / "db"
        / "migrations"
        / "021_threecx_service_principal_client_id.sql"
    ).read_text(encoding="utf-8")
    assert "ADD COLUMN IF NOT EXISTS app_id VARCHAR(255)" in migration
    assert "SET state = 'degraded'" in migration
    assert "WHERE app_id IS NULL AND state = 'active'" in migration


def test_probe_and_repository_persist_the_distinct_id_and_encrypted_secret():
    repository = Path(__file__).resolve().parents[2]
    broker = (repository / "backend" / "credential_broker" / "main.py").read_text(encoding="utf-8")
    threecx = (repository / "db" / "threecx.py").read_text(encoding="utf-8")
    assert "_probe_threecx(request.pbx_url, request.app_id, request.client_secret)" in broker
    assert 'provider="threecx", field="client_secret"' in broker
    assert "app_id=EXCLUDED.app_id" in threecx
    assert "client_secret_ciphertext" in threecx
