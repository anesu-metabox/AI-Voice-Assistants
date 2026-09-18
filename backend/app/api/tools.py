"""
Tools Execution Router
Central dispatcher for executing voice tools synchronously with idempotency protection.
"""

import logging
import time
from typing import Any, Callable, Dict

from fastapi import APIRouter, HTTPException, status

from ..schemas.tools import ToolExecutionRequest, ToolExecutionResponse
from ..tools.calendar import get_calendar_availability, book_event
from ..tools.contacts import search_contacts

# Relative import of DB idempotency engine
import sys
from pathlib import Path

# Add project root to path if needed for db imports
root_path = str(Path(__file__).resolve().parents[3])
if root_path not in sys.path:
    sys.path.append(root_path)

from db.idempotency import (
    acquire_idempotency_lock,
    commit_idempotency_lock,
    release_idempotency_lock,
)

logger = logging.getLogger("voice_bot.api.tools")
router = APIRouter(prefix="/tools", tags=["tools"])

# Tool Registry
TOOL_REGISTRY: Dict[str, Callable[..., Any]] = {
    "get_calendar_availability": get_calendar_availability,
    "book_event": book_event,
    "search_contacts": search_contacts,
}


@router.post("/execute", response_model=ToolExecutionResponse)
async def execute_tool(request: ToolExecutionRequest) -> ToolExecutionResponse:
    """
    Execute a registered voice tool by name with parameters and optional idempotency key.
    """
    start_time = time.perf_counter()
    tool_name = request.tool_name

    if tool_name not in TOOL_REGISTRY:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown tool '{tool_name}'. Available tools: {list(TOOL_REGISTRY.keys())}",
        )

    tool_func = TOOL_REGISTRY[tool_name]
    idempotency_key = request.idempotency_key

    # 1. Idempotency Check (if key provided)
    if idempotency_key:
        is_new, cached_payload, msg = await acquire_idempotency_lock(
            key=idempotency_key,
            user_id=request.user_id,
            tool_name=tool_name,
        )
        if not is_new:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            if cached_payload is not None:
                return ToolExecutionResponse(
                    status="success",
                    data=cached_payload,
                    execution_time_ms=elapsed_ms,
                    idempotency_key=idempotency_key,
                )
            else:
                return ToolExecutionResponse(
                    status="conflict",
                    error_message=msg,
                    execution_time_ms=elapsed_ms,
                    idempotency_key=idempotency_key,
                )

    # 2. Execute Tool Function
    try:
        import inspect
        sig = inspect.signature(tool_func)
        call_params = dict(request.parameters)
        if "user_id" in sig.parameters and "user_id" not in call_params:
            call_params["user_id"] = request.user_id

        result = await tool_func(**call_params)
        elapsed_ms = (time.perf_counter() - start_time) * 1000

        # 3. Commit Idempotency Lock on Success
        if idempotency_key:
            await commit_idempotency_lock(key=idempotency_key, response_payload=result)

        return ToolExecutionResponse(
            status="success",
            data=result,
            execution_time_ms=elapsed_ms,
            idempotency_key=idempotency_key,
        )

    except Exception as exc:
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.exception("Error executing tool '%s': %s", tool_name, exc)

        # 4. Release Lock on Error
        if idempotency_key:
            await release_idempotency_lock(key=idempotency_key)

        return ToolExecutionResponse(
            status="error",
            error_message=str(exc),
            execution_time_ms=elapsed_ms,
            idempotency_key=idempotency_key,
        )
