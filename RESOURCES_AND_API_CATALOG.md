# Resources, API Catalog & Environment Setup

> **Target:** Developer reference, official SDK links, and tool function schemas for the **AI VOICE BOT** project.

---

## Official Documentation & References

| Technology | Documentation Link | Usage in Project |
| :--- | :--- | :--- |
| **LiveKit Agents** | [LiveKit Agents Docs](https://docs.livekit.io/agents/) | Core WebRTC media server, room session management, agent pipeline orchestration |
| **Google Gemini Multimodal Live API** | [Gemini Live API Guide](https://ai.google.dev/gemini-api/docs/live-api) | Primary voice engine (Gemini 2.0 Flash) providing native speech-to-speech and vision |
| **LiveKit Google Plugin** | [LiveKit Google Plugin Docs](https://docs.livekit.io/agents/plugins/google/) | Official WebRTC bridge for Gemini Live in Python (`livekit-plugins-google`) |
| **Deepgram Nova-2 STT** | [Deepgram Streaming Docs](https://developers.deepgram.com/docs/getting-started-with-streaming-audio) | Production fallback speech-to-text engine with keyword boosting support |
| **Cartesia Sonic TTS** | [Cartesia Sonic Docs](https://docs.cartesia.ai/) | Production fallback text-to-speech engine with ultra-low latency & voice cloning |
| **FastAPI** | [FastAPI Documentation](https://fastapi.tiangolo.com/) | Backend tool execution server, permission enforcement, and webhooks |
| **Trigger.dev** | [Trigger.dev Docs](https://trigger.dev/docs/introduction) | Reliable background tasks, retries, and long-running job progress |
| **Neon PostgreSQL** | [Neon Postgres Docs](https://neon.tech/docs) | Serverless relational database for persistent task state & idempotency |

---

## Core Assistant Tool Schemas (JSONSchema)

The voice model selects from these tool definitions when interacting with the user:

### 1. `get_calendar_availability`
```json
{
  "name": "get_calendar_availability",
  "description": "Check available calendar time slots for the user and attendees across a given date range.",
  "parameters": {
    "type": "object",
    "properties": {
      "start_date": { "type": "string", "description": "ISO 8601 date string, e.g. '2026-09-15'" },
      "end_date": { "type": "string", "description": "ISO 8601 date string, e.g. '2026-09-20'" },
      "duration_minutes": { "type": "integer", "default": 30 },
      "attendee_emails": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["start_date", "end_date"]
  }
}
```

### 2. `create_calendar_event`
```json
{
  "name": "create_calendar_event",
  "description": "Book a new meeting on Google/Outlook calendar once approved by the user.",
  "parameters": {
    "type": "object",
    "properties": {
      "title": { "type": "string", "description": "Meeting subject/title" },
      "start_time": { "type": "string", "description": "ISO 8601 datetime with timezone offset" },
      "duration_minutes": { "type": "integer", "default": 30 },
      "attendees": { "type": "array", "items": { "type": "string" } },
      "idempotency_key": { "type": "string", "description": "Client-generated UUID to prevent duplicate bookings" }
    },
    "required": ["title", "start_time", "idempotency_key"]
  }
}
```

### 3. `create_background_task`
```json
{
  "name": "create_background_task",
  "description": "Enqueue a multi-step or long-running task to be processed asynchronously by background workers.",
  "parameters": {
    "type": "object",
    "properties": {
      "task_type": { "type": "string", "enum": ["research_briefing", "crm_bulk_sync", "document_summary"] },
      "parameters": { "type": "object", "description": "Task input data" }
    },
    "required": ["task_type", "parameters"]
  }
}
```

### 4. `get_task_status`
```json
{
  "name": "get_task_status",
  "description": "Poll the current progress and results of a previously scheduled background task.",
  "parameters": {
    "type": "object",
    "properties": {
      "task_id": { "type": "string", "description": "UUID of the task" }
    },
    "required": ["task_id"]
  }
}
```

---

## Environment Variables Checklist

Ensure every developer copies `.env.example` to `.env` in `backend/` and `frontend/`:
- `LIVEKIT_URL`: WebSocket URL from LiveKit Cloud dashboard.
- `LIVEKIT_API_KEY`: API key for room tokens and agent worker connection.
- `LIVEKIT_API_SECRET`: Secret key for LiveKit authentication.
- `GOOGLE_API_KEY`: API key from Google AI Studio / Vertex AI with Gemini Live access enabled.
- `DEEPGRAM_API_KEY`: API key for Deepgram Nova-2 (production fallback STT).
- `CARTESIA_API_KEY`: API key for Cartesia Sonic (production fallback TTS).
- `DATABASE_URL`: PostgreSQL connection string with SSL enabled.
- `GOOGLE_OAUTH_CLIENT_ID` & `GOOGLE_OAUTH_CLIENT_SECRET`: For Google Calendar & People API integrations.
