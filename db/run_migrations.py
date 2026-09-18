"""
Database Migration Runner for Neon Serverless PostgreSQL.
Applies sequential SQL migrations using the direct (unpooled) database endpoint.
"""

import asyncio
import logging
import os
from pathlib import Path
import sys
import asyncpg
from dotenv import load_dotenv

root_path = str(Path(__file__).resolve().parents[1])
if root_path not in sys.path:
    sys.path.append(root_path)

from db.connection import sanitize_db_url

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("voice_bot.migrations")


async def run_migrations() -> None:
    """
    Run all pending SQL migrations against the direct unpooled database connection.
    """
    db_url = os.getenv("DATABASE_URL_UNPOOLED") or os.getenv("DATABASE_URL")
    if not db_url:
        raise ValueError("Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is configured.")

    clean_url = sanitize_db_url(db_url)
    logger.info("Connecting to Neon PostgreSQL direct endpoint for migrations...")

    conn = await asyncpg.connect(clean_url, ssl="require")
    try:
        # Create schema_migrations table if not exists
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )

        migrations_dir = Path(__file__).resolve().parent / "migrations"
        migration_files = sorted(migrations_dir.glob("*.sql"))

        if not migration_files:
            logger.warning("No SQL migration files found in %s", migrations_dir)
            return

        applied_rows = await conn.fetch("SELECT version FROM schema_migrations;")
        applied_versions = {row["version"] for row in applied_rows}

        for file_path in migration_files:
            version_name = file_path.name
            if version_name in applied_versions:
                logger.info("Migration '%s' already applied. Skipping.", version_name)
                continue

            logger.info("Applying migration '%s'...", version_name)
            sql_content = file_path.read_text(encoding="utf-8")

            async with conn.transaction():
                await conn.execute(sql_content)
                await conn.execute(
                    "INSERT INTO schema_migrations (version) VALUES ($1)",
                    version_name,
                )

            logger.info("Migration '%s' applied successfully.", version_name)

        logger.info("All database migrations completed cleanly.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(run_migrations())
