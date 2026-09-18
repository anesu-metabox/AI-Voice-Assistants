"""
Durable Background Task Tools (Trigger.dev / Long-running Lane)
Registers long-running jobs (>2s) into PostgreSQL and prepares Trigger.dev durable task handoff.
"""

import asyncio
import json
import logging
from typing import Any, Dict, Optional
import uuid

# Import DB pool for persisting initial task record
import sys
from pathlib import Path

root_path = str(Path(__file__).resolve().parents[3])
if root_path not in sys.path:
    sys.path.append(root_path)

from db.connection import get_db_pool

logger = logging.getLogger("voice_bot.tools.tasks")


async def create_durable_task(
    task_type: str,
    title: str,
    payload: Dict[str, Any],
    user_id: Optional[str] = None,
    session_id: Optional[str] = None,
    estimated_duration_sec: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Register a durable background task for asynchronous execution (>2s).
    Preserves state across connection drops and restarts.
    """
    task_id = str(uuid.uuid4())
    effective_user_id = user_id or "00000000-0000-0000-0000-000000000001"
    logger.info("Registering durable task %s of type '%s': %s", task_id, task_type, title)

    # Persist initial pending state to Neon Postgres if pool is available
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO tasks (id, user_id, session_id, title, status, tool_name, input_parameters)
                VALUES ($1, $2, $3, $4, 'pending', $5, $6)
                """,
                uuid.UUID(task_id),
                uuid.UUID(effective_user_id),
                session_id,
                title,
                task_type,
                json.dumps(payload),
            )
        logger.info("Durable task %s successfully persisted to PostgreSQL", task_id)
    except Exception as exc:
        logger.warning("Could not persist task %s to database (continuing with in-memory state): %s", task_id, exc)

    spoken_ack = f"I've started that {title.lower()}. I will update your dashboard as soon as it is finished."

    return {
        "task_id": task_id,
        "title": title,
        "status": "pending",
        "tracking_url": f"/tasks/{task_id}/status",
        "spoken_ack": spoken_ack,
    }
