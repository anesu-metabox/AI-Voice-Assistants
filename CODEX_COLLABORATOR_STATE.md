# CODEX_COLLABORATOR_STATE.md — Continuous Collaboration Ledger for Codex

> **Intended Recipient:** Codex (Personal Engineering Collaborator)  
> **Authoring Lead:** Antigravity & Anesu Mupesa (Lead Architect)  
> **Last Synchronized:** 2026-09-17  
> **Current Cycle:** Sprint 1 — System Core & Pipeline Design  

---

## 1. Executive State Snapshot

* **Current Stage:** Phase 1 (Credentials & Environment) & Phase 2 (Full-Stack Skeleton Architecture) — **SCAFFOLDED & PUSHED TO GITHUB**.
* **GitHub Repository:** [`https://github.com/anesu-metabox/AI-Voice-Assistants.git`](https://github.com/anesu-metabox/AI-Voice-Assistants.git) (Tracking: `origin/main`).
* **Active Working Branch:** `main` (clean working tree; `.gitignore` actively protecting `.env` secrets).
* **System Status:** Complete directory tree and typed skeletons established across `db/`, `backend/`, `agent/`, and `frontend/`.
* **Baseline Engine:** Google Gemini Live via LiveKit Agents (`livekit-plugins-google`) (ADR-008). Deepgram + Cartesia retained as production fallback (ADR-007).
* **Local Tooling State:** Node.js v22.23.2 and npm 10.9.8 active; Python 3.12 installation / PATH configuration pending.

---

## 2. Completed Files & Architectural Purpose

| File Path | Component | Architectural Purpose & Exported Entities |
| :--- | :--- | :--- |
| [`.gitignore`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/.gitignore) | Repository Hygiene | Excludes `.env`, node_modules, `.next`, Python cache, and virtual environments from GitHub. |
| [`.env`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/.env) | Root Config | Pre-formatted environment config with keys for LiveKit, Gemini, Neon Postgres, and Google OAuth. |
| [`AGENT_GOAL.md`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/AGENT_GOAL.md) | Orchestrator | Antigravity operational directives, laws of grounded confirmation, and milestone rubric. |
| [`CODEX_COLLABORATOR_STATE.md`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/CODEX_COLLABORATOR_STATE.md) | Collaboration | This live ledger tracking state, completed tasks, and next steps for Codex. |
| [`db/migrations/001_initial_schema.sql`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/db/migrations/001_initial_schema.sql) | Database | DDL for `tasks`, `idempotency_records`, and `user_preferences` with auto-update trigger. |
| [`db/connection.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/db/connection.py) | Database | `get_db_pool()`, `close_db_pool()` managing asyncpg pool with statement cache disabled for Neon. |
| [`db/idempotency.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/db/idempotency.py) | Database | `acquire_idempotency_lock()`, `commit_idempotency_lock()`, `release_idempotency_lock()` with in-memory fallback. |
| [`backend/requirements.txt`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/requirements.txt) | Backend | FastAPI, Uvicorn, Pydantic, Httpx, Asyncpg dependencies. |
| [`backend/app/config.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/config.py) | Backend | Pydantic `Settings` loading environment variables. |
| [`backend/app/schemas/tools.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/schemas/tools.py) | Backend | `ToolExecutionRequest`, `ToolExecutionResponse`, `TaskStatusResponse`, `TaskCancelResponse`. |
| [`backend/app/tools/calendar.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/tools/calendar.py) | Backend | `get_calendar_availability()`, `book_event()` with simulated latency (~140ms) & realistic mocks. |
| [`backend/app/tools/contacts.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/tools/contacts.py) | Backend | `search_contacts()` with simulated latency (~110ms) & realistic mock directory. |
| [`backend/app/api/tools.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/api/tools.py) | Backend | `POST /tools/execute` tool dispatcher wrapping registry and idempotency engine. |
| [`backend/app/api/tasks.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/api/tasks.py) | Backend | `GET /tasks/{id}/status`, `POST /tasks/{id}/cancel` for background task lifecycle. |
| [`backend/app/main.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/main.py) | Backend | FastAPI application, CORS middleware, lifespan database priming, and `/health`. |
| [`agent/requirements.txt`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/agent/requirements.txt) | Agent Runner | `livekit-agents`, `livekit-plugins-google`, `httpx`, `python-dotenv`. |
| [`agent/config.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/agent/config.py) | Agent Runner | System prompt, model parameters, and LiveKit connection settings. |
| [`agent/agent.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/agent/agent.py) | Agent Runner | Worker entrypoint, Gemini Multimodal Live context, HTTP tool dispatch to FastAPI. |
| [`frontend/package.json`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/frontend/package.json) | Frontend | Next.js 14, LiveKit client SDK, Tailwind, Lucide icons. |
| [`frontend/public/worklets/vad-processor.js`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/frontend/public/worklets/vad-processor.js) | Frontend | AudioWorklet computing local RMS energy for sub-20ms instant muting. |
| [`frontend/src/app/api/livekit-token/route.ts`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/frontend/src/app/api/livekit-token/route.ts) | Frontend | Next.js route minting LiveKit room access tokens. |
| [`frontend/src/components/audio/AudioVisualizer.tsx`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/frontend/src/components/audio/AudioVisualizer.tsx) | Frontend | Canvas 60fps waveform ring with listening, speaking, thinking states. |
| [`frontend/src/components/audio/AudioControls.tsx`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/frontend/src/components/audio/AudioControls.tsx) | Frontend | Mic mute/unmute, Hands-free / PTT mode toggle, disconnect button, latency badge. |
| [`frontend/src/components/transcript/TranscriptDeck.tsx`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/frontend/src/components/transcript/TranscriptDeck.tsx) | Frontend | Real-time speech bubbles with `[Interrupted]` tag support. |
| [`frontend/src/components/tasks/TaskDeck.tsx`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/frontend/src/components/tasks/TaskDeck.tsx) | Frontend | Dual-speed task cards displaying execution status, latency, and idempotency keys. |
| [`frontend/src/hooks/useClientVAD.ts`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/frontend/src/hooks/useClientVAD.ts) | Frontend | Web Audio hook setting `gain.value = 0.0` in <20ms and sending cancellation signal. |
| [`frontend/src/hooks/useLiveKitSession.ts`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/frontend/src/hooks/useLiveKitSession.ts) | Frontend | Room lifecycle, Web Audio graph, and data channel messaging. |
| [`frontend/src/app/page.tsx`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/frontend/src/app/page.tsx) | Frontend | 3-column reactive executive voice assistant dashboard. |

---

## 3. Active Architectural Decisions (Quick Reference for Codex)

1. **Python Environments:** Separate virtual environments and dedicated `requirements.txt` for `agent/` and `backend/` to prevent WebRTC/gRPC version collisions.
2. **Database Migration Tooling:** Pure SQL migrations in `db/migrations/` executed via `asyncpg` for sub-5ms raw query speed (no heavy ORM overhead in the critical voice loop).
3. **Voice to Backend Dispatch:** LiveKit Agent dispatches tool execution requests to FastAPI via async HTTP (`POST /tools/execute`), strictly decoupling voice audio transport from business logic.
4. **Interruption Protocol (ADR-005):** Next.js client uses an `AudioWorklet` (`vad-processor.js`) to locally mute speaker audio in under 20ms upon user voice energy detection, simultaneously emitting `response.cancel` to the server.
5. **Tool Mock Fallbacks:** Backend tool implementations (`calendar.py`, `contacts.py`) include realistic mock data fallbacks with simulated latency (~150ms) so end-to-end voice testing works before external OAuth keys are connected.

---

## 4. Immediate Next Steps for Codex

When picking up work or pairing on this codebase, prioritize in this order:

1. **Populate Credentials:**
   * Review [`.env`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/.env) with Anesu and insert `GOOGLE_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `DATABASE_URL`.
2. **Database Migration (`db/`) [Assigned to Anesu - ANE-02]:**
   * Run `db/migrations/001_initial_schema.sql` against the Neon PostgreSQL database.
   * Verify table creation: `tasks`, `idempotency_records`, `user_preferences`.
3. **Backend Service Test (`backend/`) [Assigned to Collaborator 1 - COL1-01]:**
   * Ensure Python 3.12 is installed; run `pip install -r backend/requirements.txt`.
   * Start FastAPI dev server: `uvicorn backend.app.main:app --reload --port 8000`.
   * Send test POST to `http://localhost:8000/tools/execute` with `{"tool_name": "get_calendar_availability", "parameters": {}}`.
4. **Frontend Installation & Run (`frontend/`) [Assigned to Collaborator 2 - COL2-03]:**
   * In `frontend/`, run `npm install`.
   * Start Next.js dev server: `npm run dev` and open `http://localhost:3000`.
