"""
Pydantic Schemas for Tool and Task Execution
Strict contracts between LiveKit Voice Agent and Backend Tool Dispatcher.
"""

from datetime import datetime
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field


class ToolExecutionRequest(BaseModel):
    tool_name: str = Field(..., description="The name of the tool to execute")
    parameters: Dict[str, Any] = Field(
        default_factory=dict,
        description="Named arguments passed to the tool function",
    )
    user_id: str = Field(
        default="00000000-0000-0000-0000-000000000001",
        description="UUID of the authenticated voice user",
    )
    session_id: Optional[str] = Field(
        default=None,
        description="Active LiveKit room or session identifier",
    )
    idempotency_key: Optional[str] = Field(
        default=None,
        description="Client-generated UUID idempotency key to prevent duplicate writes",
    )


class ToolExecutionResponse(BaseModel):
    status: str = Field(..., description="'success', 'error', or 'conflict'")
    data: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Structured JSON result returned by the tool",
    )
    execution_time_ms: float = Field(
        default=0.0,
        description="Measured backend execution turnaround time in milliseconds",
    )
    error_message: Optional[str] = Field(
        default=None,
        description="Human-readable error description when status is 'error'",
    )
    idempotency_key: Optional[str] = Field(
        default=None,
        description="Echoes the idempotency key committed or acquired",
    )


class TaskStatusResponse(BaseModel):
    task_id: str = Field(..., description="UUID of the background task")
    status: str = Field(..., description="'pending', 'running', 'completed', 'failed', or 'cancelled'")
    title: str = Field(..., description="Descriptive title of the task")
    tool_name: str = Field(..., description="Name of the underlying tool")
    output_result: Optional[Dict[str, Any]] = Field(default=None)
    error_message: Optional[str] = Field(default=None)
    created_at: Optional[datetime] = Field(default=None)
    updated_at: Optional[datetime] = Field(default=None)


class TaskCancelResponse(BaseModel):
    task_id: str = Field(...)
    cancelled: bool = Field(...)
    message: str = Field(...)
