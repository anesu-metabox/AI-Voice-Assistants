# Responsibilities & Ownership Audit Report: Backend & Integrations Lead

> **Document Version:** 1.0.0  
> **Audit Date:** 2026-09-18  
> **Status:** Partially Completed — Immediate Work Required  
> **Target Scope:** Tool Dispatcher Engine, Direct API Integrations, Asynchronous Worker Queue, Reliability & Idempotency, and Test Automation.

---

## Executive Summary

An audit of the repository (`anesu-metabox/AI-Voice-Assistants`) was conducted against the five primary engineering responsibilities.

**Overall Completion Score:** **~38%**

| Responsibility Area              | Target Specification                                                                 | Current Status                                                                                            |  Score  |
| :------------------------------- | :----------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- | :-----: |
| **1. Tool Dispatcher Engine**    | FastAPI service, tool call ingestion, Pydantic schema validation, function execution | **Partially Implemented** (Dispatcher runs, but lacks tool-specific schema validation & schema discovery) | **60%** |
| **2. Direct API Integrations**   | Authenticated connectors for Google Calendar, Outlook, and CRM (<400ms)              | **Partially Implemented** (Google Calendar v3 live; Outlook & Real CRM missing)                           | **35%** |
| **3. Asynchronous Worker Queue** | Persistent background task runner for long-running batch jobs (>2s)                  | **Scaffold Only** (DB schema and status endpoints exist; no worker or queue runner)                       | **20%** |
| **4. Reliability & Idempotency** | Zero duplicate writes on network drops via idempotency key validation                | **Partially Implemented** (Lock engine active, but has race condition & agent key replay missing)         | **70%** |
| **5. Test Automation for Tools** | Unit tests and mock servers for every tool function                                  | **Not Implemented** (Zero unit tests, no mock servers, no pytest in CI)                                   | **5%**  |

---

## Detailed Gap Analysis by Responsibility

---

### 1. Tool Dispatcher Engine

> **Requirement:** Maintain the FastAPI service that receives tool calls from the voice agent, validates Pydantic schemas, and executes functions.

#### What Has Been Done

- **FastAPI Service:** Implemented in [`backend/app/main.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/main.py) with lifespan management, CORS middleware, and `/health` probes.
- **Tool Execution Route:** Implemented in [`backend/app/api/tools.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/api/tools.py) at `POST /tools/execute`.
- **Execution Metrics:** Measures elapsed execution time (`execution_time_ms`) and returns structured JSON responses via [`ToolExecutionResponse`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/schemas/tools.py).
- **Tool Registry:** Registered `get_calendar_availability`, `book_event`, and `search_contacts`.

#### What Has NOT Been Done Yet (Gaps)

1. **Tool-Specific Pydantic Validation:**
   - In [`backend/app/schemas/tools.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/schemas/tools.py), `ToolExecutionRequest.parameters` is typed as a generic `Dict[str, Any]`.
   - The dispatcher does **not** validate incoming payloads against dedicated per-tool Pydantic schemas (e.g., `GetCalendarAvailabilityParams`, `BookEventParams`, `SearchContactsParams`).
   - In [`backend/app/api/tools.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/api/tools.py), it unpacks `await tool_func(**call_params)`. If arguments are missing or have incorrect types, Python raises an unhandled `TypeError`, which returns a generic 500/error rather than a typed 422 Unprocessable Entity error indicating which field failed.
2. **Dynamic Schema Introspection / Discovery Endpoint:**
   - There is no `GET /tools/declarations` or `GET /tools/schema` endpoint.
   - Tool definitions and schemas are manually duplicated between [`agent/agent.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/agent/agent.py) (`AssistantFunctionContext`) and the backend. If a tool changes, the agent must be manually edited.
3. **High-Impact Permission Guardrails:**
   - Per architecture specification (ANE-03), high-impact write operations (such as booking or canceling) must support an interceptor/confirmation state before triggering mutations. Currently, `book_event` executes immediately without verifying a user confirmation token.

---

### 2. Direct API Integrations (Fast Lane)

> **Requirement:** Implement authenticated connectors for Google Calendar, Outlook, and CRM APIs (<400ms).

#### What Has Been Done

- **Google Calendar API v3 (Live):**
  - Fully implemented in [`backend/app/services/google_calendar.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/services/google_calendar.py) and [`backend/app/services/google_oauth.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/services/google_oauth.py).
  - Direct asynchronous HTTP calls via `httpx` to Google Calendar Free/Busy and Event endpoints with auto-generated Google Meet conferencing links.
  - Durable OAuth 2.0 token storage and silent token auto-refresh in Neon PostgreSQL (`oauth_tokens` table in [`db/migrations/002_oauth_tokens.sql`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/db/migrations/002_oauth_tokens.sql)).
  - Realistic mock fallback when unauthenticated.

#### What Has NOT Been Done Yet (Gaps)

1. **Microsoft Outlook Integration (Microsoft Graph Calendar API):**
   - **Completely missing.** There is no OAuth connector, no token management, and no API client for Microsoft Outlook / Office 365.
   - Needs:
     - Microsoft Azure AD OAuth2 authentication endpoints (`/auth/microsoft/login`, `/auth/microsoft/callback`).
     - Service for Microsoft Graph Calendar endpoints (`https://graph.microsoft.com/v1.0/me/calendar/getSchedule`, `/events`).
     - Outlook tool wrapper matching the `get_calendar_availability` and `book_event` contracts.
2. **CRM API Integrations:**
   - **Completely missing real API connectors.**
   - [`backend/app/tools/contacts.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/tools/contacts.py) currently queries a hardcoded, 3-entry Python dictionary (`MOCK_CONTACTS`).
   - No authenticated connector exists for any industry CRM (e.g., HubSpot API v3, Salesforce REST API, or Pipedrive).
3. **<400ms Latency Budget Guardrails & Measurement:**
   - No circuit breaker, timeout clamping (e.g. 350ms HTTP timeout), or connection pooling optimization is enforced to ensure third-party APIs do not breach the 400ms voice deadline.

---

### 3. Asynchronous Worker Queue (Persistent Lane)

> **Requirement:** Set up the background task runner for long-running batch jobs (>2s).

#### What Has Been Done

- **PostgreSQL Schema:** [`db/migrations/001_initial_schema.sql`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/db/migrations/001_initial_schema.sql) defines the `tasks` table with columns for `status`, `input_parameters`, `output_result`, and `error_message`.
- **Task Inspection & Cancellation APIs:** Implemented in [`backend/app/api/tasks.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/api/tasks.py):
  - `GET /tasks/{task_id}/status`
  - `POST /tasks/{task_id}/cancel`

#### What Has NOT Been Done Yet (Gaps)

1. **No Background Worker Process / Queue Engine:**
   - **Zero task worker runner exists.** Neither an external queue (e.g., Celery, Redis Queue/ARQ, Temporal, Trigger.dev) nor an in-database polling worker (`SELECT ... FOR UPDATE SKIP LOCKED`) has been implemented.
   - Tasks in the database cannot transition from `'pending'` to `'running'` or `'completed'` by any automated engine.
2. **No Task Enqueueing Endpoint or Dispatch Mechanism:**
   - There is no `POST /tasks/enqueue` or dispatcher logic that converts a tool call exceeding the latency budget (>2s) into a background task and returns a `task_id` for immediate voice handoff.
3. **No Batch or Long-Running Jobs Implemented:**
   - The multi-source document compiler and executive briefing generator (`COL1-05` / ADR-003) only exists as a hardcoded static mock entry (`task_sample_001` in `backend/app/api/tasks.py`).

---

### 4. Reliability & Idempotency

> **Requirement:** Guarantee zero duplicate writes on network drops by validating idempotency keys.

#### What Has Been Done

- **Idempotency Database Table:** `idempotency_records` table defined in [`db/migrations/001_initial_schema.sql`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/db/migrations/001_initial_schema.sql) with status enum (`acquired`, `committed`, `refunded`) and TTL expiration.
- **Idempotency Manager:** Implemented in [`db/idempotency.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/db/idempotency.py) with 3-phase locking:
  - `acquire_idempotency_lock(key, user_id, tool_name, ttl)`
  - `commit_idempotency_lock(key, response_payload)`
  - `release_idempotency_lock(key)`
  - In-memory lock fallback when PostgreSQL is offline.
- **Dispatcher Integration:** [`backend/app/api/tools.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/api/tools.py) validates the key, returns cached results for committed keys, blocks concurrent executions, commits successful writes, and refunds locks on exceptions.

#### What Has NOT Been Done Yet (Gaps)

1. **Race Condition on Concurrent Lock Acquisition:**
   - In [`db/idempotency.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/db/idempotency.py) (lines 51–97), the function executes a `SELECT`, followed by application logic, followed by an `INSERT`.
   - If two requests with the same key arrive simultaneously, both can pass the `SELECT` check. The second will trigger a PostgreSQL `UniqueViolationError`, resulting in an unhandled 500 error instead of a clean lock conflict (`status="conflict"`).
   - _Fix Needed:_ Use atomic `INSERT ... ON CONFLICT (key) DO NOTHING` or PostgreSQL advisory locks.
2. **Agent Retries & Network Drop Key Replay:**
   - In [`agent/agent.py`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/agent/agent.py) (line 106), `book_event` generates a fresh UUID every time it is called: `idempotency_key=str(uuid.uuid4())`.
   - If a network drop occurs after the backend initiates the booking and the agent retries the action, the agent transmits a **new** key. This causes a duplicate booking, violating the Zero Duplication Guarantee.
   - _Fix Needed:_ The client/agent session must generate and bind the idempotency key to the specific user intent/turn, caching and re-sending the same key upon retry.
3. **Idempotency for Asynchronous Background Tasks:**
   - The `tasks` table includes an `idempotency_key` column, but task submission does not check or acquire idempotency locks.

---

### 5. Test Automation for Tools

> **Requirement:** Unit tests and mock servers for every tool function.

#### What Has Been Done

- Internal mock fallback branches exist inside `calendar.py` and `contacts.py` when live credentials are absent.

#### What Has NOT Been Done Yet (Gaps)

1. **Zero Automated Unit Tests:**
   - There are **no unit test files** anywhere in the backend (no `backend/tests/` directory).
   - Missing test suites:
     - `test_tool_dispatcher.py` (Validating tool dispatching, schema validation, 404s, error handling).
     - `test_calendar_tool.py` (Testing `get_calendar_availability` and `book_event`).
     - `test_contacts_tool.py` (Testing `search_contacts` filtering and pagination).
     - `test_idempotency.py` (Testing concurrent lock acquisition, cached replay, TTL expiry, and refunds).
2. **No Mock Servers or Fixtures:**
   - No mock HTTP server or client mocking library (e.g. `respx`, `pytest-httpx`, or WireMock) is set up to test Google Calendar v3 API, Microsoft Graph API, or CRM endpoints without internet access.
3. **Missing Test Dependencies in Environment:**
   - [`backend/requirements.txt`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/requirements.txt) does not include `pytest`, `pytest-asyncio`, `respx`, or `pytest-cov`.
4. **CI Pipeline Omits Tests:**
   - [`.github/workflows/ci.yml`](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/.github/workflows/ci.yml) only runs `python -m py_compile` (syntax compilation) and TypeScript checks. It does not run `pytest`.

---

## Action Plan & Roadmap to 100% Completion

```
[Phase 1: Test Suite & Tool Schemas]
       │
       ├─► 1. Install pytest, pytest-asyncio, respx
       ├─► 2. Create per-tool Pydantic schemas in schemas/tools.py
       └─► 3. Add unit tests for dispatcher, calendar, contacts, idempotency
       │
[Phase 2: Reliability & Idempotency Hardening]
       │
       ├─► 4. Fix race condition in db/idempotency.py with atomic UPSERT/ON CONFLICT
       └─► 5. Update agent/agent.py to cache and replay idempotency keys on retries
       │
[Phase 3: Persistent Background Worker Queue]
       │
       ├─► 6. Implement database polling worker or async task runner (worker.py)
       ├─► 7. Create POST /tasks/enqueue endpoint with handoff support
       └─► 8. Implement multi-source briefing compilation task
       │
[Phase 4: Missing Fast-Lane Integrations]
       │
       ├─► 9. Build Microsoft Graph (Outlook) OAuth & Calendar connector
       └─► 10. Implement live CRM connector (HubSpot / Salesforce REST) with <400ms SLA
```

### Prioritized Checklist for Collaborator 1

- [ ] **Step 1: Test Infrastructure**
  - Add `pytest>=8.2.0`, `pytest-asyncio>=0.23.0`, and `respx>=0.21.0` to `backend/requirements.txt`.
  - Create `backend/tests/` with unit tests for each tool function and dispatcher.
  - Update `.github/workflows/ci.yml` to run `pytest backend/tests`.
- [ ] **Step 2: Strict Schema Validation in Dispatcher**
  - Define `GetCalendarAvailabilityParams`, `BookEventParams`, and `SearchContactsParams` in `backend/app/schemas/tools.py`.
  - Validate `request.parameters` against the tool's specific model inside `POST /tools/execute` before invoking the function.
- [ ] **Step 3: Atomic Idempotency Engine**
  - Refactor `acquire_idempotency_lock` in `db/idempotency.py` to use atomic SQL (`INSERT ... ON CONFLICT DO UPDATE`) to prevent concurrent collision errors.
  - Add intent-bound idempotency key reuse in `agent/agent.py`.
- [ ] **Step 4: Asynchronous Worker Engine**
  - Implement `backend/app/worker.py` to poll and execute pending tasks from the `tasks` table.
  - Add `POST /tasks/enqueue` for long-running jobs (>2s).
- [ ] **Step 5: Outlook & CRM Direct Connectors**
  - Create `backend/app/services/outlook_calendar.py` (Microsoft Graph API).
  - Create `backend/app/services/crm.py` (HubSpot / CRM REST API).
