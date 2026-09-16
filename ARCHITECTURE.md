# Technical Documentation & Architecture Blueprint

> **Document Version:** 3.0.0  
> **Status:** Approved Baseline Architecture  
> **Target Audience:** Engineering Team & Executive Management

---

## 1. System Architecture Overview

The **AI VOICE BOT** is built as a real-time conversational agent capable of executing business actions with low latency (<450ms speech-to-speech turnaround). 

Following the architectural evaluation in **ADR-008**, the core voice engine utilizes **Google Gemini Live (Gemini 2.0 Flash) integrated via LiveKit Agents**:
- **Media Transport & WebRTC Infrastructure:** LiveKit Agents (Python asyncio framework)
- **Core Voice & Intelligence Engine:** Google Gemini 2.0 Flash Multimodal Live API (`livekit-plugins-google`)
- **Tool Execution & Security Middleware:** FastAPI backend service with typed schema validation
- **Persistence & Task Ledger:** PostgreSQL database with idempotency locks
- **Production Fallback Engine:** Modular LiveKit Stack (Deepgram Nova-2 + Cartesia Sonic)

```
+---------------------------------------------------------------------------------------+
|                                     CLIENT LAYER                                      |
|   Web / Mobile Application (Next.js / React Native + WebRTC / AudioWorklet)          |
|   - Real-time microphone capture (PCM16 24kHz / Opus)                                |
|   - Live Waveform Visualizer & Transcript Stream                                      |
|   - Local Voice Activity Detection (VAD) & Instant Playback Mute                      |
+---------------------------------------------------------------------------------------+
                                        ▲ │
                        Audio Streams   │ │   Microphone Packets
                         (<120ms lag)   │ ▼   (WebRTC Stream)
+---------------------------------------------------------------------------------------+
|                                 LIVEKIT AGENTS RUNNER                                 |
|   Core Media & Orchestration Server (Python 3.12 / LiveKit SDK)                       |
|   - WebRTC session handling, room management, and telephony SIP support              |
|   - Streaming bi-directional audio bridge to Google Gemini Multimodal Live API        |
|   - Dispatches tool invocation events directly to FastAPI backend                     |
+---------------------------------------------------------------------------------------+
                                        ▲ │
                           Tool Call    │ │   Tool Result
                            Payload     │ ▼   (JSON Confirmation)
+---------------------------------------------------------------------------------------+
|                                AGENT BACKEND & RUNTIME                                |
|   FastAPI Service (Python 3.12 / AsyncIO)                                             |
|   - Tool Dispatcher & JSONSchema Argument Validator                                   |
|   - Security & Permission Enforcer (User Authorization & Confirmations)              |
|   - Idempotency & Concurrency Manager                                                 |
+---------------------------------------------------------------------------------------+
                     │                                         │
        Fast Path    │ (<500ms)                   Long Task    │ (>2s)
        Direct Execution                          Async Job    ▼
                     ▼                                 +--------------------------------+
+------------------------------------+                 |       BACKGROUND WORKER        |
|          DIRECT API TOOLS          |                 |  Trigger.dev / Python Asyncio  |
|  - Google Calendar (Get/Create)    |                 |  - Multi-source research       |
|  - CRM & Contact Lookup            |                 |  - Report generation           |
|  - Weather, Timezone, Calculations |                 |  - Scheduled sync & batch jobs |
+------------------------------------+                 +--------------------------------+
                     │                                         │
                     └────────────────────┬────────────────────┘
                                          ▼
+---------------------------------------------------------------------------------------+
|                                PERSISTENCE & DATA LAYER                               |
|   PostgreSQL Database (Neon Serverless Postgres / Supabase)                           |
|   - `tasks` & `task_executions`: Durable state, progress logs, and outcomes          |
|   - `idempotency_keys`: Locks and tokens preventing duplicate external writes         |
|   - `user_preferences` & `memory`: Confirmed user preferences and working hours          |
+---------------------------------------------------------------------------------------+
```

---

## 2. Strategic Rationale: Why Gemini Live on LiveKit?

For upper project management reference, the decision to baseline on **LiveKit + Gemini Live** (ADR-008) provides three decisive business advantages:

1. **Lowest Setup Complexity & Faster Delivery:**  
   Requires only **1 vendor account and 1 API key** (`GOOGLE_API_KEY`) and under 25 lines of Python agent runner code. It avoids the friction of coordinating three billing accounts and tuning external VAD models.
2. **85% Cost Reduction vs. OpenAI Realtime:**  
   OpenAI Realtime costs ~$12.00/hour. Gemini Live costs ~$1.50/hour, matching the cost efficiency of modular pipelines while delivering native speech-to-speech audio understanding.
3. **Native Speech-to-Speech Nuance:**  
   Gemini Live hears vocal inflections, hesitations, and emotions directly from audio waveforms, creating a far more natural experience than chained STT-to-text models.
4. **Zero Vendor Trap (LiveKit Modularity):**  
   Because LiveKit abstracts the media transport layer, our tools and frontend do not care what model sits behind the curtain. If corporate policy demands custom voice cloning later, we can pivot to the documented Deepgram + Cartesia fallback without modifying the core system.

---

## 3. Core Architectural Pillars

### 3.1 Dual-Speed Execution Strategy
1. **The Fast Lane (Direct Backend API Calls):**
   - For read operations and fast atomic writes (<500ms), e.g., `search_contacts`, `get_calendar_availability`, `book_event`.
   - Executed synchronously by the FastAPI service in the loop. The voice bot waits briefly with low latency and provides a direct spoken answer.
2. **The Persistent Background Lane (Detached Job Queue):**
   - For multi-step tasks (>2s), e.g., `"Analyze last month's client transcripts and prepare a briefing"`.
   - The agent creates a task record in PostgreSQL, generates a `task_id`, immediately tells the user: *"I've started preparing that briefing. I'll update your dashboard when it's done,"* and hands off execution to the background worker.
   - The voice connection is never what keeps the background task alive.

### 3.2 Strict Grounded Confirmation Rule
The voice bot **must never say** *"I have scheduled your meeting"* based solely on its own generation.
- Spoken confirmations are strictly conditioned on the tool returning a verified `200 OK` and a valid payload (e.g. `event_id: "evt_1234"`).
- If the tool fails or times out, the bot explicitly reports: *"I couldn't reach your calendar right now. The meeting was not booked."*

### 3.3 Instant Interruption & Cancellation Protocol
- When the client's local VAD detects user speech while the bot is outputting audio:
  1. Client immediately mutes the speaker / playback buffer locally (<20ms).
  2. Client sends a `response.cancel` message to the voice server.
  3. The server halts audio generation and discards pending audio packets.
  4. Truncated context is preserved so the agent knows what the user actually heard before speaking.

---

## 4. Database Schema (PostgreSQL DDL)

```sql
-- Core task persistence table
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    session_id VARCHAR(128),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    tool_name VARCHAR(64),
    input_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_result JSONB,
    error_message TEXT,
    idempotency_key VARCHAR(128) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency locks to prevent duplicate external actions
CREATE TABLE idempotency_records (
    key VARCHAR(128) PRIMARY KEY,
    user_id UUID NOT NULL,
    tool_name VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('acquired', 'committed', 'refunded')),
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- User preferences and long-term memory
CREATE TABLE user_preferences (
    user_id UUID PRIMARY KEY,
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    working_hours JSONB NOT NULL DEFAULT '{"start": "09:00", "end": "17:00"}'::jsonb,
    default_meeting_duration_minutes INT NOT NULL DEFAULT 30,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
