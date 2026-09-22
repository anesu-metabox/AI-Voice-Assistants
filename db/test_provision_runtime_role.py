"""Runtime-role provisioning must fail closed before opening a DB connection."""

import pytest

from db import connection
from db.provision_runtime_role import validate_provisioning_target


def _set_valid_env(monkeypatch, tmp_path):
    monkeypatch.setattr(connection, "_root_dir", tmp_path)
    monkeypatch.setenv("DATABASE_URL_UNPOOLED", "postgresql://admin:secret@ep-test.us-east-2.aws.neon.tech/app")
    monkeypatch.setenv("DATABASE_URL", "postgresql://app:secret@ep-test-pooler.us-east-2.aws.neon.tech/app")
    monkeypatch.setenv("NEON_BRANCH", "codex-test")
    monkeypatch.setenv("RUNTIME_DB_ROLE", "voice_bot_runtime")
    monkeypatch.setenv("RUNTIME_DB_PASSWORD", "a" * 40)


def test_runtime_role_requires_explicit_unpooled_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL_UNPOOLED", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://admin:secret@ep-pooler.neon.tech/app")
    monkeypatch.setenv("NEON_BRANCH", "codex-test")
    monkeypatch.setenv("RUNTIME_DB_PASSWORD", "a" * 40)
    with pytest.raises(RuntimeError, match="DATABASE_URL_UNPOOLED is required"):
        validate_provisioning_target()


def test_runtime_role_requires_explicit_branch(monkeypatch, tmp_path):
    _set_valid_env(monkeypatch, tmp_path)
    monkeypatch.delenv("NEON_BRANCH")
    with pytest.raises(RuntimeError, match="NEON_BRANCH must explicitly identify"):
        validate_provisioning_target()


@pytest.mark.parametrize("branch", ["production", "main", "primary"])
def test_runtime_role_refuses_production_without_explicit_flag(monkeypatch, tmp_path, branch):
    _set_valid_env(monkeypatch, tmp_path)
    monkeypatch.setenv("NEON_BRANCH", branch)
    with pytest.raises(RuntimeError, match="without --allow-production"):
        validate_provisioning_target()


def test_runtime_role_rejects_pooler_endpoint(monkeypatch, tmp_path):
    _set_valid_env(monkeypatch, tmp_path)
    monkeypatch.setenv("DATABASE_URL_UNPOOLED", "postgresql://admin:secret@ep-pooler.neon.tech/app")
    with pytest.raises(RuntimeError, match="direct/unpooled"):
        validate_provisioning_target()


def test_runtime_role_accepts_isolated_direct_endpoint(monkeypatch, tmp_path):
    _set_valid_env(monkeypatch, tmp_path)
    assert validate_provisioning_target() == (
        "postgresql://admin:secret@ep-test.us-east-2.aws.neon.tech/app",
        "codex-test",
        "voice_bot_runtime",
        "a" * 40,
    )


def test_runtime_role_rejects_branch_label_that_disagrees_with_neon_link(monkeypatch, tmp_path):
    _set_valid_env(monkeypatch, tmp_path)
    (tmp_path / ".neon").write_text('{"branch":"production"}', encoding="utf-8")
    with pytest.raises(RuntimeError, match="does not match the linked Neon branch"):
        validate_provisioning_target()


def test_runtime_role_requires_explicit_production_flag(monkeypatch, tmp_path):
    _set_valid_env(monkeypatch, tmp_path)
    monkeypatch.setenv("NEON_BRANCH", "production")
    target = validate_provisioning_target(allow_production=True)
    assert target[1] == "production"
