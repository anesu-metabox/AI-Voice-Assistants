"""
Asyncpg Database Connection Pool Helper
Manages lightweight connection pooling to Neon Serverless PostgreSQL.
"""

import os
import logging
import urllib.parse
from typing import Optional
import asyncpg
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("voice_bot.db")

_pool: Optional[asyncpg.Pool] = None


def sanitize_db_url(url: str) -> str:
    """
    Strips query parameters (e.g. channel_binding, sslmode) from database URL for asyncpg compatibility.
    """
    parsed = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


async def get_db_pool() -> asyncpg.Pool:
    """
    Retrieve or initialize the asyncpg connection pool.
    """
    global _pool
    if _pool is None:
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            raise ValueError(
                "DATABASE_URL environment variable is not configured. "
                "Please update your .env file."
            )

        clean_url = sanitize_db_url(database_url)
        logger.info("Initializing asyncpg connection pool...")
        _pool = await asyncpg.create_pool(
            dsn=clean_url,
            ssl="require",
            min_size=2,
            max_size=10,
            command_timeout=10,
            statement_cache_size=0,  # Recommended for Neon / PgBouncer pooler mode
        )
        logger.info("Asyncpg connection pool established.")
    return _pool


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
