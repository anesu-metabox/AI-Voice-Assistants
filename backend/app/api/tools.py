"""
Tools Execution Router
Central dispatcher for executing voice tools synchronously with idempotency protection,
strict Pydantic runtime schema validation, and ANE-03 Confirmation Protocol enforcement.
"""

import logging
import time
from typing import Any, Callable, Dict

from fastapi import APIRouter, HTTPException, status
from pydantic import ValidationError

from ..schemas.tools import (
    ToolExecutionRequest,
    ToolExecutionResponse,
    ToolName,
    validate_tool_params,
    get_tool_input_schema,
)
from ..tools.calendar import get_calendar_availability, book_event, cancel_event, list_events
from ..tools.contacts import search_contacts
from ..tools.email import draft_email
from ..tools.tasks import create_durable_task
from ..policy import is_active_tool

# Relative import of DB idempotency engine
import sys
from pathlib import Path

root_path = str(Path(__file__).resolve().parents[3])
if root_path not in sys.path:
    sys.path.append(root_path)

from db.idempotency import (
    acquire_idempotency_lock,
    commit_idempotency_lock,
    release_idempotency_lock,
)
from db.confirmation import consume_confirmation_token, issue_confirmation_token

logger = logging.getLogger("voice_bot.api.tools")
router = APIRouter(prefix="/tools", tags=["tools"])

# Tool Registry for Sprint 1
TOOL_REGISTRY: Dict[str, Callable[..., Any]] = {
    ToolName.GET_CALENDAR_AVAILABILITY.value: get_calendar_availability,
    ToolName.BOOK_EVENT.value: book_event,
    ToolName.CANCEL_EVENT.value: cancel_event,
    ToolName.LIST_EVENTS.value: list_events,
    ToolName.SEARCH_CONTACTS.value: search_contacts,
    ToolName.DRAFT_EMAIL.value: draft_email,
    ToolName.CREATE_DURABLE_TASK.value: create_durable_task,
}

# High-impact destructive tools requiring explicit confirmation (ANE-03)
CONFIRMATION_REQUIRED_TOOLS = {
    ToolName.CANCEL_EVENT.value,
}

@router.get("/schemas")
async def get_all_tool_schemas() -> Dict[str, Any]:
    """
    Returns the JSONSchema definitions for all registered tools.
    Used for LLM function calling registration and documentation.
    """
    return {
        tool_name: get_tool_input_schema(tool_name)
        for tool_name in TOOL_REGISTRY.keys()
        if is_active_tool(tool_name)
    }


@router.post("/execute", response_model=ToolExecutionResponse)
async def execute_tool(request: ToolExecutionRequest) -> ToolExecutionResponse:
    """
    Execute a registered voice tool with:
    1. Tool existence check
    2. Strict Pydantic parameter schema validation (Anti-Divergence Pillar 2)
    3. ANE-03 Confirmation Protocol check for destructive actions
    4. Distributed idempotency lock acquisition (Zero Duplication Guarantee)
    5. Async execution and latency measurement (<450ms budget)
    """
    start_time = time.perf_counter()
    tool_name = request.tool_name

    # 1. Verify tool exists and is enabled by the active assistant policy.
    if tool_name not in TOOL_REGISTRY:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown tool '{tool_name}'. Available tools: {list(TOOL_REGISTRY.keys())}",
        )
    if not is_active_tool(tool_name):
        return ToolExecutionResponse(
            status="error",
            error_code="POLICY_TOOL_DENIED",
            error_message=f"Tool '{tool_name}' is not enabled for the calendar-only assistant.",
            execution_time_ms=(time.perf_counter() - start_time) * 1000,
            idempotency_key=request.idempotency_key,
        )

    # 2. Strict Pydantic Schema Validation
    try:
        validated_model = validate_tool_params(tool_name, request.parameters)
        tool_kwargs = validated_model.model_dump()
    except ValidationError as val_err:
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        error_hints = [
            f"'{' -> '.join(str(loc) for loc in err.get('loc', []))}': {err.get('msg')}"
            for err in val_err.errors()
        ]
        combined_error = "; ".join(error_hints)
        logger.warning("Tool validation failed for '%s': %s", tool_name, combined_error)
        return ToolExecutionResponse(
            status="error",
            error_code="VALIDATION_ERROR",
            error_message=f"Invalid arguments for {tool_name}: {combined_error}",
            execution_time_ms=elapsed_ms,
            idempotency_key=request.idempotency_key,
        )
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        return ToolExecutionResponse(
            status="error",
            error_code="SCHEMA_ERROR",
            error_message=str(exc),
            execution_time_ms=elapsed_ms,
            idempotency_key=request.idempotency_key,
        )

    # 3. Require client-generated idempotency keys before any active write.
    requires_write_key = tool_name == ToolName.BOOK_EVENT.value or (
        tool_name == ToolName.CANCEL_EVENT.value and tool_kwargs.get("confirm", False)
    )
    if requires_write_key and not request.idempotency_key:
        return ToolExecutionResponse(
            status="error",
            error_code="IDEMPOTENCY_KEY_REQUIRED",
            error_message=f"A client-generated idempotency key is required for {tool_name}.",
            execution_time_ms=(time.perf_counter() - start_time) * 1000,
        )

    # 4. ANE-03 Permission Interceptor for destructive actions.
    if tool_name in CONFIRMATION_REQUIRED_TOOLS:
        is_confirmed = tool_kwargs.get("confirm", False)
        if not is_confirmed:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            target_id = tool_kwargs.get("event_id", "specified item")
            confirmation_token, _ = await issue_confirmation_token(
                user_id=request.user_id,
                tool_name=tool_name,
                event_id=str(target_id),
                parameters={
                    "event_id": str(target_id),
                    "reason": tool_kwargs.get("reason"),
                },
            )
            prompt_to_speak = (
                f"Are you sure you want to cancel the event with ID {target_id}? "
                "Please say yes to confirm or no to cancel."
            )
            logger.info("ANE-03 Interceptor gated tool '%s'; issued token %s", tool_name, confirmation_token)
            return ToolExecutionResponse(
                status="confirmation_required",
                data={
                    "status": "confirmation_required",
                    "confirmation_token": confirmation_token,
                    "prompt_to_speak": prompt_to_speak,
                    "tool_name": tool_name,
                    "impact_summary": {
                        "action": tool_name,
                        "parameters": tool_kwargs,
                    },
                },
                execution_time_ms=elapsed_ms,
                idempotency_key=request.idempotency_key,
            )

        confirmation_token = tool_kwargs.get("confirmation_token")
        if not confirmation_token:
            return ToolExecutionResponse(
                status="error",
                error_code="CONFIRMATION_TOKEN_REQUIRED",
                error_message="A valid confirmation token is required to cancel an event.",
                execution_time_ms=(time.perf_counter() - start_time) * 1000,
                idempotency_key=request.idempotency_key,
            )

    tool_func = TOOL_REGISTRY[tool_name]
    idempotency_key = request.idempotency_key

    # 5. Idempotency check. This happens before token consumption so a network
    # retry can safely receive the committed response without reusing a token.
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
                    error_code="IDEMPOTENCY_CONFLICT",
                    error_message=msg,
                    execution_time_ms=elapsed_ms,
                    idempotency_key=idempotency_key,
                )

    if tool_name in CONFIRMATION_REQUIRED_TOOLS:
        confirmed, confirmation_message = await consume_confirmation_token(
            token=tool_kwargs["confirmation_token"],
            user_id=request.user_id,
            tool_name=tool_name,
            event_id=str(tool_kwargs["event_id"]),
            parameters={
                "event_id": str(tool_kwargs["event_id"]),
                "reason": tool_kwargs.get("reason"),
            },
        )
        if not confirmed:
            if idempotency_key:
                await release_idempotency_lock(key=idempotency_key)
            return ToolExecutionResponse(
                status="error",
                error_code="INVALID_CONFIRMATION_TOKEN",
                error_message=confirmation_message,
                execution_time_ms=(time.perf_counter() - start_time) * 1000,
                idempotency_key=idempotency_key,
            )

    # 6. Inject context for system-level and user-scoped tools
    if tool_name in (
        ToolName.BOOK_EVENT.value,
        ToolName.GET_CALENDAR_AVAILABILITY.value,
        ToolName.CANCEL_EVENT.value,
        ToolName.LIST_EVENTS.value,
    ):
        tool_kwargs["user_id"] = tool_kwargs.get("user_id") or request.user_id
        if tool_name == ToolName.BOOK_EVENT.value:
            tool_kwargs["session_id"] = tool_kwargs.get("session_id") or request.session_id
    elif tool_name == ToolName.CREATE_DURABLE_TASK.value:
        tool_kwargs["user_id"] = request.user_id
        tool_kwargs["session_id"] = request.session_id

    # 7. Execute Tool Function
    try:
        import inspect
        sig = inspect.signature(tool_func)
        call_params = {k: v for k, v in tool_kwargs.items() if k in sig.parameters}
        result = await tool_func(**call_params)
        elapsed_ms = (time.perf_counter() - start_time) * 1000

        # Handle structured conflict returned by tools (e.g. slot collision)
        if isinstance(result, dict) and result.get("status") == "conflict":
            if idempotency_key:
                await release_idempotency_lock(key=idempotency_key)
            msg = result.get("error") or result.get("message") or "Time slot already occupied"
            return ToolExecutionResponse(
                status="conflict",
                error_code="SLOT_CONFLICT",
                error_message=msg,
                message=msg,
                data=result,
                execution_time_ms=elapsed_ms,
                idempotency_key=idempotency_key,
            )

        # Handle confirmation_required returned directly by tools
        if isinstance(result, dict) and result.get("status") == "confirmation_required":
            msg = result.get("message") or "Confirmation required"
            return ToolExecutionResponse(
                status="confirmation_required",
                message=msg,
                data=result,
                execution_time_ms=elapsed_ms,
                idempotency_key=idempotency_key,
            )

        # 8. Commit Idempotency Lock on Success
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

        # 9. Release Lock on Error
        if idempotency_key:
            await release_idempotency_lock(key=idempotency_key)

        return ToolExecutionResponse(
            status="error",
            error_code="EXECUTION_ERROR",
            error_message=str(exc),
            execution_time_ms=elapsed_ms,
            idempotency_key=idempotency_key,
        )
