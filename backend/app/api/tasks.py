"""
Tasks API Router
Enables querying and cancellation of asynchronous background jobs.
"""

import json
import logging
import uuid

from fastapi import APIRouter, Header, HTTPException, status

from ..schemas.tools import TaskCancelResponse, TaskStatusResponse

# Relative import of DB connection
import sys
from pathlib import Path

root_path = str(Path(__file__).resolve().parents[3])
if root_path not in sys.path:
    sys.path.append(root_path)

from db.connection import get_db_pool
from ..auth_context import verify_session_context

logger = logging.getLogger("voice_bot.api.tasks")
router = APIRouter(prefix="/tasks", tags=["tasks"])

@router.get("/{task_id}/status", response_model=TaskStatusResponse)
async def get_task_status(task_id: str, verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context")) -> TaskStatusResponse:
    """
    Check the current status of an asynchronous background task.
    """
    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", context.company_id)
            parsed_id = uuid.UUID(task_id)
            row = await conn.fetchrow(
                """
                SELECT id, title, tool_name, status, output_result, error_message, created_at, updated_at
                FROM tasks WHERE id = $1 AND user_id = $2
                """,
                parsed_id,
                uuid.UUID(context.company_id),
            )
            if row:
                return TaskStatusResponse(task_id=str(row["id"]), title=row["title"], tool_name=row["tool_name"], status=row["status"], output_result=json.loads(row["output_result"]) if row["output_result"] else None, error_message=row["error_message"], created_at=row["created_at"], updated_at=row["updated_at"])
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    except Exception as exc:
        logger.error("Task lookup failed (error_type=%s)", type(exc).__name__)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Task service unavailable")

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Task with ID '{task_id}' not found.",
    )


@router.post("/{task_id}/cancel", response_model=TaskCancelResponse)
async def cancel_task(task_id: str, verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context")) -> TaskCancelResponse:
    """
    Halt or cancel a pending/running background task.
    """
    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", context.company_id)
            parsed_id = uuid.UUID(task_id)
            result = await conn.execute(
                "UPDATE tasks SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'running')",
                parsed_id, uuid.UUID(context.company_id),
            )
            return TaskCancelResponse(task_id=task_id, cancelled=result != "UPDATE 0", message="Task cancellation processed.")
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    except Exception as exc:
        logger.error("Task cancellation failed (error_type=%s)", type(exc).__name__)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Task service unavailable")
