"""
FastAPI Backend Application Entrypoint
Orchestrates tool dispatching, background task tracking, and database lifecycle.
"""

from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
            await get_db_pool()
    except Exception as exc:
        logger.warning("Database connection pool not primed on startup (%s). Using fallback mode.", exc)

    yield

    logger.info("Shutting down AI Voice Bot Backend Service...")
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

# Mount API Routers
app.include_router(tools_router)
app.include_router(tasks_router)


@app.get("/health", tags=["system"])
async def health_check():
    """
    Health check endpoint for container orchestrators and LiveKit agent readiness.
    """
    return {
        "status": "healthy",
        "service": "ai-voice-bot-backend",
        "version": "1.0.0",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.app.main:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=True,
    )
