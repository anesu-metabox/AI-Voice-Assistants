"""
FastAPI Backend Application Entrypoint
Orchestrates tool dispatching, background task tracking, and database lifecycle.
"""

from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.auth import router as auth_router
from .api.settings import router as settings_router
from .api.tasks import router as tasks_router
from .api.tools import router as tools_router
from .config import settings

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("voice_bot.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager for database connection initialization and cleanup.
    """
    logger.info("Starting AI Voice Bot Backend Service...")
    logger.info("Configured CORS Origins: %s", settings.cors_origins_list)
    # Attempt to prime the database connection if configured
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

    # Prime the Fast Lane HTTP client pool
    from .services.http_client import get_http_client, close_http_client
    get_http_client()

    yield

    logger.info("Shutting down AI Voice Bot Backend Service...")
    try:
        await close_http_client()
    except Exception:
        pass
    try:
        from db.connection import close_db_pool
        await close_db_pool()
    except Exception:
        pass


app = FastAPI(
    title="AI Voice Bot Backend Runtime",
    version="1.0.0",
    description="Low-latency tool dispatcher and durable state ledger for AI Voice Assistant",
    lifespan=lifespan,
)

# CORS Middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API Routers (both root, /api, and /api/v1 prefixes for backward compatibility)
app.include_router(tools_router)
app.include_router(tasks_router)
app.include_router(auth_router)
app.include_router(settings_router)
app.include_router(tools_router, prefix="/api")
app.include_router(tasks_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(settings_router, prefix="/api")
app.include_router(tools_router, prefix="/api/v1")
app.include_router(tasks_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(settings_router, prefix="/api/v1")


from fastapi.responses import Response


@app.get("/", tags=["system"])
async def root():
    """
    Root status endpoint displaying backend service health, documentation, and API routes.
    """
    return {
        "status": "online",
        "service": "AI Voice Bot FastAPI Backend",
        "version": "1.0.0",
        "documentation": "/docs",
        "openapi": "/openapi.json",
        "health": "/health",
        "endpoints": {
            "tools": "/tools/execute",
            "schemas": "/tools/schemas",
            "auth": "/auth/google/login",
            "company_profile": "/api/company-profile",
            "assistant_config": "/api/assistant-config",
            "livekit_token": "/api/livekit/token",
        },
    }


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return Response(status_code=204)


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.app.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=True,
    )
