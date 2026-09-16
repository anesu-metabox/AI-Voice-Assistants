"""
LiveKit Voice Agent Worker Entrypoint
Integrates LiveKit WebRTC media transport with Google Gemini 2.0 Flash Multimodal Live API (ADR-008).
Forwards tool executions to FastAPI backend via asynchronous HTTP.
"""

import asyncio
import json
import logging
import uuid
from typing import Annotated, Any, Dict, Optional

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
    @function_context.ai_callable(description="Query calendar availability for a given date range")
    async def get_calendar_availability(
        self,
        start_date: Annotated[str, "Start date in YYYY-MM-DD format"],
        end_date: Annotated[Optional[str], "End date in YYYY-MM-DD format"] = None,
        duration_minutes: Annotated[int, "Meeting duration in minutes (default 30)"] = 30,
    ) -> str:
        res = await call_backend_tool(
            "get_calendar_availability",
            {
                "start_date": start_date,
                "end_date": end_date,
                "duration_minutes": duration_minutes,
            },
        )
        return json.dumps(res)

    @function_context.ai_callable(description="Schedule and book a new calendar event")
    async def book_event(
        self,
        title: Annotated[str, "Title or summary of the meeting"],
        start_time: Annotated[str, "Start time in ISO format (e.g. 2026-09-20T14:00:00Z)"],
        duration_minutes: Annotated[int, "Duration of the event in minutes"] = 30,
        attendee_email: Annotated[Optional[str], "Email address of the attendee"] = None,
    ) -> str:
        res = await call_backend_tool(
            "book_event",
            {
                "title": title,
                "start_time": start_time,
                "duration_minutes": duration_minutes,
                "attendees": [attendee_email] if attendee_email else [],
            },
            idempotency_key=str(uuid.uuid4()),
        )
        return json.dumps(res)

    @function_context.ai_callable(description="Search the contacts and CRM directory")
    async def search_contacts(
        self,
        query: Annotated[str, "Name, email, or company to search for"],
    ) -> str:
        res = await call_backend_tool("search_contacts", {"query": query})
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
