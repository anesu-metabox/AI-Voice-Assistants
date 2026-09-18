"""
Database Migration Runner for Neon Serverless PostgreSQL
Executes DDL scripts from db/migrations/ using the direct/unpooled connection string.
Per Neon best practices, DDL and schema migrations must target the unpooled endpoint.
"""

import asyncio
import logging
import os
from pathlib import Path
import sys
import time
import asyncpg
from dotenv import load_dotenv

# Multi-path .env resolution
_root_dir = Path(__file__).resolve().parents[1]
_backend_dir = _root_dir / "backend"
load_dotenv(dotenv_path=_root_dir / ".env")
load_dotenv(dotenv_path=_backend_dir / ".env")
load_dotenv()

if str(_root_dir) not in sys.path:
    sys.path.append(str(_root_dir))

from db.connection import sanitize_db_url
from db.run_migrations import run_migrations as apply_migrations

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("voice_bot.db.migrate")


async def run_migrations():
    # Prefer unpooled URL for DDL/migrations, fallback to DATABASE_URL
    dsn = os.getenv("DATABASE_URL_UNPOOLED") or os.getenv("DATABASE_URL")
    if not dsn:
        logger.error("Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is configured in .env.")
        sys.exit(1)

    logger.info("Executing tracked database migrations...")
    await apply_migrations()

    clean_url = sanitize_db_url(dsn)
    conn = await asyncpg.connect(clean_url, ssl="require")
    try:
        # Query and display created tables
        rows = await conn.fetch(
            """
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name;
            """
        )
        tables = [r["table_name"] for r in rows]
        logger.info("Active public tables in Neon database: %s", tables)
    finally:
        await conn.close()
        logger.info("Migration inspection completed.")


if __name__ == "__main__":
    asyncio.run(run_migrations())

