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
import ssl
import time
from typing import Annotated, Any, Dict, List, Optional
import uuid

import certifi
import httpx
import numpy.fft
from google.genai import types as genai_types
from livekit import agents, rtc
from livekit.agents import JobContext, JobProcess, WorkerOptions, cli, llm
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
        GEMINI_API_VERSION,
        GEMINI_MODEL,
        GEMINI_VOICE,
        GOOGLE_API_KEY,
        LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET,
        LIVEKIT_URL,
        SYSTEM_INSTRUCTION,
    )
    from .assistant_policy import is_allowed_calendar_tool
except ImportError:
    from config import (
        BACKEND_URL,
        GEMINI_API_VERSION,
        GEMINI_MODEL,
        GEMINI_VOICE,
        GOOGLE_API_KEY,
        LIVEKIT_API_KEY,
        LIVEKIT_API_SECRET,
        LIVEKIT_URL,
        SYSTEM_INSTRUCTION,
    )
    from assistant_policy import is_allowed_calendar_tool

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
DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001"


# ------------------------------------------------------------------------------
# Backend Dispatcher
# ------------------------------------------------------------------------------
async def call_backend_tool(
    tool_name: str,
    params: Dict[str, Any],
    user_id: str = DEFAULT_USER_ID,
    idempotency_key: Optional[str] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> Dict[str, Any]:
    """Dispatch a tool request, reusing the agent's pooled HTTP client when available."""
    if not is_allowed_calendar_tool(tool_name):
        raise PermissionError(f"Tool '{tool_name}' is not enabled for the calendar-only assistant.")
    url = f"{BACKEND_URL.rstrip('/')}/tools/execute"
    payload = {
        "tool_name": tool_name,
        "parameters": params,
        "user_id": user_id,
    }
    if idempotency_key:
        payload["idempotency_key"] = idempotency_key

    if client is None:
        async with httpx.AsyncClient(timeout=15.0) as transient_client:
            response = await transient_client.post(url, json=payload)
    else:
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

    def __init__(
        self,
        room: rtc.Room,
        instructions: str,
        ssl_context: Optional[ssl.SSLContext] = None,
    ):
        super().__init__(instructions=instructions)
        self.room = room
        self._idempotency_keys: Dict[str, str] = {}
        self._backend_client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=5.0),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            verify=ssl_context if ssl_context is not None else True,
            trust_env=False,
        )

    def _stable_write_key(self, tool_name: str, params: Dict[str, Any]) -> str:
        logical_action = f"{tool_name}:{json.dumps(params, sort_keys=True, separators=(',', ':'))}"
        if logical_action not in self._idempotency_keys:
            self._idempotency_keys[logical_action] = str(uuid.uuid4())
        return self._idempotency_keys[logical_action]

    # --- Tool 1: get_calendar_availability (Read-Only) ---
    @llm.function_tool(
        description="Query calendar availability for free slots on a given date or range in YYYY-MM-DD format."
    )
    async def get_calendar_availability(
        self,
        start_date: Annotated[Optional[str], "Start date in YYYY-MM-DD format (defaults to today)."] = None,
        end_date: Annotated[Optional[str], "End date in YYYY-MM-DD format (defaults to start_date)."] = None,
        duration_minutes: Annotated[int, "Minimum slot duration in minutes (default 30)."] = 30,
        user_id: Annotated[str, "User UUID."] = DEFAULT_USER_ID,
    ) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        title = f"Checking availability for {start_date or 'today'}"
        await broadcast_task_update(self.room, task_id, title, "get_calendar_availability", "running")

        try:
            params: Dict[str, Any] = {"duration_minutes": duration_minutes}
            if start_date:
                params["start_date"] = start_date
            if end_date:
                params["end_date"] = end_date

            result = await call_backend_tool(
                "get_calendar_availability",
                params,
                user_id=user_id,
                idempotency_key=None,
                client=self._backend_client,
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
        description="List confirmed scheduled calendar events for a date or date range in YYYY-MM-DD format."
    )
    async def list_events(
        self,
        start_date: Annotated[Optional[str], "Start date in YYYY-MM-DD format (defaults to today)."] = None,
        end_date: Annotated[Optional[str], "End date in YYYY-MM-DD format (defaults to start_date)."] = None,
        user_id: Annotated[str, "User UUID."] = DEFAULT_USER_ID,
    ) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        title = f"Listing events for {start_date or 'today'}"
        await broadcast_task_update(self.room, task_id, title, "list_events", "running")

        try:
            params: Dict[str, Any] = {}
            if start_date:
                params["start_date"] = start_date
            if end_date:
                params["end_date"] = end_date

            result = await call_backend_tool(
                "list_events",
                params,
                user_id=user_id,
                idempotency_key=None,
                client=self._backend_client,
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

    # --- Tool 3: book_event (State-Modifying) ---
    @llm.function_tool(
        description="Book a new calendar event with automatic Google Meet video conferencing link. State-modifying action."
    )
    async def book_event(
        self,
        title: Annotated[str, "Title or summary of the meeting/event."],
        start_time: Annotated[str, "Start time in ISO 8601 format (e.g. 2026-09-20T14:00:00Z)."],
        duration_minutes: Annotated[int, "Meeting duration in minutes (default 30)."] = 30,
        attendees: Annotated[Optional[List[str]], "List of attendee email addresses or names."] = None,
        description: Annotated[Optional[str], "Meeting notes or description."] = None,
        location: Annotated[Optional[str], "Meeting location (default 'Google Meet')."] = "Google Meet",
        user_id: Annotated[str, "User UUID."] = DEFAULT_USER_ID,
    ) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        action_title = f"Booking: {title}"
        await broadcast_task_update(self.room, task_id, action_title, "book_event", "running")

        try:
            params = {
                "title": title,
                "start_time": start_time,
                "duration_minutes": duration_minutes,
                "attendees": attendees or [],
                "location": location or "Google Meet",
            }
            if description:
                params["description"] = description

            idempotency_key = self._stable_write_key("book_event", params)
            result = await call_backend_tool(
                "book_event",
                params,
                user_id=user_id,
                idempotency_key=idempotency_key,
                client=self._backend_client,
            )
            await broadcast_task_update(
                self.room, task_id, action_title, "book_event", "completed", output=result
            )
            return json.dumps(result)
        except Exception as exc:
            logger.error("book_event error: %s", exc)
            await broadcast_task_update(
                self.room, task_id, action_title, "book_event", "failed", error=str(exc)
            )
            return json.dumps({"error": str(exc), "status": "failed"})

    # --- Tool 4: cancel_event (State-Modifying) ---
    @llm.function_tool(
        description="Cancel a scheduled calendar event by event UUID. Irreversible action requiring user confirmation."
    )
    async def cancel_event(
        self,
        event_id: Annotated[str, "UUID of the calendar event to cancel."],
        reason: Annotated[Optional[str], "Optional reason for cancellation."] = None,
        confirm: Annotated[bool, "Set to true if user explicitly confirmed cancellation."] = False,
        confirmation_token: Annotated[Optional[str], "Exact token returned by a prior confirmation_required response."] = None,
        user_id: Annotated[str, "User UUID."] = DEFAULT_USER_ID,
    ) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        title = f"Cancelling event {event_id}"
        await broadcast_task_update(self.room, task_id, title, "cancel_event", "running")

        try:
            params: Dict[str, Any] = {"event_id": event_id, "confirm": confirm}
            if reason:
                params["reason"] = reason
            if confirmation_token:
                params["confirmation_token"] = confirmation_token

            idempotency_key = self._stable_write_key("cancel_event", params)
            result = await call_backend_tool(
                "cancel_event",
                params,
                user_id=user_id,
                idempotency_key=idempotency_key,
                client=self._backend_client,
            )
            await broadcast_task_update(
                self.room, task_id, title, "cancel_event", "completed", output=result
            )
            return json.dumps(result)
        except Exception as exc:
            logger.error("cancel_event error: %s", exc)
            await broadcast_task_update(
                self.room, task_id, title, "cancel_event", "failed", error=str(exc)
            )
            return json.dumps({"error": str(exc), "status": "failed"})

    # --- Tool 5: search_contacts (Read-Only) ---
    async def search_contacts(
        self,
        query: Annotated[str, "Name or keyword to search for in contacts."],
        user_id: Annotated[str, "User UUID."] = DEFAULT_USER_ID,
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
                client=self._backend_client,
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

    # --- Tool 6: draft_email (State-Modifying) ---
    async def draft_email(
        self,
        recipient: Annotated[str, "Email address of the recipient."],
        subject: Annotated[str, "Subject line of the email."],
        body: Annotated[str, "Body text of the email."],
        user_id: Annotated[str, "User UUID."] = DEFAULT_USER_ID,
    ) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        title = f"Drafting email: {subject}"
        await broadcast_task_update(self.room, task_id, title, "draft_email", "running")

        try:
            idempotency_key = f"email_{uuid.uuid4()}"
            result = await call_backend_tool(
                "draft_email",
                {"recipient": recipient, "subject": subject, "body": body},
                user_id=user_id,
                idempotency_key=idempotency_key,
                client=self._backend_client,
            )
            await broadcast_task_update(
                self.room, task_id, title, "draft_email", "completed", output=result
            )
            return json.dumps(result)
        except Exception as exc:
            logger.error("draft_email error: %s", exc)
            await broadcast_task_update(
                self.room, task_id, title, "draft_email", "failed", error=str(exc)
            )
            return json.dumps({"error": str(exc), "status": "failed"})

    # --- Tool 7: create_durable_task (State-Modifying) ---
    async def create_durable_task(
        self,
        title: Annotated[str, "Title or summary of the task."],
        tool_name: Annotated[Optional[str], "Target tool name."] = None,
        input_parameters: Annotated[Optional[Dict[str, Any]], "Task parameters."] = None,
        user_id: Annotated[str, "User UUID."] = DEFAULT_USER_ID,
    ) -> str:
        task_id = f"task_{uuid.uuid4().hex[:8]}"
        action_title = f"Task: {title}"
        await broadcast_task_update(self.room, task_id, action_title, "create_durable_task", "running")

        try:
            idempotency_key = f"task_{uuid.uuid4()}"
            result = await call_backend_tool(
                "create_durable_task",
                {"title": title, "tool_name": tool_name or "generic_task", "input_parameters": input_parameters or {}},
                user_id=user_id,
                idempotency_key=idempotency_key,
                client=self._backend_client,
            )
            await broadcast_task_update(
                self.room, task_id, action_title, "create_durable_task", "completed", output=result
            )
            return json.dumps(result)
        except Exception as exc:
            logger.error("create_durable_task error: %s", exc)
            await broadcast_task_update(
                self.room, task_id, action_title, "create_durable_task", "failed", error=str(exc)
            )
            return json.dumps({"error": str(exc), "status": "failed"})


# ------------------------------------------------------------------------------
# Worker Prewarm Routine (R3)
# ------------------------------------------------------------------------------
def prewarm(proc: JobProcess) -> None:
    """Prewarm CPU, TLS, and schema resources before a participant joins.

    This keeps FFT initialization, certificate parsing, and Pydantic plugin loading off
    the real-time audio loop. The TLS context is reused by the Gemini client.
    """
    logger.info("Prewarming audio, TLS, and schema dependencies...")
    import numpy as np
    import numpy.fft
    from pydantic import TypeAdapter

    # Force FFT initialization, windowing functions, and CPU dispatch tables
    _window = np.hanning(256)
    _ = np.fft.rfft([0.0] * 256)

    ca_file = os.environ.get("SSL_CERT_FILE") or certifi.where()
    proc.userdata["gemini_ssl_context"] = ssl.create_default_context(
        cafile=ca_file,
        capath=os.environ.get("SSL_CERT_DIR"),
    )

    # Pydantic loads installed schema plugins on its first JSON-schema build.
    TypeAdapter(dict[str, Any]).json_schema()
    proc.userdata["prewarmed"] = True
    logger.info("Audio, TLS, and schema dependencies prewarmed successfully.")


# ------------------------------------------------------------------------------
# DataChannel Message Handlers
# ------------------------------------------------------------------------------
def handle_incoming_data_packet(data_packet: rtc.DataPacket, session: AgentSession) -> bool:
    """Processes incoming WebRTC DataPacket messages.

    If a client-side interruption cancel signal ({'type': 'response.cancel'}) is received,
    immediately interrupts active and queued speech generation on the AgentSession with force=True.
    Returns True if an interruption was triggered, False otherwise.
    """
    try:
        data = getattr(data_packet, "data", b"")
        if isinstance(data, (bytes, bytearray)):
            text = data.decode("utf-8")
        elif isinstance(data, str):
            text = data
        else:
            return False

        msg = json.loads(text)
        if isinstance(msg, dict) and msg.get("type") == "response.cancel":
            logger.info("Received client-side interruption cancel signal. Halting playback.")
            try:
                session.interrupt(force=True)
            except Exception as int_err:
                logger.debug("Interrupt skipped or session idle: %s", int_err)
            return True
    except Exception as exc:
        logger.warning("Error processing incoming DataPacket: %s", exc)
    return False


# ------------------------------------------------------------------------------
# LiveKit Worker Entrypoint
# ------------------------------------------------------------------------------
async def entrypoint(ctx: JobContext) -> None:
    """Main worker entrypoint executed when a new participant joins a room."""
    # Ensure numpy.fft is preloaded in entrypoint context as well
    import numpy.fft

    logger.info("Connecting to room: %s", ctx.room.name)
    await ctx.connect()

    # 1. Initialize Gemini Realtime Live Multimodal Model
    ssl_context = ctx.proc.userdata.get("gemini_ssl_context")
    http_options = None
    if isinstance(ssl_context, ssl.SSLContext):
        http_options = genai_types.HttpOptions(
            client_args={"verify": ssl_context},
            async_client_args={"verify": ssl_context, "ssl": ssl_context},
        )

    # Fetch dynamic assistant & company profile configuration from backend
    active_instructions = SYSTEM_INSTRUCTION
    active_voice = GEMINI_VOICE
    try:
        async with httpx.AsyncClient(timeout=2.0) as http_client:
            asst_resp = await http_client.get(f"{BACKEND_URL}/api/assistant-config")
            if asst_resp.status_code == 200:
                asst_data = asst_resp.json().get("data", {})
                user_prompt = asst_data.get("system_prompt")
                if user_prompt:
                    active_instructions = f"{user_prompt}\n\nOperational Grounding Policy:\n{SYSTEM_INSTRUCTION}"
                if asst_data.get("voice_engine"):
                    active_voice = asst_data.get("voice_engine")

            comp_resp = await http_client.get(f"{BACKEND_URL}/api/company-profile")
            if comp_resp.status_code == 200:
                comp_data = comp_resp.json().get("data", {})
                c_name = comp_data.get("company_name", "Acme Operations")
                c_phone = comp_data.get("company_phone", "")
                c_email = comp_data.get("support_email", "")
                c_tz = comp_data.get("timezone", "")
                active_instructions = (
                    f"Company Context: You represent '{c_name}'. "
                    f"Support Email: '{c_email}', Phone: '{c_phone}', Default Timezone: '{c_tz}'.\n"
                    f"{active_instructions}"
                )
    except Exception as fetch_err:
        logger.debug("Using baseline prompt; dynamic settings fetch skipped: %s", fetch_err)

    model = realtime.RealtimeModel(
        model=GEMINI_MODEL,
        voice=active_voice,
        api_key=GOOGLE_API_KEY,
        api_version=GEMINI_API_VERSION,
        http_options=http_options,
    )

    # 2. Instantiate Agent & Session
    agent = VoiceBotAgent(
        room=ctx.room,
        instructions=active_instructions,
        ssl_context=ssl_context if isinstance(ssl_context, ssl.SSLContext) else None,
    )
    session = AgentSession(llm=model)

    # 3. Handle client-side interruption cancellation signals
    @ctx.room.on("data_received")
    def on_data_received(data_packet: rtc.DataPacket):
        handle_incoming_data_packet(data_packet, session)

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


def build_worker_options() -> WorkerOptions:
    """Return the production-equivalent worker settings used by local development."""
    return WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=prewarm,
        api_key=LIVEKIT_API_KEY,
        api_secret=LIVEKIT_API_SECRET,
        ws_url=LIVEKIT_URL,
        num_idle_processes=1,
        port=8081,
    )


if __name__ == "__main__":
    cli.run_app(build_worker_options())
