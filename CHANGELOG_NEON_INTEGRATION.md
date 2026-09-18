# Neon PostgreSQL Database Connection & Pool Integration Changelog

This document explains every modification made to connect the backend service to the **Neon Serverless PostgreSQL connection pool**, comparing the previous and current versions of each file and detailing the technical rationale behind every addition.

---

## Table of Contents

1. [Overview & Architectural Context](#1-overview--architectural-context)
2. [`backend/app/config.py`](#2-backendappconfigpy)
3. [`db/connection.py`](#3-dbconnectionpy)
4. [`backend/app/main.py`](#4-backendappmainpy)
5. [`db/migrate.py` (New File)](#5-dbmigratepy-new-file)
6. [Summary Matrix of Changes](#6-summary-matrix-of-changes)
7. [Verification Commands](#7-verification-commands)

---

## 1. Overview & Architectural Context

Neon Serverless PostgreSQL utilizes two distinct connection types:

- **Pooled Endpoint (`DATABASE_URL`, hostname with `-pooler`):** Routes traffic through Neon's **PgBouncer** connection pooler in transaction pooling mode. This is used by runtime web queries to support high concurrency and fast connection reuse.
- **Unpooled/Direct Endpoint (`DATABASE_URL_UNPOOLED`, hostname without `-pooler`):** Direct TCP connection to the Postgres compute engine. **Mandatory for DDL and schema migrations**, because PgBouncer in transaction mode does not support session-level locks, prepared statements, or table creation scripts.

The changes below connect the FastAPI runtime to the pooler, prevent directory-dependent environment bugs, add active connection health probes, and provide safe DDL migration execution.

---

## 2. `backend/app/config.py`

### Before vs. After

#### Previous Version

```python
from typing import List
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    ...
    # Database
    database_url: str = Field(default="", validation_alias="DATABASE_URL")
    ...

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
```

#### Current Version

```python
from pathlib import Path
from typing import List
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Multi-path .env resolution (repo root, backend dir, CWD)
_repo_root = Path(__file__).resolve().parents[2]
_backend_dir = Path(__file__).resolve().parents[1]
_env_files = [
    str(_repo_root / ".env"),
    str(_backend_dir / ".env"),
    ".env",
]


class Settings(BaseSettings):
    ...
    # Database (Neon PostgreSQL)
    database_url: str = Field(default="", validation_alias="DATABASE_URL")
    database_url_unpooled: str = Field(default="", validation_alias="DATABASE_URL_UNPOOLED")
    ...

    model_config = SettingsConfigDict(
        env_file=_env_files,
        env_file_encoding="utf-8",
        extra="ignore",
    )
```

### Why Was This Added?

1. **`_env_files` Multi-Path Discovery:**
   - **Problem in previous code:** `env_file=".env"` is a relative path. If an engineer runs `cd backend; uvicorn app.main:app`, Pydantic searches for `backend/.env`. Since the `.env` file lives in the repository root (`AI-Voice-Assistants/.env`), `settings.database_url` silently resolved to an empty string (`False`), disabling database connectivity.
   - **Solution:** Providing `[_repo_root / ".env", _backend_dir / ".env", ".env"]` guarantees the environment file is detected and loaded regardless of current working directory.
2. **`database_url_unpooled`:**
   - **Reason:** Allows the application to configure and expose both the runtime pooled connection (`DATABASE_URL`) and the direct migration connection (`DATABASE_URL_UNPOOLED`) in a single typed configuration object.

---

## 3. `db/connection.py`

### Before vs. After

#### Previous Version

```python
"""
Asyncpg Database Connection Pool Helper
Manages lightweight connection pooling to Neon Serverless PostgreSQL.
"""

import os
import logging
from typing import Optional
import asyncpg
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("voice_bot.db")

_pool: Optional[asyncpg.Pool] = None


async def get_db_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        database_url = os.getenv("DATABASE_URL")
        if not database_url:
            raise ValueError(
                "DATABASE_URL environment variable is not configured. "
                "Please update your .env file."
            )

        logger.info("Initializing asyncpg connection pool...")
        _pool = await asyncpg.create_pool(
            dsn=database_url,
            min_size=2,
            max_size=10,
            command_timeout=10,
            statement_cache_size=0,
        )
        logger.info("Asyncpg connection pool established.")
    return _pool


async def close_db_pool() -> None:
    global _pool
    if _pool is not None:
        logger.info("Closing asyncpg connection pool...")
        await _pool.close()
        _pool = None
        logger.info("Asyncpg connection pool closed.")
```

#### Current Version

```python
import asyncio
import logging
import os
from pathlib import Path
import time
from typing import Any, Dict, Optional
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

        logger.info("Initializing asyncpg connection pool to Neon PostgreSQL...")
        _pool = await asyncpg.create_pool(
            dsn=database_url,
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
    ...  # (Graceful pool shutdown)


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
```

### Why Was This Added?

1. **Multi-Location `load_dotenv`:**
   - **Reason:** Ensures standalone scripts importing `db.connection` find `.env` even if executed outside the project root.
2. **`dsn: Optional[str] = None` Parameter & Fallback Chain:**
   - **Reason:** Allows passing a DSN directly (e.g. from `settings.database_url` during server lifespan) while falling back cleanly to `os.getenv("DATABASE_URL")` or importing backend settings.
3. **`check_db_connection()` Function:**
   - **Reason:** The previous code had no mechanism to test if the pool was actually communicating with Neon. `check_db_connection()` acquires a connection, runs a lightweight ping query (`SELECT 1`), and calculates query latency in milliseconds while reporting live pool sizing (`pool_size`, `idle_connections`).
4. **CLI Entrypoint (`if __name__ == "__main__":`):**
   - **Reason:** Enables instant, zero-dependency command line verification: running `python -m db.connection` immediately tests the pool and prints diagnostic JSON.

---

## 4. `backend/app/main.py`

### Before vs. After

#### Previous Version

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting AI Voice Bot Backend Service...")
    logger.info("Configured CORS Origins: %s", settings.cors_origins_list)
    try:
        import sys
        from pathlib import Path
        root_path = str(Path(__file__).resolve().parents[2])
        if root_path not in sys.path:
            sys.path.append(root_path)
        from db.connection import get_db_pool, close_db_pool
        if settings.database_url:
            await get_db_pool()
    except Exception as exc:
        logger.warning("Database connection pool not primed on startup (%s). Using fallback mode.", exc)

    yield
    ...


@app.get("/health", tags=["system"])
async def health_check():
    return {
        "status": "healthy",
        "service": "ai-voice-bot-backend",
        "version": "1.0.0",
    }
```

#### Current Version

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting AI Voice Bot Backend Service...")
    logger.info("Configured CORS Origins: %s", settings.cors_origins_list)
    try:
        import sys
        from pathlib import Path
        root_path = str(Path(__file__).resolve().parents[2])
        if root_path not in sys.path:
            sys.path.append(root_path)
        from db.connection import get_db_pool, close_db_pool
        if settings.database_url:
            pool = await get_db_pool(dsn=settings.database_url)
            logger.info(
                "Neon PostgreSQL connection pool established successfully (size=%d, max=%d).",
                pool.get_size(),
                pool.get_max_size(),
            )
    except Exception as exc:
        logger.warning("Database connection pool not primed on startup (%s). Using fallback mode.", exc)

    yield
    ...


@app.get("/health", tags=["system"])
async def health_check():
    """
    Health check endpoint for container orchestrators and LiveKit agent readiness.
    """
    db_status = "not_configured"
    if settings.database_url:
        try:
            from db.connection import get_db_pool
            pool = await get_db_pool()
            db_status = "connected" if pool and not pool._closed else "disconnected"
        except Exception:
            db_status = "disconnected"

    return {
        "status": "healthy",
        "service": "ai-voice-bot-backend",
        "version": "1.0.0",
        "database": db_status,
    }


@app.get("/health/db", tags=["system"])
async def database_health_check():
    """
    Active probe verifying the Neon PostgreSQL connection pool and query latency.
    """
    try:
        import sys
        from pathlib import Path
        root_path = str(Path(__file__).resolve().parents[2])
        if root_path not in sys.path:
            sys.path.append(root_path)
        from db.connection import check_db_connection
        result = await check_db_connection()
        return result
    except Exception as exc:
        return {
            "status": "error",
            "error_message": str(exc),
            "database": "unreachable",
        }
```

### Why Was This Added?

1. **Lifespan Pool Sizing Log:**
   - **Reason:** Instead of silently calling `get_db_pool()`, it passes `settings.database_url` explicitly and logs active pool capacity on startup for operational visibility.
2. **`database` Key in `/health`:**
   - **Reason:** Container orchestrators and developers checking `/health` previously only received a static string (`"status": "healthy"`). Now, the health payload displays `"database": "connected"` or `"disconnected"`.
3. **`GET /health/db` Diagnostic Endpoint:**
   - **Reason:** Provides an active HTTP health endpoint that runs a live database query through the pool and returns round-trip latency, database name, and available connections.

---

## 5. `db/migrate.py` (New File)

### Content

```python
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

_root_dir = Path(__file__).resolve().parents[1]
_backend_dir = _root_dir / "backend"
load_dotenv(dotenv_path=_root_dir / ".env")
load_dotenv(dotenv_path=_backend_dir / ".env")
load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("voice_bot.db.migrate")


async def run_migrations():
    dsn = os.getenv("DATABASE_URL_UNPOOLED") or os.getenv("DATABASE_URL")
    if not dsn:
        logger.error("Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is configured in .env.")
        sys.exit(1)

    migrations_dir = _root_dir / "db" / "migrations"
    sql_files = sorted(migrations_dir.glob("*.sql"))

    conn = await asyncpg.connect(dsn)
    try:
        for sql_file in sql_files:
            logger.info("Applying migration: %s", sql_file.name)
            sql_content = sql_file.read_text(encoding="utf-8")
            start = time.perf_counter()
            await conn.execute(sql_content)
            elapsed = (time.perf_counter() - start) * 1000
            logger.info("Successfully applied %s in %.2f ms", sql_file.name, elapsed)

        rows = await conn.fetch(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
        )
        tables = [r["table_name"] for r in rows]
        logger.info("Active public tables in Neon database: %s", tables)
    finally:
        await conn.close()
```

### Why Was This Added?

1. **Compliance with Neon PgBouncer Architecture:**
   - Neon's connection pooler (`DATABASE_URL`) operates in **transaction pooling mode**, which does not permit DDL commands such as `CREATE TABLE`, `CREATE INDEX`, or `CREATE TRIGGER`.
2. **Missing Database Tables:**
   - When inspecting the connected database, the schema contained **zero tables**.
   - Without applying `db/migrations/001_initial_schema.sql`, the backend's idempotency engine (`db/idempotency.py`) and background task manager (`backend/app/api/tasks.py`) would fail with `"relation idempotency_records does not exist"`.
3. **Deterministic Unpooled Execution:**
   - `migrate.py` explicitly selects `DATABASE_URL_UNPOOLED` (the direct compute endpoint), executes all `.sql` files in `db/migrations/`, verifies table creation, and reports success.

---

## 6. Summary Matrix of Changes

| Component      | File Path                                                                                                      | Type     | Key Technical Additions                                                       |
| :------------- | :------------------------------------------------------------------------------------------------------------- | :------- | :---------------------------------------------------------------------------- |
| **Config**     | [`backend/app/config.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/config.py) | Modified | `_env_files` multi-path resolution; `database_url_unpooled` setting.          |
| **Pool**       | [`db/connection.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/db/connection.py)           | Modified | Robust `.env` loader; `check_db_connection()` latency probe; CLI test runner. |
| **API**        | [`backend/app/main.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/main.py)     | Modified | Lifespan pool logger; `/health` database state; `GET /health/db` endpoint.    |
| **Migrations** | [`db/migrate.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/db/migrate.py)                 | New      | Dedicated runner targeting direct compute (`DATABASE_URL_UNPOOLED`).          |

---

## 7. Verification Commands

Run these commands at any time to verify the database and pool health:

```powershell
# 1. Test connection pool and check latency directly from CLI
backend\.venv\Scripts\python.exe -m db.connection

# 2. Run schema migrations against direct endpoint
backend\.venv\Scripts\python.exe -m db.migrate

# 3. Start backend server
cd backend
..\backend\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8000
```
