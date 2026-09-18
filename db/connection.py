import asyncio
import logging
import os
from pathlib import Path
import time
from typing import Any, Dict, Optional
import urllib.parse

import asyncpg
from dotenv import load_dotenv

# Multi-path .env resolution (repo root, backend dir, CWD)
_root_dir = Path(__file__).resolve().parents[1]
_backend_dir = _root_dir / "backend"
load_dotenv(dotenv_path=_root_dir / ".env")
load_dotenv(dotenv_path=_backend_dir / ".env")
load_dotenv()

logger = logging.getLogger("voice_bot.db")

_pool: Optional[asyncpg.Pool] = None


def sanitize_db_url(url: str) -> str:
    """
    Strips query parameters (e.g. channel_binding, sslmode) from database URL for asyncpg compatibility.
    """
    parsed = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


async def get_db_pool(dsn: Optional[str] = None) -> asyncpg.Pool:
    """
    Retrieve or initialize the asyncpg connection pool to Neon PostgreSQL.
    Configured specifically for Neon's PgBouncer connection pooler mode.
    """
    global _pool
    if _pool is None:
        database_url = dsn or os.getenv("DATABASE_URL")

        # Fallback to backend settings if not found in environment
        if not database_url:
            try:
                from backend.app.config import settings
                database_url = settings.database_url
            except Exception:
                try:
                    from app.config import settings
                    database_url = settings.database_url
                except Exception:
                    pass

        if not database_url:
            raise ValueError(
                "DATABASE_URL environment variable is not configured. "
                "Please update your .env file with your Neon PostgreSQL connection string."
            )

        clean_url = sanitize_db_url(database_url)
        logger.info("Initializing asyncpg connection pool to Neon PostgreSQL...")
        _pool = await asyncpg.create_pool(
            dsn=clean_url,
            ssl="require",
            min_size=2,
            max_size=10,
            command_timeout=10,
            statement_cache_size=0,  # Critical for Neon / PgBouncer transaction pooler mode
        )
        logger.info(
            "Asyncpg connection pool established (size=%d, max=%d).",
            _pool.get_size(),
            _pool.get_max_size(),
        )
    return _pool


async def check_db_connection() -> Dict[str, Any]:
    """
    Verify the database connection pool by executing a ping query and returning health diagnostics.
    """
    pool = await get_db_pool()
    start_time = time.perf_counter()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT 
                1 AS connected,
                current_database() AS database_name,
                current_user AS db_user,
                version() AS pg_version,
                now() AS server_time;
            """
        )
        latency_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return {
            "status": "connected",
            "database": row["database_name"],
            "user": row["db_user"],
            "latency_ms": latency_ms,
            "server_time": str(row["server_time"]),
            "server_version": row["pg_version"].split(",")[0],
            "pool": {
                "size": pool.get_size(),
                "free": pool.get_idle_size(),
                "min_size": pool.get_min_size(),
                "max_size": pool.get_max_size(),
            },
        }


async def close_db_pool() -> None:
    """
    Gracefully terminate the asyncpg connection pool.
    """
    global _pool
    if _pool is not None:
        logger.info("Closing asyncpg connection pool...")
        await _pool.close()
        _pool = None
        logger.info("Asyncpg connection pool closed.")


if __name__ == "__main__":
    import json

    async def _cli_test():
        print("--- Testing Neon Database Connection Pool ---")
        try:
            health = await check_db_connection()
            print("Connection Status: SUCCESS")
            print(json.dumps(health, indent=2))
        except Exception as exc:
            print(f"Connection Status: FAILED ({exc})")
        finally:
            await close_db_pool()

    asyncio.run(_cli_test())
