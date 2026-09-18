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

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("voice_bot.db.migrate")


async def run_migrations():
    # Prefer unpooled URL for DDL/migrations, fallback to DATABASE_URL
    dsn = os.getenv("DATABASE_URL_UNPOOLED") or os.getenv("DATABASE_URL")
    if not dsn:
        logger.error("Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is configured in .env.")
        sys.exit(1)

    migrations_dir = _root_dir / "db" / "migrations"
    sql_files = sorted(migrations_dir.glob("*.sql"))

    if not sql_files:
        logger.warning("No migration files found in %s", migrations_dir)
        return

    logger.info("Connecting to Neon PostgreSQL for migrations...")
    conn = await asyncpg.connect(dsn)

    try:
        for sql_file in sql_files:
            logger.info("Applying migration: %s", sql_file.name)
            sql_content = sql_file.read_text(encoding="utf-8")
            start = time.perf_counter()
            await conn.execute(sql_content)
            elapsed = (time.perf_counter() - start) * 1000
            logger.info("Successfully applied %s in %.2f ms", sql_file.name, elapsed)

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
        logger.info("Migration connection closed.")


if __name__ == "__main__":
    asyncio.run(run_migrations())

