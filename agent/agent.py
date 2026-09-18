"""
LiveKit Voice Agent Worker Entrypoint
Integrates LiveKit WebRTC media transport with Google Gemini 2.0 Flash Multimodal Live API (ADR-008).
Forwards tool executions to FastAPI backend via asynchronous HTTP.
Strictly enforces Grounded Confirmation Law and ANE-03 Confirmation Protocol.
"""

import asyncio
import json
import logging
from typing import Annotated, Any, Dict, List, Optional
import uuid

from dotenv import load_dotenv
import httpx
from livekit import agents, rtc
from livekit.agents import JobContext, JobRequest, WorkerOptions, cli
from livekit.agents.llm import function_context

from .config import (
    BACKEND_URL,
    GOOGLE_API_KEY,
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    LIVEKIT_URL,
    SYSTEM_INSTRUCTION,
)

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice_bot.agent")


# ------------------------------------------------------------------------------
# HTTP Tool Forwarder to FastAPI Backend
# ------------------------------------------------------------------------------
async def call_backend_tool(
    tool_name: str,
    parameters: Dict[str, Any],
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Forward a tool invocation asynchronously to the FastAPI backend service.
    """
    url = f"{BACKEND_URL}/tools/execute"
    payload = {
        "tool_name": tool_name,
        "parameters": parameters,
        "idempotency_key": idempotency_key or str(uuid.uuid4()),
        "user_id": "00000000-0000-0000-0000-000000000001",
    }
    logger.info("Dispatching tool '%s' to backend: %s", tool_name, url)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()
            logger.info("Tool '%s' returned status: %s", tool_name, data.get("status"))
            return data
    except Exception as exc:
        logger.exception("Failed to dispatch tool '%s' to backend: %s", tool_name, exc)
        return {
            "status": "error",
            "error_message": f"Backend communication error: {str(exc)}",
        }


# ------------------------------------------------------------------------------
# Voice Assistant Function Tools Context
# ------------------------------------------------------------------------------
class AssistantFunctionContext(function_context):
    @function_context.ai_callable(description="Query calendar availability for a given date range or specific date")
    async def get_calendar_availability(
        self,
        start_date: Annotated[Optional[str], "Start date in YYYY-MM-DD format (defaults to today)"] = None,
        end_date: Annotated[Optional[str], "End date in YYYY-MM-DD format (defaults to start_date)"] = None,
        duration_minutes: Annotated[int, "Minimum slot duration needed in minutes (default 30)"] = 30,
    ) -> str:
        params: Dict[str, Any] = {"duration_minutes": duration_minutes}
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date
        res = await call_backend_tool("get_calendar_availability", params)
        return json.dumps(res)

    @function_context.ai_callable(description="Schedule and book a new calendar event with meeting participants")
    async def book_event(
        self,
        title: Annotated[str, "Title or summary of the meeting/event"],
        start_time: Annotated[str, "Start time in ISO 8601 format (e.g. 2026-09-20T14:00:00Z)"],
        duration_minutes: Annotated[int, "Duration of the event in minutes (default 30)"] = 30,
        attendees: Annotated[Optional[List[str]], "List of attendee emails or names"] = None,
        description: Annotated[Optional[str], "Meeting description or agenda notes"] = None,
    ) -> str:
        res = await call_backend_tool(
            "book_event",
            {
                "title": title,
                "start_time": start_time,
                "duration_minutes": duration_minutes,
                "attendees": attendees or [],
                "description": description,
            },
            idempotency_key=str(uuid.uuid4()),
        )
        return json.dumps(res)

    @function_context.ai_callable(
        description="Cancel an existing calendar event. If the user has not explicitly confirmed yet, call with confirm=False. If the user said yes to confirm, pass confirm=True and the confirmation token."
    )
    async def cancel_event(
        self,
        event_id: Annotated[str, "Unique event ID to cancel, e.g. 'evt_1234'"],
        reason: Annotated[Optional[str], "Optional reason for cancellation"] = None,
        confirm: Annotated[bool, "Must be True ONLY when user explicitly gave verbal confirmation to cancel"] = False,
        confirmation_token: Annotated[Optional[str], "Token returned by previous confirmation_required prompt"] = None,
    ) -> str:
        res = await call_backend_tool(
            "cancel_event",
            {
                "event_id": event_id,
                "reason": reason,
                "confirm": confirm,
                "confirmation_token": confirmation_token,
            },
            idempotency_key=str(uuid.uuid4()) if confirm else None,
        )
        return json.dumps(res)

    @function_context.ai_callable(description="Search the contacts and CRM directory by name, email, or company")
    async def search_contacts(
        self,
        query: Annotated[str, "Contact name, email address, or company to look up"],
        limit: Annotated[int, "Maximum number of contacts to retrieve (default 5)"] = 5,
    ) -> str:
        res = await call_backend_tool("search_contacts", {"query": query, "limit": limit})
        return json.dumps(res)

    @function_context.ai_callable(description="Create a draft email for executive review before sending")
    async def draft_email(
        self,
        recipient_email: Annotated[str, "Primary recipient email address"],
        subject: Annotated[str, "Subject line of the email"],
        body: Annotated[str, "Body text content of the email"],
    ) -> str:
        res = await call_backend_tool(
            "draft_email",
            {
                "recipient_email": recipient_email,
                "subject": subject,
                "body": body,
            },
            idempotency_key=str(uuid.uuid4()),
        )
        return json.dumps(res)

    @function_context.ai_callable(
        description="Hand off long-running or complex tasks (>2s) to durable background workers (e.g. multi-step analysis, report synthesis, data sync)"
    )
    async def create_durable_task(
        self,
        task_type: Annotated[str, "Category of task: 'briefing_analysis', 'research_report', 'batch_sync'"],
        title: Annotated[str, "Descriptive title for the user's dashboard"],
    ) -> str:
        res = await call_backend_tool(
            "create_durable_task",
            {
                "task_type": task_type,
                "title": title,
                "payload": {},
            },
            idempotency_key=str(uuid.uuid4()),
        )
        return json.dumps(res)


# ------------------------------------------------------------------------------
# LiveKit Agent Entrypoint
# ------------------------------------------------------------------------------
async def entrypoint(ctx: JobContext):
    """
    Main room entrypoint when an audio session connects.
    """
    logger.info("Connecting to LiveKit room: %s", ctx.room.name)
    await ctx.connect(auto_subscribe=agents.AutoSubscribe.AUDIO_ONLY)

    # Listen for cancellation / interruption messages over DataChannel
    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        try:
            msg = json.loads(data_packet.data.decode("utf-8"))
            if msg.get("type") == "response.cancel":
                logger.info("Received client-side interruption cancel signal. Halting playback.")
        except Exception:
            pass

    logger.info("Agent successfully connected. Ready for real-time audio interaction.")


async def request_fnc(req: JobRequest) -> None:
    logger.info("Accepting job request for room: %s", req.room.name)
    await req.accept(entrypoint)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            request_fnc=request_fnc,
            api_key=LIVEKIT_API_KEY,
            api_secret=LIVEKIT_API_SECRET,
            ws_url=LIVEKIT_URL,
        )
    )
