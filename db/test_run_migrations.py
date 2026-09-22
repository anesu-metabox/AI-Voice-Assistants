import pytest

from db import connection
from db.run_migrations import run_migrations


@pytest.mark.asyncio
async def test_migrations_require_an_explicit_branch(monkeypatch):
    monkeypatch.setenv("DATABASE_URL_UNPOOLED", "postgresql://example.invalid/db")
    monkeypatch.delenv("NEON_BRANCH", raising=False)

    with pytest.raises(RuntimeError, match="NEON_BRANCH"):
        await run_migrations()


@pytest.mark.asyncio
async def test_migrations_reject_pooler_endpoint(monkeypatch, tmp_path):
    monkeypatch.setattr(connection, "_root_dir", tmp_path)
    monkeypatch.setenv("DATABASE_URL_UNPOOLED", "postgresql://user:password@ep-example-pooler.neon.tech/db")
    monkeypatch.setenv("NEON_BRANCH", "codex-test")

    with pytest.raises(RuntimeError, match="direct/unpooled"):
        await run_migrations()


@pytest.mark.asyncio
async def test_migrations_reject_branch_label_that_disagrees_with_neon_link(monkeypatch, tmp_path):
    monkeypatch.setattr(connection, "_root_dir", tmp_path)
    (tmp_path / ".neon").write_text('{"branch":"production"}', encoding="utf-8")
    monkeypatch.setenv("DATABASE_URL_UNPOOLED", "postgresql://example.invalid/db")
    monkeypatch.setenv("NEON_BRANCH", "codex-test")

    async def unexpected_connect(*_args, **_kwargs):
        pytest.fail("migration must reject the mismatched target before connecting")

    monkeypatch.setattr("db.run_migrations.asyncpg.connect", unexpected_connect)
    with pytest.raises(RuntimeError, match="does not match the linked Neon branch"):
        await run_migrations()
