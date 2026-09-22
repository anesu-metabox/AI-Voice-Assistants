import asyncio
import json
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
_PROTECTED_BRANCH_NAMES = {"production", "main", "primary"}


def sanitize_db_url(url: str) -> str:
    """
    Strips query parameters (e.g. channel_binding, sslmode) from database URL for asyncpg compatibility.
    """
    parsed = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def assert_database_branch_is_safe(*, allow_protected: bool = False) -> None:
    """Prevent local/test processes from opening the project's protected branch."""
    environment = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).strip().lower()
    branch_from_env = os.getenv("NEON_BRANCH", "").strip()
    branch_from_link = ""
    link_path = _root_dir / ".neon"
    if link_path.exists():
        try:
            link = json.loads(link_path.read_text(encoding="utf-8"))
            value = link.get("branch", "") if isinstance(link, dict) else ""
            branch_from_link = value.strip() if isinstance(value, str) else ""
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError("Unable to verify the linked Neon branch; database access refused") from exc

    if branch_from_env and branch_from_link and branch_from_env.casefold() != branch_from_link.casefold():
        raise RuntimeError("NEON_BRANCH does not match the linked Neon branch; database access refused")

    branch = branch_from_env or branch_from_link
    if not branch:
        raise RuntimeError("NEON_BRANCH must explicitly identify the database target; database access refused")
    if (
        branch.casefold() in _PROTECTED_BRANCH_NAMES
        and not allow_protected
        and environment not in {"prod", "production"}
    ):
        raise RuntimeError("Local and test processes cannot connect to the protected Neon branch")


async def get_db_pool(dsn: Optional[str] = None) -> asyncpg.Pool:
    """
    Retrieve or initialize the asyncpg connection pool to Neon PostgreSQL.
    Configured specifically for Neon's PgBouncer connection pooler mode.
    """
    global _pool
    assert_database_branch_is_safe()
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
                current_setting('is_superuser')::boolean AS is_superuser,
                EXISTS (
                    SELECT 1 FROM pg_roles
                    WHERE rolname = current_user AND rolbypassrls
                ) AS bypasses_rls,
                version() AS pg_version,
                now() AS server_time;
            """
        )
        environment = os.getenv("APP_ENV", os.getenv("ENVIRONMENT", "development")).lower()
        if environment in {"prod", "production"} and (row["is_superuser"] or row["bypasses_rls"]):
            raise RuntimeError(
                "production database access requires a dedicated NOSUPERUSER NOBYPASSRLS runtime role"
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
            print(f"Connection Status: FAILED (error_type={type(exc).__name__})")
        finally:
            await close_db_pool()

    asyncio.run(_cli_test())
