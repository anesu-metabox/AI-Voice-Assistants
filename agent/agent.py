"""
LiveKit Voice Agent Worker Entrypoint
Integrates LiveKit WebRTC media transport with Google Gemini 2.0 Flash Multimodal Live API (ADR-008).
Forwards tool executions to FastAPI backend via asynchronous HTTP.
Strictly enforces Grounded Confirmation Law, ANE-03 Confirmation Protocol, and Real-Time DataChannel Updates.
"""

import asyncio
import json
import logging
import os
import time
from typing import Annotated, Any, Dict, List, Optional
import uuid

import httpx
from livekit import agents, rtc
from livekit.agents import JobContext, WorkerOptions, cli, llm
from livekit.agents.llm import ChatMessage
from livekit.agents.voice import (
    Agent,
    AgentSession,
    ConversationItemAddedEvent,
    UserInputTranscribedEvent,
)
from livekit.plugins.google import realtime

try:
    from .config import (
        BACKEND_URL,
        GEMINI_MODEL,
        GEMINI_VOICE,
        GOOGLE_API_KEY,
        LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET,
        LIVEKIT_URL,
        SYSTEM_INSTRUCTION,
    )
except ImportError:
    from config import (
        BACKEND_URL,
        GEMINI_MODEL,
        GEMINI_VOICE,
        GOOGLE_API_KEY,
        LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET,
        LIVEKIT_URL,
        SYSTEM_INSTRUCTION,
    )

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice_bot.agent")


# ------------------------------------------------------------------------------
# Real-Time DataChannel Broadcast Helper
# ------------------------------------------------------------------------------
async def broadcast_task_update(
    room: Optional[rtc.Room],
    task_id: str,
    title: str,
    tool_name: str,
    status: str,
    output: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
) -> None:
    """Broadcasts a real-time task card update to the frontend via WebRTC DataChannel."""
    if not room or not room.local_participant:
        return

    payload = {
        "type": "task_update",
        "task": {
            "id": task_id,
            "title": title,
            "tool_name": tool_name,
            "status": status,
            "output": output,
            "error": error,
            "timestamp": time.time(),
        },
    }
    try:
        data = json.dumps(payload).encode("utf-8")
        await room.local_participant.publish_data(data, reliable=True)
    except Exception as exc:
        logger.warning("Failed to broadcast task_update via DataChannel: %s", exc)


async def broadcast_transcript(
    room: Optional[rtc.Room],
    role: str,
    text: str,
    is_final: bool = True,
) -> None:
    """Broadcasts transcription messages to the frontend via WebRTC DataChannel."""
    if not room or not room.local_participant or not text.strip():
        return

    payload = {
        "type": "transcript",
        "role": role,
        "text": text,
        "is_final": is_final,
        "timestamp": time.time(),
    }
    try:
        data = json.dumps(payload).encode("utf-8")
        await room.local_participant.publish_data(data, reliable=True)
    except Exception as exc:
        logger.warning("Failed to broadcast transcript via DataChannel: %s", exc)


# ------------------------------------------------------------------------------
# Backend Dispatcher
# ------------------------------------------------------------------------------
async def call_backend_tool(
    tool_name: str,
    params: Dict[str, Any],
    user_id: str = "default_user",
    idempotency_key: Optional[str] = None,
) -> Dict[str, Any]:
    """Dispatches tool execution requests to the FastAPI backend with optional idempotency key."""
    url = f"{BACKEND_URL.rstrip('/')}/tools/execute"
    payload = {
        "tool_name": tool_name,
        "parameters": params,
        "user_id": user_id,
    }
    if idempotency_key:
        payload["idempotency_key"] = idempotency_key

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        return response.json()


# ------------------------------------------------------------------------------
# Voice Assistant Agent Class
# ------------------------------------------------------------------------------
class VoiceBotAgent(Agent):
    """
    LiveKit Voice Agent integrating Gemini Realtime Multimodal audio and backend tool dispatch.
    Implements all 7 business tools with strict read/write idempotency segregation.
    """

    def __init__(self, room: rtc.Room, instructions: str):
        super().__init__(instructions=instructions)
        self.room = room

    # --- Tool 1: get_calendar_availability (Read-Only) ---
    @llm.function_tool(
        description="Query calendar availability for a single specified date (YYYY-MM-DD). Do not call for multi-day date ranges; use list_events instead."
    )
    async def get_calendar_availability(
        self,
        date: Annotated[str, "Date to check availability for in YYYY-MM-DD format."],
        user_id: Annotated[str, "User ID associated with the calendar."] = "default_user",
    ) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        title = f"Checking availability for {date}"
        await broadcast_task_update(self.room, task_id, title, "get_calendar_availability", "running")

        try:
            result = await call_backend_tool(
                "get_calendar_availability",
                {"date": date},
                user_id=user_id,
                idempotency_key=None,
            )
            await broadcast_task_update(
                self.room, task_id, title, "get_calendar_availability", "completed", output=result
            )
            return json.dumps(result)
        except Exception as exc:
            logger.error("get_calendar_availability error: %s", exc)
            await broadcast_task_update(
                self.room, task_id, title, "get_calendar_availability", "failed", error=str(exc)
            )
            return json.dumps({"error": str(exc), "status": "failed"})

    # --- Tool 2: list_events (Read-Only) ---
    @llm.function_tool(
        description="List scheduled calendar events over a multi-day date range or time window using start_date and end_date (YYYY-MM-DD)."
    )
    async def list_events(
        self,
        start_date: Annotated[str, "Start date of the search window in YYYY-MM-DD format."],
        end_date: Annotated[str, "End date of the search window in YYYY-MM-DD format."],
        user_id: Annotated[str, "User ID associated with the calendar."] = "default_user",
    ) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        title = f"Listing events from {start_date} to {end_date}"
        await broadcast_task_update(self.room, task_id, title, "list_events", "running")

        try:
            result = await call_backend_tool(
                "list_events",
                {"start_date": start_date, "end_date": end_date},
                user_id=user_id,
                idempotency_key=None,
            )
            await broadcast_task_update(
                self.room, task_id, title, "list_events", "completed", output=result
            )
            return json.dumps(result)
        except Exception as exc:
            logger.error("list_events error: %s", exc)
            await broadcast_task_update(
                self.room, task_id, title, "list_events", "failed", error=str(exc)
            )
            return json.dumps({"error": str(exc), "status": "failed"})

    # --- Tool 3: book_appointment (State-Modifying) ---
    @llm.function_tool(
        description="Book a new appointment. State-modifying action requiring verified user confirmation. Generates client idempotency key."
    )
    async def book_appointment(
        self,
        start_time: Annotated[str, "Start time in ISO 8601 format (e.g. 2026-09-20T10:00:00Z)."],
        end_time: Annotated[str, "End time in ISO 8601 format (e.g. 2026-09-20T11:00:00Z)."],
        title: Annotated[str, "Title or summary of the appointment."],
        contact_id: Annotated[Optional[str], "Contact ID if booking on behalf of an existing contact."] = None,
        contact_name: Annotated[Optional[str], "Contact name if booking without contact ID."] = None,
        user_id: Annotated[str, "User ID."] = "default_user",
    ) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        action_title = f"Booking: {title}"
        await broadcast_task_update(self.room, task_id, action_title, "book_appointment", "running")

        try:
            params = {
                "start_time": start_time,
                "end_time": end_time,
                "title": title,
            }
            if contact_id:
                params["contact_id"] = contact_id
            if contact_name:
                params["contact_name"] = contact_name

            idempotency_key = f"book_{uuid.uuid4()}"
            result = await call_backend_tool(
                "book_appointment",
                params,
                user_id=user_id,
                idempotency_key=idempotency_key,
            )
            await broadcast_task_update(
                self.room, task_id, action_title, "book_appointment", "completed", output=result
            )
            return json.dumps(result)
        except Exception as exc:
            logger.error("book_appointment error: %s", exc)
            await broadcast_task_update(
                self.room, task_id, action_title, "book_appointment", "failed", error=str(exc)
            )
            return json.dumps({"error": str(exc), "status": "failed"})

    # --- Tool 4: reschedule_appointment (State-Modifying) ---
    @llm.function_tool(
        description="Reschedule an existing appointment to a new time window. State-modifying action requiring verified user confirmation."
    )
    async def reschedule_appointment(
        self,
        appointment_id: Annotated[str, "ID of the appointment to reschedule."],
        new_start_time: Annotated[str, "New start time in ISO 8601 format."],
        new_end_time: Annotated[str, "New end time in ISO 8601 format."],
        user_id: Annotated[str, "User ID."] = "default_user",
    ) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        title = f"Rescheduling appointment {appointment_id}"
        await broadcast_task_update(self.room, task_id, title, "reschedule_appointment", "running")

        try:
            idempotency_key = f"resched_{uuid.uuid4()}"
            result = await call_backend_tool(
                "reschedule_appointment",
                {
                    "appointment_id": appointment_id,
                    "new_start_time": new_start_time,
                    "new_end_time": new_end_time,
                },
                user_id=user_id,
                idempotency_key=idempotency_key,
            )
            await broadcast_task_update(
                self.room, task_id, title, "reschedule_appointment", "completed", output=result
            )
            return json.dumps(result)
        except Exception as exc:
            logger.error("reschedule_appointment error: %s", exc)
            await broadcast_task_update(
                self.room, task_id, title, "reschedule_appointment", "failed", error=str(exc)
            )
            return json.dumps({"error": str(exc), "status": "failed"})

    # --- Tool 5: cancel_appointment (State-Modifying) ---
    @llm.function_tool(
        description="Cancel a scheduled appointment. Irreversible state-modifying action requiring explicit user confirmation."
    )
    async def cancel_appointment(
        self,
        appointment_id: Annotated[str, "ID of the appointment to cancel."],
        user_id: Annotated[str, "User ID."] = "default_user",
    ) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        title = f"Cancelling appointment {appointment_id}"
        await broadcast_task_update(self.room, task_id, title, "cancel_appointment", "running")

        try:
            idempotency_key = f"cancel_{uuid.uuid4()}"
            result = await call_backend_tool(
                "cancel_appointment",
                {"appointment_id": appointment_id},
                user_id=user_id,
                idempotency_key=idempotency_key,
            )
            await broadcast_task_update(
                self.room, task_id, title, "cancel_appointment", "completed", output=result
            )
            return json.dumps(result)
        except Exception as exc:
            logger.error("cancel_appointment error: %s", exc)
            await broadcast_task_update(
                self.room, task_id, title, "cancel_appointment", "failed", error=str(exc)
            )
            return json.dumps({"error": str(exc), "status": "failed"})

    # --- Tool 6: search_contacts (Read-Only) ---
    @llm.function_tool(
        description="Search stored contacts by full or partial name."
    )
    async def search_contacts(
        self,
        query: Annotated[str, "Name or keyword to search for in contacts."],
        user_id: Annotated[str, "User ID."] = "default_user",
    ) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        title = f"Searching contacts for '{query}'"
        await broadcast_task_update(self.room, task_id, title, "search_contacts", "running")

        try:
            result = await call_backend_tool(
                "search_contacts",
                {"query": query},
                user_id=user_id,
                idempotency_key=None,
            )
            await broadcast_task_update(
                self.room, task_id, title, "search_contacts", "completed", output=result
            )
            return json.dumps(result)
        except Exception as exc:
            logger.error("search_contacts error: %s", exc)
            await broadcast_task_update(
                self.room, task_id, title, "search_contacts", "failed", error=str(exc)
            )
            return json.dumps({"error": str(exc), "status": "failed"})

    # --- Tool 7: add_contact (State-Modifying) ---
    @llm.function_tool(
        description="Add a new contact to the address book. Generates client idempotency key."
    )
    async def add_contact(
        self,
        name: Annotated[str, "Full name of the contact."],
        email: Annotated[Optional[str], "Email address."] = None,
        phone: Annotated[Optional[str], "Phone number in standard E.164 or readable format."] = None,
        user_id: Annotated[str, "User ID."] = "default_user",
    ) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        title = f"Adding contact: {name}"
        await broadcast_task_update(self.room, task_id, title, "add_contact", "running")

        try:
            idempotency_key = f"contact_{uuid.uuid4()}"
            result = await call_backend_tool(
                "add_contact",
                {"name": name, "email": email, "phone": phone},
                user_id=user_id,
                idempotency_key=idempotency_key,
            )
            await broadcast_task_update(
                self.room, task_id, title, "add_contact", "completed", output=result
            )
            return json.dumps(result)
        except Exception as exc:
            logger.error("add_contact error: %s", exc)
            await broadcast_task_update(
                self.room, task_id, title, "add_contact", "failed", error=str(exc)
            )
            return json.dumps({"error": str(exc), "status": "failed"})


# ------------------------------------------------------------------------------
# LiveKit Worker Entrypoint
# ------------------------------------------------------------------------------
async def entrypoint(ctx: JobContext) -> None:
    """Main worker entrypoint executed when a new participant joins a room."""
    logger.info("Connecting to room: %s", ctx.room.name)
    await ctx.connect()

    # 1. Initialize Gemini Realtime Live Multimodal Model
    model = realtime.RealtimeModel(
        model=GEMINI_MODEL,
        voice=GEMINI_VOICE,
        api_key=GOOGLE_API_KEY,
    )

    # 2. Instantiate Agent & Session
    agent = VoiceBotAgent(room=ctx.room, instructions=SYSTEM_INSTRUCTION)
    session = AgentSession(llm=model)

    # 3. Handle client-side interruption cancellation signals
    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        try:
            msg = json.loads(data_packet.data.decode("utf-8"))
            if msg.get("type") == "response.cancel":
                logger.info("Received client-side interruption cancel signal. Halting playback.")
                session.interrupt()
        except Exception as exc:
            logger.warning("Error processing incoming DataPacket: %s", exc)

    # 4. Handle transcription synchronization via DataChannel
    @session.on("conversation_item_added")
    def on_conversation_item_added(event: ConversationItemAddedEvent):
        try:
            if isinstance(event.item, ChatMessage) and event.item.text_content:
                role = "assistant" if event.item.role == "assistant" else "user"
                asyncio.create_task(
                    broadcast_transcript(ctx.room, role, event.item.text_content, is_final=True)
                )
        except Exception as exc:
            logger.warning("Error in conversation_item_added listener: %s", exc)

    @session.on("user_input_transcribed")
    def on_user_input(event: UserInputTranscribedEvent):
        try:
            if event.transcript:
                asyncio.create_task(
                    broadcast_transcript(ctx.room, "user", event.transcript, is_final=event.is_final)
                )
        except Exception as exc:
            logger.warning("Error in user_input_transcribed listener: %s", exc)

    logger.info("Starting AgentSession for room: %s", ctx.room.name)
    await session.start(agent, room=ctx.room)
    logger.info("Agent successfully connected and active in room: %s", ctx.room.name)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            api_key=LIVEKIT_API_KEY,
            api_secret=LIVEKIT_API_SECRET,
            ws_url=LIVEKIT_URL,
        )
    )
