# CODEX_COLLABORATOR_STATE.md — Continuous Collaboration Ledger for Codex

> **Intended Recipient:** Codex (Personal Engineering Collaborator)  
> **Authoring Lead:** Antigravity & Anesu Mupesa (Lead Architect)  
> **Last Synchronized:** 2026-09-18  
> **Current Cycle:** Sprint 1 — Calendar DB Persistence & Concurrency Engine Complete  

---

## 1. Executive State Snapshot

* **Current Stage:** Phase 1 (Credentials & Environment) & Phase 2 (Calendar DB Persistence & Verification) — **SCAFFOLDED, MIGRATED & VERIFIED ON NEON POSTGRESQL**.
* **GitHub Repository:** [`https://github.com/anesu-metabox/AI-Voice-Assistants.git`](https://github.com/anesu-metabox/AI-Voice-Assistants.git)
* **Active Working Branch:** `develop` (Tracking: `origin/develop`).
* **Sacred Main Trunk Protocol (ADR-009):** `main` is protected. Direct push to `main` is prohibited. Only **Anesu (`anesu-metabox`)** is authorized to push or merge into `main`. All feature branches and PRs must target `develop`.
* **Notion Strategic Journal:** [Anesu's Personal Decision Log & Non-Obvious Architecture Choices](https://app.notion.com/p/Anesu-s-Personal-Decision-Log-Non-Obvious-Architecture-Choices-3ddcf5b722df813e8c27fdea150da7fc).
* **Baseline Engine:** Google Gemini Live via LiveKit Agents (`livekit-plugins-google`) (ADR-008). Deepgram + Cartesia retained as production fallback (ADR-007).
* **Local Tooling State:** Python 3.14 verified with pytest; Node.js v22.23.2 and npm 10.9.8 active; Neon PostgreSQL `divine-hat-17233837` migrated through `002_calendar_events.sql`.

---

## 2. Completed Files & Architectural Purpose

| File Path | Component | Architectural Purpose & Exported Entities |
| :--- | :--- | :--- |
| [`.github/workflows/ci.yml`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/.github/workflows/ci.yml) | CI/CD Quality Gate | Automated GitHub Actions checking Python syntax, TypeScript typecheck, and DDL integrity on PRs. |
| [`.neon`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/.neon) | Neon Context | Linked project context (`divine-hat-17233837`) and branch (`production`). |
| [`neon.ts`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/neon.ts) | Neon Policy | Config-as-code specification deployed to Neon branch via `neon deploy`. |
| [`.gitignore`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/.gitignore) | Repository Hygiene | Excludes `.env`, node_modules, `.next`, Python cache, and virtual environments from GitHub. |
| [`.env`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/.env) | Root Config | Pre-formatted environment config with keys for LiveKit, Gemini, Neon Postgres, and Google OAuth. |
| [`AGENT_GOAL.md`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/AGENT_GOAL.md) | Orchestrator | Antigravity operational directives, laws of grounded confirmation, Sacred Main law, and milestone rubric. |
| [`CODEX_COLLABORATOR_STATE.md`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/CODEX_COLLABORATOR_STATE.md) | Collaboration | This live ledger tracking state, completed tasks, and next steps for Codex. |
| [`db/migrations/001_initial_schema.sql`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/db/migrations/001_initial_schema.sql) | Database | DDL for `tasks`, `idempotency_records`, and `user_preferences` with auto-update trigger. |
| [`db/migrations/002_calendar_events.sql`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/db/migrations/002_calendar_events.sql) | Database | DDL for `calendar_events` table with UUID PK, constraints, composite indexes, and auto-update timestamp trigger. |
| [`db/connection.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/db/connection.py) | Database | `get_db_pool()`, `close_db_pool()` managing asyncpg pool with statement cache disabled for Neon and sanitized DSN query parameters. |
| [`db/run_migrations.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/db/run_migrations.py) | Database | SQL migration runner executing numbered DDL files against Neon PostgreSQL. |
| [`db/idempotency.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/db/idempotency.py) | Database | `acquire_idempotency_lock()`, `commit_idempotency_lock()`, `release_idempotency_lock()` with in-memory fallback. |
| [`backend/requirements.txt`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/requirements.txt) | Backend | FastAPI, Uvicorn, Pydantic, Httpx, Asyncpg dependencies. |
| [`backend/app/config.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/config.py) | Backend | Pydantic `Settings` loading environment variables. |
| [`backend/app/schemas/tools.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/schemas/tools.py) | Backend | Strict Pydantic models for all Sprint 1 tools, parameter validation, `user_id` injection schemas, and ANE-03 confirmation models. |
| [`backend/app/tools/calendar.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/tools/calendar.py) | Backend | `get_calendar_availability()`, `book_event()`, and `cancel_event()` with Neon DB persistence, `pg_advisory_xact_lock` atomic locking, and dual-speed task ledger writes. |
| [`backend/app/tools/contacts.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/tools/contacts.py) | Backend | `search_contacts()` with simulated latency (~110ms) & realistic mock directory. |
| [`backend/app/tools/email.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/tools/email.py) | Backend | `draft_email()` fast atomic email drafting with simulated latency (~130ms). |
| [`backend/app/tools/tasks.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/tools/tasks.py) | Backend | `create_durable_task()` registering durable tasks in PostgreSQL for Trigger.dev queue. |
| [`backend/app/api/tools.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/api/tools.py) | Backend | `POST /tools/execute` dispatcher enforcing Pydantic parameter validation, `user_id`/session injection, slot conflict formatting, ANE-03 interceptor, & idempotency. |
| [`backend/app/api/tasks.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/api/tasks.py) | Backend | `GET /tasks/{id}/status`, `POST /tasks/{id}/cancel` for background task lifecycle. |
| [`backend/app/main.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/main.py) | Backend | FastAPI application, CORS middleware, lifespan database priming, and `/health`. |
| [`backend/tests/conftest.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/tests/conftest.py) | Backend Tests | Pytest fixtures for asyncpg connection pool, tenant-isolated test user UUIDs, and automated pre/post test cleanup. |
| [`backend/tests/test_calendar_db.py`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/tests/test_calendar_db.py) | Backend Tests | 7 E2E integration tests verifying DDL schema, atomic reservation, dynamic availability, 10-worker concurrency, idempotency replay, soft deletion, and confirmation gates. |
| [`pytest.ini`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/pytest.ini) | Test Config | Pytest runner configuration (`asyncio_mode = auto`, session loop scoping for asyncpg pool). |
| [`PROJECT.md`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/PROJECT.md) | Architecture Spec | Calendar persistence architecture, interface contracts, milestone tracking, and feature inventory. |
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
| [`frontend/src/lib/types.ts`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/frontend/src/lib/types.ts) | Frontend | Shared TypeScript interfaces for tasks, transcripts, and audio sessions. |

---

## 3. Active Architectural Decisions (Quick Reference for Codex)

1. **Sacred Main & Sole Gatekeeper Protocol (ADR-009):** `main` is sacred and protected. Direct pushes to `main` are blocked. Only Anesu (`anesu-metabox`) merges or pushes to `main`. All feature work occurs on branches off `develop`.
2. **Automated CI Quality Gate:** GitHub Actions (`.github/workflows/ci.yml`) runs on all PRs to `develop` and `main`. Status checks must be green before merging ("No Green, No Merge").
3. **Python Environments:** Separate virtual environments and dedicated `requirements.txt` for `agent/` and `backend/` to prevent WebRTC/gRPC version collisions.
4. **Database Migration Tooling:** Pure SQL migrations in `db/migrations/` executed via `asyncpg` for sub-5ms raw query speed (no heavy ORM overhead in the critical voice loop).
5. **Voice to Backend Dispatch:** LiveKit Agent dispatches tool execution requests to FastAPI via async HTTP (`POST /tools/execute`), strictly decoupling voice audio transport from business logic.
6. **Interruption Protocol (ADR-005):** Next.js client uses an `AudioWorklet` (`vad-processor.js`) to locally mute speaker audio in under 20ms upon user voice energy detection, simultaneously emitting `response.cancel` to the server.
7. **Tool Mock Fallbacks:** Backend tool implementations (`calendar.py`, `contacts.py`) include realistic mock data fallbacks with simulated latency (~150ms) so end-to-end voice testing works before external OAuth keys are connected.
8. **Anesu's Personal Decision Log:** Full strategic rationale for non-obvious choices is documented in Notion at [Anesu's Personal Decision Log & Non-Obvious Architecture Choices](https://app.notion.com/p/Anesu-s-Personal-Decision-Log-Non-Obvious-Architecture-Choices-3ddcf5b722df813e8c27fdea150da7fc).

---

## 4. Immediate Next Steps for Codex

When picking up work or pairing on this codebase, prioritize in this order:

1. **Branching Rule:** Always create a feature branch off `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feat/your-feature-name
   ```
2. **Populate Credentials:**
   * Review [`.env`](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/.env) with Anesu and insert `GOOGLE_API_KEY`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and `DATABASE_URL`.
3. **Database Migration (`db/`) [Assigned to Anesu - ANE-02 — COMPLETED & VERIFIED]:**
   * Migrations `001_initial_schema.sql` and `002_calendar_events.sql` successfully deployed to Neon project `divine-hat-17233837` on branch `production`.
   * Verified active tables: `tasks`, `idempotency_records`, `user_preferences`, and `calendar_events`.
   * End-to-end integration test suite (`backend/tests/test_calendar_db.py`) verified 100% passing (7/7 tests passed in 64s).
4. **Backend Service Test (`backend/`) [Assigned to Collaborator 1 - COL1-01]:**
   * Python 3.14 runtime verified via `py` launcher; run `py -m pip install -r backend/requirements.txt`.
   * Start FastAPI dev server: `uvicorn backend.app.main:app --reload --port 8000`.
   * Send test POST to `http://localhost:8000/tools/execute` with `{"tool_name": "get_calendar_availability", "parameters": {}}`.
5. **Frontend Installation & Run (`frontend/`) [Assigned to Collaborator 2 - COL2-03]:**
   * In `frontend/`, dependencies installed and TypeScript typecheck passing (`npx tsc --noEmit`).
   * Start Next.js dev server: `npm run dev` and open `http://localhost:3000`.
