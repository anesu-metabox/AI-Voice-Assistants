# CODEX_COLLABORATOR_STATE.md — Continuous Collaboration Ledger for Codex

> **Intended Recipient:** Codex (Personal Engineering Collaborator)
> **Authoring Lead:** Antigravity & Anesu Mupesa (Lead Architect)
> **Last Synchronized:** 2026-09-18
> **Current Cycle:** Sprint 1 — Calendar DB Persistence, Browser Voice Tool Calling & `list_events` Query Complete

---

## 1. Executive State Snapshot

* **Current Stage:** Phase 1 (Credentials & Environment), Phase 2 (Calendar DB Persistence), and Phase 3 (Browser Voice Tool Calling) — **ALL COMPLETE AND VERIFIED ON LIVE NEON POSTGRESQL**.
* **GitHub Repository:** `https://github.com/anesu-metabox/AI-Voice-Assistants.git`
* **Active Working Branch:** `develop` (Tracking: `origin/develop`).
* **Sacred Main Trunk Protocol (ADR-009):** `main` is protected. Direct push to `main` is prohibited. Only **Anesu (`anesu-metabox`)** is authorized to push or merge into `main`. All feature branches and PRs must target `develop`.
* **Notion Strategic Journal:** Anesu's Personal Decision Log & Non-Obvious Architecture Choices — `https://app.notion.com/p/Anesu-s-Personal-Decision-Log-Non-Obvious-Architecture-Choices-3ddcf5b722df813e8c27fdea150da7fc`
* **Baseline Engine:** Google Gemini Live via `@google/genai` v2.23.0 directly from the browser (ADR-008). LiveKit agent runner retained but the primary tested path is the Next.js browser client using ephemeral Gemini tokens.
* **Local Tooling State:** Python 3.14 verified with pytest; Node.js v22.23.2 and npm 10.9.8 active; Neon PostgreSQL `divine-hat-17233837` on branch `production` migrated through `002_calendar_events.sql`.
* **Servers running locally:**
  * FastAPI backend: `http://127.0.0.1:8000` — started with `.\\.venv\\Scripts\\python.exe -m uvicorn backend.app.main:app --reload --port 8000`
  * Next.js frontend: `http://localhost:3000` — started with `npm run dev` inside `frontend/`

---

## 2. Completed Files & Architectural Purpose

| File Path | Component | Architectural Purpose & Exported Entities |
| :--- | :--- | :--- |
| `.github/workflows/ci.yml` | CI/CD Quality Gate | Automated GitHub Actions checking Python syntax, TypeScript typecheck, and DDL integrity on PRs. |
| `.neon` | Neon Context | Linked project context (`divine-hat-17233837`) and branch (`production`). |
| `neon.ts` | Neon Policy | Config-as-code specification deployed to Neon branch via `neon deploy`. |
| `.gitignore` | Repository Hygiene | Excludes `.env`, node_modules, `.next`, Python cache, virtual environments, and `.agents/*` run logs from GitHub. |
| `.env` | Root Config | Pre-formatted environment config with keys for LiveKit, Gemini, Neon Postgres, and Google OAuth. |
| `AGENT_GOAL.md` | Orchestrator | Antigravity operational directives, laws of grounded confirmation, Sacred Main law, and milestone rubric. |
| `CODEX_COLLABORATOR_STATE.md` | Collaboration | This live ledger tracking state, completed tasks, and next steps for Codex. |
| `PROJECT.md` | Architecture Spec | Calendar persistence architecture, interface contracts, milestone tracking, and feature inventory. |
| `db/migrations/001_initial_schema.sql` | Database | DDL for `tasks`, `idempotency_records`, and `user_preferences` with auto-update trigger. |
| `db/migrations/002_calendar_events.sql` | Database | DDL for `calendar_events`: UUID PK, `user_id`, `title`, `start_time`, `end_time`, `duration_minutes`, `attendees JSONB`, `meet_link`, `status CHECK ('confirmed','cancelled')`, `cancelled_at`, composite indexes on `(user_id, start_time)` and `(user_id, status, start_time, end_time)`, auto-update timestamp trigger. |
| `db/connection.py` | Database | `get_db_pool()`, `close_db_pool()` — asyncpg pool with `statement_cache_size=0` for PgBouncer, DSN sanitized to strip `channel_binding` and `sslmode` query params, `ssl='require'` injected directly. |
| `db/run_migrations.py` | Database | SQL migration runner executing numbered DDL files against Neon PostgreSQL. |
| `db/idempotency.py` | Database | `acquire_idempotency_lock()`, `commit_idempotency_lock()`, `release_idempotency_lock()` with in-memory fallback. |
| `backend/requirements.txt` | Backend | FastAPI, Uvicorn, Pydantic, Httpx, Asyncpg dependencies. |
| `backend/app/config.py` | Backend | Pydantic `Settings` loading environment variables. |
| `backend/app/schemas/tools.py` | Backend | `ToolName` enum (7 values including `LIST_EVENTS`), strict Pydantic models for all tools including `ListEventsParams` / `ListEventsResult`, `user_id` injection schemas, ANE-03 confirmation models, and `TOOL_SCHEMAS` registry. |
| `backend/app/tools/calendar.py` | Backend | Four async calendar functions: `get_calendar_availability()` (free slot computation from working hours minus confirmed events), `book_event()` (atomic `pg_advisory_xact_lock` reservation + tasks table audit), `cancel_event()` (soft delete + ANE-03 gate), `list_events()` (returns all confirmed `calendar_events` rows for a date range — the correct function for "what meetings do I have?"). |
| `backend/app/tools/contacts.py` | Backend | `search_contacts()` with simulated latency (~110ms) & realistic mock directory. |
| `backend/app/tools/email.py` | Backend | `draft_email()` fast atomic email drafting with simulated latency (~130ms). |
| `backend/app/tools/tasks.py` | Backend | `create_durable_task()` registering durable tasks in PostgreSQL for Trigger.dev queue. |
| `backend/app/api/tools.py` | Backend | `POST /tools/execute` dispatcher: tool existence check, Pydantic validation, ANE-03 interceptor, idempotency lock, `user_id`/`session_id` injection for all 4 calendar tools (including `list_events`), slot conflict formatting, audit trail. |
| `backend/app/api/tasks.py` | Backend | `GET /tasks/{id}/status`, `POST /tasks/{id}/cancel` for background task lifecycle. |
| `backend/app/main.py` | Backend | FastAPI application, CORS middleware, lifespan database priming, and `/health`. |
| `backend/tests/conftest.py` | Backend Tests | Pytest fixtures for asyncpg connection pool, tenant-isolated test user UUIDs, and automated pre/post test cleanup. |
| `backend/tests/test_calendar_db.py` | Backend Tests | 7 E2E integration tests: DDL schema, atomic reservation, dynamic availability, 10-worker concurrency, idempotency replay, soft deletion, confirmation gate — all passing against live Neon DB. |
| `backend/tests/test_calendar_edge_cases.py` | Backend Tests | 10 edge case tests: boundary conditions, conflict detection accuracy, cancellation audit trail — all passing. |
| `pytest.ini` | Test Config | Pytest runner configuration (`asyncio_mode = auto`, session loop scoping for asyncpg pool). |
| `agent/requirements.txt` | Agent Runner | `livekit-agents`, `livekit-plugins-google`, `httpx`, `python-dotenv`. |
| `agent/config.py` | Agent Runner | System prompt, model parameters, and LiveKit connection settings. |
| `agent/agent.py` | Agent Runner | Worker entrypoint, Gemini Multimodal Live context, HTTP tool dispatch to FastAPI. |
| `frontend/package.json` | Frontend | Next.js 14, `@google/genai` v2.23.0, Tailwind, Lucide icons. |
| `frontend/src/lib/tools.ts` | Frontend | `calendarToolDeclarations: FunctionDeclaration[]` — OpenAPI 3.0 schemas for all 4 calendar tools passed to Gemini Live. `executeBackendTool()` calls `POST /api/tools/execute`. |
| `frontend/src/lib/types.ts` | Frontend | Shared TypeScript interfaces: `TaskItem`, `TranscriptMessage`, `ConnectionStatus`, `BookEventResult`, `CalendarAvailabilityResult`. |
| `frontend/src/app/api/gemini-token/route.ts` | Frontend | Server-side Next.js route minting short-lived Gemini ephemeral tokens. `liveConnectConstraints` includes `tools: [{ functionDeclarations: calendarToolDeclarations }]` so the token authorizes tool calling. |
| `frontend/src/app/api/tools/execute/route.ts` | Frontend | Next.js API proxy: `POST /api/tools/execute` -> `POST http://127.0.0.1:8000/tools/execute`. Injects default `user_id`, standardizes error envelope. |
| `frontend/src/hooks/useGeminiLiveSession.ts` | Frontend | Core browser session hook. Connects via `ai.live.connect()` with ephemeral token. Registers all 4 tool declarations and system instruction. `onmessage` intercepts `message.toolCall.functionCalls`, dispatches each to the backend via `executeBackendTool()`, updates `tasks` state (running -> completed/failed), then calls `session.sendToolResponse()`. |
| `frontend/src/hooks/useClientVAD.ts` | Frontend | Web Audio hook setting `gain.value = 0.0` in <20ms and sending cancellation signal. |
| `frontend/src/hooks/useLiveKitSession.ts` | Frontend | (Legacy path) Room lifecycle, Web Audio graph, and data channel messaging for LiveKit transport. |
| `frontend/src/app/page.tsx` | Frontend | 3-column executive voice assistant dashboard wired to `useGeminiLiveSession`. |
| `frontend/src/components/audio/AudioVisualizer.tsx` | Frontend | Canvas 60fps waveform ring with listening, speaking, thinking states. |
| `frontend/src/components/audio/AudioControls.tsx` | Frontend | Mic mute/unmute, Hands-free / PTT mode toggle, disconnect button, latency badge. |
| `frontend/src/components/transcript/TranscriptDeck.tsx` | Frontend | Real-time speech bubbles with `[Interrupted]` tag support. |
| `frontend/src/components/tasks/TaskDeck.tsx` | Frontend | Task cards displaying tool execution status (running/completed/failed), latency, and idempotency keys. Populated from `tasks` state in `useGeminiLiveSession`. |
| `frontend/public/worklets/vad-processor.js` | Frontend | AudioWorklet computing local RMS energy for sub-20ms instant muting. |
| `frontend/src/app/api/livekit-token/route.ts` | Frontend | Next.js route minting LiveKit room access tokens (legacy path, kept for fallback). |

---

## 3. Tool Registry — Current State

All tools are registered end-to-end: `ToolName` enum -> `TOOL_SCHEMAS` -> `TOOL_REGISTRY` -> `calendarToolDeclarations` -> Gemini system instruction.

| Tool Name | Backend Function | When Gemini Calls It |
| :--- | :--- | :--- |
| `get_calendar_availability` | `calendar.get_calendar_availability()` | "When are you free?", "Find me a slot", "What times are open?" |
| `book_event` | `calendar.book_event()` | "Book a meeting", "Schedule", "Reserve" |
| `cancel_event` | `calendar.cancel_event()` | "Cancel the meeting" — ANE-03 gate active, requires `confirm: true` |
| `list_events` | `calendar.list_events()` | "What meetings do I have today?", "What is on my calendar?", "Do I have anything scheduled?" |
| `search_contacts` | `contacts.search_contacts()` | "Find contact", "Look up" |
| `draft_email` | `email.draft_email()` | "Draft an email", "Send a message" |
| `create_durable_task` | `tasks.create_durable_task()` | "Start a background task", "Analyse", "Research" |

---

## 4. Critical Known Behaviours

### UI State vs Database State
* The `tasks` array in `useGeminiLiveSession.ts` is React `useState` — it resets on every page refresh. This is intentional for the current sprint; the execution ledger (right panel) is session-scoped only.
* The **database is always the source of truth**. All booked events persist in `calendar_events` across refreshes. Gemini queries the database fresh on every `list_events` call.
* There is no `useEffect` to pre-load past sessions into React state on mount. If future work requires this, the pattern is: on mount, call `POST /api/tools/execute` with `tool_name: list_events` for today's date and hydrate `tasks` state from the response.

### Gemini Live Session Lifecycle
* Each `ai.live.connect()` call starts a completely fresh model context window. Gemini has no memory of prior sessions.
* The ephemeral token is minted server-side via `GET /api/gemini-token` and passed to the browser client. Tokens expire — if reconnect fails with 401, refresh the page to mint a new token.
* Tool declarations in `liveConnectConstraints` (server token route) **must match** the declarations in `ai.live.connect()` config (browser hook) or the session will reject tool calls silently. Any new tool must be added to both places.

### `get_calendar_availability` vs `list_events` — Do Not Confuse
* `get_calendar_availability` returns **free slots** (times that are NOT booked). Use it to find a time to schedule.
* `list_events` returns **confirmed bookings** (meetings that ARE booked). Use it to answer "what do I have today?".
* The system instruction in `useGeminiLiveSession.ts` explicitly disambiguates these two — do not merge them or change one without updating the other.

### Concurrency & Locking
* `book_event()` uses `pg_advisory_xact_lock(hashtext('calendar_' || user_id))` inside an asyncpg transaction. Under 10 concurrent workers exactly 1 booking succeeds; all others receive a structured `conflict` response with `next_available_slot`.
* The idempotency engine (`db/idempotency.py`) guards write tools against duplicate execution on network retry.

---

## 5. Active Architectural Decisions (Quick Reference for Codex)

1. **Sacred Main & Sole Gatekeeper Protocol (ADR-009):** `main` is sacred and protected. Direct pushes to `main` are blocked. Only Anesu (`anesu-metabox`) merges or pushes to `main`. All feature work occurs on branches off `develop`.
2. **No Git Push Without Explicit Instruction:** Neither Antigravity nor Codex may push, commit, or suggest committing to any branch without Anesu explicitly asking. This is an absolute constraint.
3. **Automated CI Quality Gate:** GitHub Actions runs on all PRs to `develop` and `main`. Status checks must be green before merging.
4. **Python Environments:** Separate virtual environments and dedicated `requirements.txt` for `agent/` and `backend/` to prevent WebRTC/gRPC version collisions.
5. **Database Migration Tooling:** Pure SQL migrations in `db/migrations/` executed via `asyncpg` for sub-5ms raw query speed (no heavy ORM overhead in the critical voice loop).
6. **Browser-Direct Gemini Live:** The active browser path uses `@google/genai` directly from Next.js (no LiveKit in the browser voice loop). The LiveKit agent runner (`agent/agent.py`) is retained as a secondary/fallback path.
7. **Tool Dispatch Architecture:** Gemini Live (browser) -> `message.toolCall` -> `executeBackendTool()` -> `POST /api/tools/execute` (Next.js proxy) -> `POST http://127.0.0.1:8000/tools/execute` (FastAPI) -> tool function -> Neon PostgreSQL.
8. **Interruption Protocol (ADR-005):** Next.js client uses an `AudioWorklet` (`vad-processor.js`) to locally mute speaker audio in under 20ms upon user voice energy detection.
9. **ANE-03 Confirmation Protocol:** Destructive tools (`cancel_event`) are gated. First call returns `confirmation_required`. The model must ask the user explicitly and re-call with `confirm: true`.
10. **Zero Emoji Policy:** No emoji in any output — code, documentation, UI strings, commit messages, or responses.

---

## 6. Immediate Next Steps for Codex

When picking up work, confirm the following first:

1. **Branch rule:** Always create a feature branch off `develop`. Never work directly on `develop` or `main`.
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feat/your-feature-name
   ```

2. **Start both servers before testing:**
   * Backend (from repo root): `.\\.venv\\Scripts\\python.exe -m uvicorn backend.app.main:app --reload --port 8000`
   * Frontend (from `frontend/`): `npm run dev`

3. **Verify `list_events` end-to-end:** Open `http://localhost:3000`, connect to Gemini, say "what meetings do I have today?". Gemini should call `list_events`, the right panel should show a task card, and Gemini should read back confirmed bookings from the database.

4. **Pending work identified (not started):**
   * Session hydration on page load — optionally pre-populate the execution ledger from the `tasks` table on mount so past bookings appear in the UI after a refresh.
   * Google Calendar OAuth integration — connecting `book_event` / `list_events` to the real Google Calendar API in addition to the Neon DB record.
   * Extend test coverage — add `test_list_events.py` covering empty day, multi-event day, and cross-day range queries against live Neon DB.
