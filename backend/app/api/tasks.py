"""
Tasks API Router
Enables querying and cancellation of asynchronous background jobs.
"""

from datetime import datetime, timezone
import json
import logging
from typing import Dict, Optional
import uuid

from fastapi import APIRouter, HTTPException, status

from ..schemas.tools import TaskCancelResponse, TaskStatusResponse

# Relative import of DB connection
import sys
from pathlib import Path

root_path = str(Path(__file__).resolve().parents[3])
if root_path not in sys.path:
    sys.path.append(root_path)

from db.connection import get_db_pool

logger = logging.getLogger("voice_bot.api.tasks")
router = APIRouter(prefix="/tasks", tags=["tasks"])

# In-memory mock tasks store for local development
_mock_tasks: Dict[str, Dict] = {
    "task_sample_001": {
        "task_id": "task_sample_001",
        "title": "Quarterly Operations Report Compilation",
        "tool_name": "generate_briefing_document",
        "status": "completed",
        "output_result": {"document_url": "https://docs.google.com/document/d/sample_briefing_123"},
        "error_message": None,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
}


@router.get("/{task_id}/status", response_model=TaskStatusResponse)
async def get_task_status(task_id: str) -> TaskStatusResponse:
    """
    Check the current status of an asynchronous background task.
    """
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            parsed_id = uuid.UUID(task_id) if len(task_id) == 36 else None
            if parsed_id:
                row = await conn.fetchrow(
                    """
                    SELECT id, title, tool_name, status, output_result, error_message, created_at, updated_at
                    FROM tasks WHERE id = $1
                    """,
                    parsed_id,
                )
                if row:
                    return TaskStatusResponse(
                        task_id=str(row["id"]),
                        title=row["title"],
                        tool_name=row["tool_name"],
                        status=row["status"],
                        output_result=json.loads(row["output_result"]) if row["output_result"] else None,
                        error_message=row["error_message"],
                        created_at=row["created_at"],
                        updated_at=row["updated_at"],
                    )
    except Exception as exc:
        logger.debug("Database check bypassed (%s), checking mock store.", exc)

    if task_id in _mock_tasks:
        t = _mock_tasks[task_id]
        return TaskStatusResponse(**t)

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Task with ID '{task_id}' not found.",
    )


@router.post("/{task_id}/cancel", response_model=TaskCancelResponse)
async def cancel_task(task_id: str) -> TaskCancelResponse:
    """
    Halt or cancel a pending/running background task.
    """
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            parsed_id = uuid.UUID(task_id) if len(task_id) == 36 else None
            if parsed_id:
                result = await conn.execute(
                    "UPDATE tasks SET status = 'cancelled' WHERE id = $1 AND status IN ('pending', 'running')",
                    parsed_id,
                )
                if result != "UPDATE 0":
                    return TaskCancelResponse(
                        task_id=task_id,
                        cancelled=True,
                        message="Task successfully cancelled in database.",
                    )
    except Exception as exc:
        logger.debug("Database cancel bypassed (%s), updating mock store.", exc)

    if task_id in _mock_tasks:
        _mock_tasks[task_id]["status"] = "cancelled"
        _mock_tasks[task_id]["updated_at"] = datetime.now(timezone.utc)
        return TaskCancelResponse(
            task_id=task_id,
            cancelled=True,
            message="Task successfully cancelled in mock store.",
        )

    return TaskCancelResponse(
        task_id=task_id,
        cancelled=False,
        message="Task was not active or could not be found.",
    )
