"""
Pydantic Schemas for Tool and Task Execution
Strict contracts between LiveKit Voice Agent and Backend Tool Dispatcher.
Enforces Pillar 2 of the Anti-Divergence Framework (schema confinement).
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple, Type
from pydantic import BaseModel, ConfigDict, Field, field_validator
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


# ==============================================================================
# 1. Registered Tool Identifiers
# ==============================================================================
class ToolName(str, Enum):
    GET_CALENDAR_AVAILABILITY = "get_calendar_availability"
    BOOK_EVENT = "book_event"
    CANCEL_EVENT = "cancel_event"
    LIST_EVENTS = "list_events"
    SEARCH_CONTACTS = "search_contacts"
    DRAFT_EMAIL = "draft_email"
    CREATE_DURABLE_TASK = "create_durable_task"


# ==============================================================================
# 2. Base Configuration for Schemas
# ==============================================================================
class ToolParamsBase(BaseModel):
    """Base class for all tool input parameters. Forbids extra/hallucinated fields."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ToolResultBase(BaseModel):
    """Base class for all structured tool results."""
    model_config = ConfigDict(extra="ignore")


# ==============================================================================
# 3. Calendar Tools Schemas
# ==============================================================================
class GetCalendarAvailabilityParams(ToolParamsBase):
    start_date: Optional[str] = Field(
        default=None,
        description="Start date to query in YYYY-MM-DD format. Defaults to today.",
        pattern=r"^\d{4}-\d{2}-\d{2}(?:T.*)?$",
    )
    end_date: Optional[str] = Field(
        default=None,
        description="End date to query in YYYY-MM-DD format. Defaults to start_date.",
        pattern=r"^\d{4}-\d{2}-\d{2}(?:T.*)?$",
    )
    duration_minutes: int = Field(
        default=30,
        ge=5,
        le=480,
        description="Minimum duration needed for the meeting slot in minutes (default 30).",
    )
    timezone: Optional[str] = Field(
        default=None,
        description="Optional IANA timezone override. If omitted, use the company's configured timezone.",
    )

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone must be a valid IANA timezone") from exc
        return value


class CalendarAvailabilityResult(ToolResultBase):
    date: Optional[str] = Field(default=None, description="The query date in YYYY-MM-DD format")
    start_date: Optional[str] = Field(default=None, description="Start date of availability window")
    end_date: Optional[str] = Field(default=None, description="End date of availability window")
    user_id: Optional[str] = Field(default=None, description="User UUID")
    available_slots: List[str] = Field(default_factory=list, description="List of ISO 8601 available timestamp strings")
    duration_minutes: int = Field(default=30, description="Slot length in minutes")
    timezone: str = Field(default="UTC")
    source: str = Field(default="neon_postgres")


class BookEventParams(ToolParamsBase):
    title: str = Field(
        ...,
        min_length=1,
        max_length=200,
        description="Title or subject of the meeting/event.",
    )
    start_time: str = Field(
        ...,
        description="Start time in ISO 8601 format, e.g. '2026-09-20T14:00:00Z'.",
    )
    timezone: Optional[str] = Field(
        default=None,
        description="Optional IANA timezone used to interpret a start_time without an explicit UTC offset. If omitted, use the company's configured timezone.",
    )

    @field_validator("timezone")
    @classmethod
    def validate_booking_timezone(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone must be a valid IANA timezone") from exc
        return value

    duration_minutes: int = Field(
        default=30,
        ge=5,
        le=480,
        description="Meeting duration in minutes (default 30).",
    )
    attendees: List[str] = Field(
        default_factory=list,
        description="List of attendee email addresses or full names.",
    )
    description: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Optional meeting agenda or description notes.",
    )
    location: Optional[str] = Field(
        default="Google Meet",
        max_length=255,
        description="Meeting location or video conferencing link description.",
    )


class BookEventResult(ToolResultBase):
    event_id: Optional[str] = Field(default=None, description="Unique event identifier")
    id: Optional[str] = Field(default=None, description="Unique event UUID")
    title: str = Field(..., description="Event title")
    start_time: str = Field(..., description="Confirmed ISO 8601 start timestamp")
    end_time: str = Field(..., description="Confirmed ISO 8601 end timestamp")
    duration_minutes: int = Field(..., description="Duration in minutes")
    attendees: List[str] = Field(default_factory=list)
    meet_link: Optional[str] = Field(default=None, description="Video conferencing link")
    status: str = Field(default="confirmed", description="Scheduling status")
    source: str = Field(default="neon_postgres")


class CancelEventParams(ToolParamsBase):
    event_id: str = Field(
        ...,
        min_length=1,
        max_length=128,
        description="Unique identifier of the calendar event to cancel.",
    )
    reason: Optional[str] = Field(
        default=None,
        max_length=500,
        description="Optional reason for cancellation.",
    )
    confirm: bool = Field(
        default=False,
        description="Explicit user confirmation flag. Must be true to execute side-effect (ANE-03).",
    )
    confirmation_token: Optional[str] = Field(
        default=None,
        description="Cryptographic token issued by the confirmation interceptor.",
    )


class CancelEventResult(ToolResultBase):
    event_id: Optional[str] = Field(default=None, description="Cancelled event identifier")
    id: Optional[str] = Field(default=None, description="Event identifier")
    status: str = Field(default="cancelled", description="New status")
    cancelled_at: Optional[str] = Field(default=None, description="ISO 8601 cancellation timestamp")
    reason: Optional[str] = Field(default=None)


class ListEventsParams(ToolParamsBase):
    start_date: Optional[str] = Field(
        default=None,
        description="Start date in YYYY-MM-DD format. Defaults to today.",
        pattern=r"^\d{4}-\d{2}-\d{2}(?:T.*)?$",
    )
    end_date: Optional[str] = Field(
        default=None,
        description="End date in YYYY-MM-DD format. Defaults to start_date.",
        pattern=r"^\d{4}-\d{2}-\d{2}(?:T.*)?$",
    )
    timezone: Optional[str] = Field(
        default=None,
        description="Optional IANA timezone override. If omitted, use the company's configured timezone.",
    )
    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone must be a valid IANA timezone") from exc
        return value


class ListEventsResult(ToolResultBase):
    user_id: Optional[str] = Field(default=None)
    start_date: Optional[str] = Field(default=None)
    end_date: Optional[str] = Field(default=None)
    timezone: str = Field(default="UTC")
    count: int = Field(default=0)
    events: List[Dict[str, Any]] = Field(default_factory=list)
    source: str = Field(default="neon_postgres")


# ==============================================================================
# 4. Contacts & CRM Schemas
# ==============================================================================
class ContactItem(BaseModel):
    id: str = Field(..., description="Contact unique ID")
    name: str = Field(..., description="Full name")
    email: str = Field(..., description="Email address")
    phone: Optional[str] = Field(default=None, description="Phone number")
    company: Optional[str] = Field(default=None, description="Company or organization")
    role: Optional[str] = Field(default=None, description="Job title or role")


class SearchContactsParams(ToolParamsBase):
    query: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Search term (name, email, or company to look up).",
    )
    limit: int = Field(
        default=5,
        ge=1,
        le=25,
        description="Maximum number of contact records to return (default 5).",
    )


class SearchContactsResult(ToolResultBase):
    query: str = Field(..., description="The query string executed")
    count: int = Field(..., description="Number of matches returned")
    contacts: List[ContactItem] = Field(default_factory=list, description="List of matched contact records")
    source: str = Field(default="contacts_directory")


# ==============================================================================
# 5. Email Schemas
# ==============================================================================
class DraftEmailParams(ToolParamsBase):
    recipient_email: str = Field(
        ...,
        min_length=3,
        max_length=255,
        description="Recipient email address.",
    )
    subject: str = Field(
        ...,
        min_length=1,
        max_length=250,
        description="Email subject line.",
    )
    body: str = Field(
        ...,
        min_length=1,
        max_length=10000,
        description="Full text content of the email draft.",
    )
    cc: Optional[List[str]] = Field(
        default=None,
        description="Optional list of CC email addresses.",
    )


class DraftEmailResult(ToolResultBase):
    draft_id: str = Field(..., description="Unique draft identifier")
    recipient_email: str = Field(..., description="Primary recipient")
    subject: str = Field(..., description="Email subject")
    body_snippet: str = Field(..., description="Preview snippet of draft body")
    status: str = Field(default="drafted", description="Draft status")
    source: str = Field(default="gmail")


# ==============================================================================
# 6. Durable Background Task Schemas (Trigger.dev Lane)
# ==============================================================================
class CreateDurableTaskParams(ToolParamsBase):
    task_type: str = Field(
        ...,
        min_length=1,
        max_length=64,
        description="Type of background job: 'briefing_analysis', 'research_report', 'batch_sync'.",
    )
    title: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Human-readable title describing the background task.",
    )
    payload: Dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary input parameters for the background worker.",
    )
    estimated_duration_sec: Optional[int] = Field(
        default=None,
        ge=1,
        le=3600,
        description="Estimated duration in seconds for completion.",
    )


class DurableTaskResult(ToolResultBase):
    task_id: str = Field(..., description="UUID of the durable task in PostgreSQL")
    title: str = Field(..., description="Task title")
    status: str = Field(default="pending", description="Initial queue status: 'pending' or 'running'")
    tracking_url: Optional[str] = Field(default=None, description="Dashboard URL to inspect task progress")
    spoken_ack: str = Field(
        ...,
        description="Recommended spoken acknowledgement for Gemini Live (e.g. 'I have started that briefing...').",
    )


# ==============================================================================
# 7. ANE-03 Confirmation Protocol Schema
# ==============================================================================
class ConfirmationRequiredResult(ToolResultBase):
    status: str = Field(default="confirmation_required")
    confirmation_token: str = Field(..., description="Transient token that must be echoed back with confirm=True")
    prompt_to_speak: str = Field(..., description="Exact question Gemini Live must speak to the user")
    tool_name: str = Field(..., description="The gated tool awaiting confirmation")
    impact_summary: Dict[str, Any] = Field(..., description="Summary of the action that will take place")


# ==============================================================================
# 8. Dispatcher Request / Response Models
# ==============================================================================
class ToolExecutionRequest(BaseModel):
    tool_name: str = Field(..., description="The name of the tool to execute")
    parameters: Dict[str, Any] = Field(
        default_factory=dict,
        description="Named arguments passed to the tool function",
    )
    user_id: Optional[str] = Field(
        default=None,
        description="Legacy field rejected for untrusted callers; identity comes from session_context.",
    )
    session_context: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Signed internal LiveKit context. Never supplied by Gemini or the browser.",
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
    status: str = Field(..., description="'success', 'error', 'conflict', or 'confirmation_required'")
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
    message: Optional[str] = Field(
        default=None,
        description="Descriptive message or status explanation",
    )
    error_code: Optional[str] = Field(
        default=None,
        description="Error classification code, e.g. 'VALIDATION_ERROR', 'IDEMPOTENCY_CONFLICT'",
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


# ==============================================================================
# 9. Schema Registry & Validation Engine
# ==============================================================================
TOOL_SCHEMAS: Dict[str, Tuple[Type[BaseModel], Type[BaseModel]]] = {
    ToolName.GET_CALENDAR_AVAILABILITY.value: (GetCalendarAvailabilityParams, CalendarAvailabilityResult),
    ToolName.BOOK_EVENT.value: (BookEventParams, BookEventResult),
    ToolName.CANCEL_EVENT.value: (CancelEventParams, CancelEventResult),
    ToolName.LIST_EVENTS.value: (ListEventsParams, ListEventsResult),
    ToolName.SEARCH_CONTACTS.value: (SearchContactsParams, SearchContactsResult),
    ToolName.DRAFT_EMAIL.value: (DraftEmailParams, DraftEmailResult),
    ToolName.CREATE_DURABLE_TASK.value: (CreateDurableTaskParams, DurableTaskResult),
}


def validate_tool_params(tool_name: str, raw_params: Dict[str, Any]) -> BaseModel:
    """
    Validates raw dictionary parameters against the tool's registered Pydantic input model.
    Raises ValidationError if invalid or unexpected parameters are present.
    """
    if tool_name not in TOOL_SCHEMAS:
        raise ValueError(f"No schema registered for tool '{tool_name}'")
    input_model, _ = TOOL_SCHEMAS[tool_name]
    return input_model.model_validate(raw_params)


def get_tool_input_schema(tool_name: str) -> Dict[str, Any]:
    """
    Returns the JSONSchema dictionary for the specified tool's input parameters.
    """
    if tool_name not in TOOL_SCHEMAS:
        raise ValueError(f"No schema registered for tool '{tool_name}'")
    input_model, _ = TOOL_SCHEMAS[tool_name]
    return input_model.model_json_schema()
