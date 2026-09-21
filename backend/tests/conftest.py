"""
Pytest Conftest for Backend Integration Testing
Provides live database connection pool, isolated test user UUIDs,
automatic database tenant cleanup, and FastAPI async HTTP client.
"""

import asyncio
import logging
import os
from typing import AsyncGenerator
import urllib.parse
import uuid

import asyncpg
import httpx
import pytest

from backend.app.main import app
from db.connection import get_db_pool, close_db_pool

logger = logging.getLogger("voice_bot.tests")


def sanitize_dsn(dsn: str) -> str:
    """
    Sanitize DSN for asyncpg compatibility with Neon PostgreSQL.
    Preserves credentials and host while ensuring unsupported query params are safely filtered.
    """
    if not dsn:
        return dsn
    parsed = urllib.parse.urlparse(dsn)
    if parsed.query:
        query_params = urllib.parse.parse_qs(parsed.query)
        # asyncpg handles SSL natively; channel_binding may not be recognized by older asyncpg parsers
        filtered = {k: v for k, v in query_params.items() if k not in ("channel_binding",)}
        new_query = urllib.parse.urlencode(filtered, doseq=True)
        return urllib.parse.urlunparse(parsed._replace(query=new_query))
    return dsn


@pytest.fixture(scope="session")
async def db_pool() -> AsyncGenerator[asyncpg.Pool, None]:
    """
    Session-scoped asyncpg connection pool connected to live Neon PostgreSQL.
    Reuses the application's connection pool configured for PgBouncer (statement_cache_size=0).
    """
    pool = await get_db_pool()
    yield pool
    await close_db_pool()


@pytest.fixture
def test_user_id() -> str:
    """
    Provides a freshly generated UUID for each test run to guarantee strict tenant isolation.
    """
    return str(uuid.uuid4())


@pytest.fixture
async def clean_test_db(db_pool: asyncpg.Pool, test_user_id: str) -> AsyncGenerator[None, None]:
    """
    Ensures strict tenant data isolation.
    Deletes all rows created for `test_user_id` from calendar_events, tasks,
    and idempotency_records before and after each test execution.
    """
    parsed_uid = uuid.UUID(test_user_id)

    async def _cleanup():
        async with db_pool.acquire() as conn:
            # Query existing tables to avoid errors during schema-verifying initial tests
            existing_tables = await conn.fetch(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
            )
            table_names = {row["table_name"] for row in existing_tables}

            if "calendar_events" in table_names:
                await conn.execute("DELETE FROM calendar_events WHERE user_id = $1", parsed_uid)
            if "tasks" in table_names:
                await conn.execute("DELETE FROM tasks WHERE user_id = $1", parsed_uid)
            if "idempotency_records" in table_names:
                await conn.execute("DELETE FROM idempotency_records WHERE user_id = $1", parsed_uid)
            if "confirmation_tokens" in table_names:
                await conn.execute("DELETE FROM confirmation_tokens WHERE user_id = $1", parsed_uid)
            if "user_preferences" in table_names:
                await conn.execute("DELETE FROM user_preferences WHERE user_id = $1", parsed_uid)

    await _cleanup()
    try:
        yield
    finally:
        await _cleanup()


@pytest.fixture
async def async_client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """
    FastAPI test client running over httpx ASGITransport with full app lifecycle.
    """
    class GuardrailTestClient(httpx.AsyncClient):
        async def post(self, url, *args, **kwargs):
            payload = kwargs.get("json")
            if isinstance(payload, dict) and payload.get("tool_name") in {"book_event", "cancel_event"}:
                payload = dict(payload)
                if "idempotency_key" not in payload:
                    payload["idempotency_key"] = str(uuid.uuid4())
                kwargs["json"] = payload
            return await super().post(url, *args, **kwargs)

    async with GuardrailTestClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        timeout=30.0,
    ) as client:
        yield client
