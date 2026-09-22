from __future__ import annotations

import os
from pathlib import Path

from backend.credential_broker.environment import BROKER_ONLY_ENV_KEYS, load_broker_environment


def _clear_broker_environment(monkeypatch):
    for key in BROKER_ONLY_ENV_KEYS | {"APP_ENV", "NEON_BRANCH", "DATABASE_URL_UNPOOLED", "RUNTIME_DB_PASSWORD"}:
        monkeypatch.delenv(key, raising=False)


def test_development_loads_only_broker_secrets(monkeypatch, tmp_path: Path):
    _clear_broker_environment(monkeypatch)
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "APP_ENV=development\n"
        "NEON_BRANCH=isolated-test\n"
        "GOOGLE_CLIENT_SECRET=oauth-secret\n"
        "CREDENTIAL_ENCRYPTION_KEY=local-key\n"
        "DATABASE_URL_UNPOOLED=admin-dsn\n"
        "RUNTIME_DB_PASSWORD=admin-password\n",
        encoding="utf-8",
    )

    load_broker_environment(dotenv)

    assert os.environ["GOOGLE_CLIENT_SECRET"] == "oauth-secret"
    assert os.environ["CREDENTIAL_ENCRYPTION_KEY"] == "local-key"
    assert "DATABASE_URL_UNPOOLED" not in os.environ
    assert "RUNTIME_DB_PASSWORD" not in os.environ


def test_production_app_env_never_imports_dotenv_secrets(monkeypatch, tmp_path: Path):
    _clear_broker_environment(monkeypatch)
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "APP_ENV=production\nGOOGLE_CLIENT_SECRET=oauth-secret\nCREDENTIAL_ENCRYPTION_KEY=local-key\n",
        encoding="utf-8",
    )

    load_broker_environment(dotenv)

    assert "GOOGLE_CLIENT_SECRET" not in os.environ
    assert "CREDENTIAL_ENCRYPTION_KEY" not in os.environ


def test_protected_neon_branch_never_imports_dotenv_secrets(monkeypatch, tmp_path: Path):
    _clear_broker_environment(monkeypatch)
    dotenv = tmp_path / ".env"
    dotenv.write_text("NEON_BRANCH=production\nGOOGLE_CLIENT_SECRET=oauth-secret\n", encoding="utf-8")

    load_broker_environment(dotenv)

    assert os.environ["APP_ENV"] == "production"
    assert "GOOGLE_CLIENT_SECRET" not in os.environ


def test_missing_branch_does_not_import_dotenv_secrets(monkeypatch, tmp_path: Path):
    _clear_broker_environment(monkeypatch)
    monkeypatch.setenv("APP_ENV", "development")
    dotenv = tmp_path / ".env"
    dotenv.write_text("GOOGLE_CLIENT_SECRET=oauth-secret\n", encoding="utf-8")

    load_broker_environment(dotenv)

    assert "GOOGLE_CLIENT_SECRET" not in os.environ


def test_process_secret_overrides_local_dotenv(monkeypatch, tmp_path: Path):
    _clear_broker_environment(monkeypatch)
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "managed-secret")
    dotenv = tmp_path / ".env"
    dotenv.write_text("GOOGLE_CLIENT_SECRET=dotenv-secret\n", encoding="utf-8")

    load_broker_environment(dotenv)

    assert os.environ["GOOGLE_CLIENT_SECRET"] == "managed-secret"


def test_general_backend_settings_do_not_retain_migration_dsn():
    from backend.app.config import Settings

    assert "database_url_unpooled" not in Settings.model_fields
