# Architectural Requirements & Working Notes Audit Report

> **Historical audit snapshot (2026-09-18), not current implementation status.**
> Findings describe an earlier baseline and may have been corrected since this
> report. Use [docs/QA-review.md](docs/QA-review.md) and
> [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for current
> disposition. Any shared demo user IDs or mock-success examples below are
> historical evidence only and are prohibited in active code.

> **Document Version:** 1.0.0  
> **Audit Date:** 2026-09-18  
> **Status:** Critical Architectural Violations Identified  
> **Target Scope:** Fast Lane Latency Rule (<400ms & Pre-warmed Pools), Grounded Confirmation Rule (Strict Gating & No Ambiguous Flags), and Idempotency Enforcement (Mandatory Locks on Side-Effects).

---

## Executive Summary

An in-depth technical audit was conducted on the AI Voice Assistant codebase (`anesu-metabox/AI-Voice-Assistants`) against the three mandatory Working Notes & Architectural Requirements:

1. **Fast Lane Latency Rule** (<400ms, pre-warmed `httpx.AsyncClient` connection pools).
2. **Grounded Confirmation Rule** (Strictly gated voice confirmations on verified `status: "success"`, zero ambiguous success flags).
3. **Idempotency Enforcement** (Mandatory pre-execution lock on all state-modifying actions).

### Compliance Scorecard

| Requirement                       | Specification                                                                         | Current Implementation State                                                                                                 |    Compliance     |
| :-------------------------------- | :------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------- | :---------------: |
| **1. Fast Lane Latency Rule**     | Direct calendar lookups <400ms; pre-warmed `httpx.AsyncClient` connection pools       | Ephemeral `httpx.AsyncClient` instantiated on every request; no connection pool; timeouts set to 6–10s (violates <400ms SLA) | **FAILED (15%)**  |
| **2. Grounded Confirmation Rule** | Voice confirmations gated on verified `status: "success"`; no ambiguous success flags | Critical flaw: silent mock fallback returns fake `status: "success"` on live Google Calendar failure                         | **FAILED (25%)**  |
| **3. Idempotency Enforcement**    | All state-modifying actions must acquire lock before executing side-effects           | Idempotency key is optional; write actions execute without locks if key is omitted; read tools create unnecessary locks      | **PARTIAL (50%)** |

---

## 1. Fast Lane Latency Rule Audit

### Rule Definition

> Direct calendar lookups must complete in `<400ms`. Use pre-warmed connection pools (`httpx.AsyncClient`).

### Detailed Findings & Code Evidence

#### Violation 1.1: Zero Pre-warmed HTTP Connection Pools

Across both the agent and backend service, `httpx.AsyncClient` is repeatedly instantiated inside individual function calls using context managers (`async with httpx.AsyncClient(...) as client:`). It is destroyed immediately after every call:

- [`agent/agent.py` (Line 55)](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/agent/agent.py#L55):
  ```python
  async with httpx.AsyncClient(timeout=10.0) as client:
      response = await client.post(url, json=payload)
  ```
- [`backend/app/services/google_calendar.py` (Line 63)](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/services/google_calendar.py#L63):
  ```python
  async with httpx.AsyncClient(timeout=6.0) as client:
      response = await client.post(url, headers=headers, json=payload)
  ```
- [`backend/app/services/google_calendar.py` (Line 181)](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/services/google_calendar.py#L181):
  ```python
  async with httpx.AsyncClient(timeout=8.0) as client:
      response = await client.post(url, headers=headers, json=event_payload)
  ```
- [`backend/app/services/google_oauth.py` (Lines 79, 145, 164)](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/services/google_oauth.py#L79):
  New client opened on every token exchange and refresh.

**Technical Impact:**
Creating a new `AsyncClient` for each request forces a new TCP handshake and TLS negotiation (`https://www.googleapis.com` or `http://127.0.0.1:8000`) on every single tool execution. TLS handshake alone costs **80ms – 250ms**. Without a persistent, pre-warmed connection pool (`httpx.Limits(max_keepalive_connections=..., max_connections=...)`), the sub-400ms voice deadline is impossible to sustain reliably under real-world conditions.

#### Violation 1.2: Excessive Timeouts That Contradict the 400ms Budget

- `agent/agent.py` specifies `timeout=10.0` (10 seconds).
- `backend/app/services/google_calendar.py` specifies `timeout=6.0` (6 seconds) for availability and `timeout=8.0` (8 seconds) for booking.

**Technical Impact:**
If Google APIs experience high latency, the backend hangs for up to 6–8 seconds before timing out. This blocks the asyncio voice loop and creates an awkward, multi-second silence on the voice call, severely breaching conversational UX standards.

---

## 2. Grounded Confirmation Rule Audit

### Rule Definition

> Spoken voice confirmations are strictly gated on verified backend tool outputs returning `status: "success"`. Never return ambiguous success flags.

### Detailed Findings & Code Evidence

#### Violation 2.1: CRITICAL FLAW — Silent Mock Fallback Fakes Successful Booking

In [`backend/app/tools/calendar.py` (Lines 87–117)](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/tools/calendar.py#L87-L117):

```python
async def book_event(title: str, start_time: str, ...) -> Dict[str, Any]:
    # 1. Attempt live Google Calendar booking if credentials are configured
    if settings.google_client_id and settings.google_client_secret:
        live_booking = await book_google_calendar_event(...)
        if live_booking:
            return live_booking

    # 2. Realistic mock fallback with simulated network latency (160ms)
    logger.info("Using simulated event booking fallback.")
    await asyncio.sleep(0.16)

    event_id = f"evt_{uuid.uuid4().hex[:12]}"
    meet_link = f"https://meet.google.com/..."

    return {
        "event_id": event_id,
        "title": title,
        "start_time": start_time,
        "meet_link": meet_link,
        "status": "confirmed",
        "source": "google_calendar_mock",
    }
```

Then in [`backend/app/api/tools.py` (Lines 98–103)](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/api/tools.py#L98-L103):

```python
result = await tool_func(**call_params)
return ToolExecutionResponse(
    status="success",
    data=result,
    execution_time_ms=elapsed_ms,
    idempotency_key=idempotency_key,
)
```

**Failure Mechanism:**

1. User asks the voice bot: _"Book a meeting with Sarah tomorrow at 2 PM."_
2. Live Google Calendar API booking fails (e.g. invalid token, quota limit, or Google 503 error).
3. `book_google_calendar_event()` returns `None`.
4. `book_event()` silently swallows the failure and drops into the **mock fallback**.
5. It generates a fake `evt_xxxx` ID and a fake Google Meet URL.
6. The dispatcher wraps this in `status: "success"`.
7. The voice assistant reads `status: "success"` and announces: _"I have confirmed and scheduled your meeting with Sarah for 2 PM tomorrow!"_
8. **Real-world outcome:** The meeting **does not exist** on Google Calendar. The user was told an untruth.

This directly violates: _"The voice bot must never say 'I have scheduled your meeting' based solely on its own generation... If the tool fails or times out, the bot explicitly reports: 'I couldn't reach your calendar right now. The meeting was not booked.'"_

#### Violation 2.2: Dual and Ambiguous Status Fields

- The outer response schema returns `ToolExecutionResponse.status` (`"success"`, `"error"`, `"conflict"`).
- Inside `data`, calendar booking returns `status: "confirmed"`, while calendar availability returns no inner status at all.
- The voice prompt instructs Gemini: `Grounded Confirmation Rule: You must NEVER speak a confirmation that an event was booked or a task succeeded unless the tool returns a verified "status": "success".`
- Because `data` contains `"status": "confirmed"` while the envelope contains `"status": "success"`, the contract is ambiguous regarding which status key the LLM is expected to evaluate.

---

## 3. Idempotency Enforcement Audit

### Rule Definition

> All state-modifying actions must acquire an idempotency lock before executing side-effects.

### Detailed Findings & Code Evidence

#### Violation 3.1: Idempotency Locks Are Optional, Leaving Side-Effects Unprotected

In [`backend/app/schemas/tools.py` (Line 25)](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/schemas/tools.py#L25):

```python
idempotency_key: Optional[str] = Field(
    default=None,
    description="Client-generated UUID idempotency key to prevent duplicate writes",
)
```

In [`backend/app/api/tools.py` (Lines 59–60, 84–92)](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/backend/app/api/tools.py#L59):

```python
# 1. Idempotency Check (if key provided)
if idempotency_key:
    is_new, cached_payload, msg = await acquire_idempotency_lock(...)
    ...

# 2. Execute Tool Function
try:
    result = await tool_func(**call_params)
```

**The Gap:**
If a caller (such as an external script, mobile app, or bug in the voice client) invokes `POST /tools/execute` with `tool_name: "book_event"` but leaves `idempotency_key` blank or null:

- The backend **completely bypasses lock acquisition**.
- It proceeds straight to executing the side-effect.
- **No lock is acquired before executing side-effects.**
  The system lacks a policy check defining mutating actions (e.g. `MUTATING_TOOLS = {"book_event", "cancel_task"}`) and rejecting un-keyed requests with `400 Bad Request ("idempotency_key is required for state-modifying action 'book_event'")`.

#### Violation 3.2: Wasteful Locking on Read-Only Queries

In [`agent/agent.py` (Lines 49–50)](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/agent/agent.py#L49):

```python
payload = {
    "tool_name": tool_name,
    "parameters": parameters,
    "idempotency_key": idempotency_key or str(uuid.uuid4()),
    "user_id": "00000000-0000-0000-0000-000000000001",
}
```

When `get_calendar_availability` or `search_contacts` is called, `call_backend_tool` injects a fresh `uuid.uuid4()`.
This forces every read-only query to run an `INSERT` into `idempotency_records` in PostgreSQL, adding database load and round-trip latency to the Fast Lane (<400ms) where idempotency is unnecessary.

#### Violation 3.3: Missing Atomic Guard in `acquire_idempotency_lock` (Race Condition)

In [`db/idempotency.py` (Lines 50–97)](file:///c:/Users/Elihu%20Joseph%20MetaBox/AI-Voice-Assistants/db/idempotency.py#L50-L97):
The engine does a `SELECT`, evaluates in Python, and then performs an `INSERT`.
If two identical requests arrive concurrently within a 5ms window (e.g. client double-tap or network retry race):

1. Both requests execute `SELECT` and find nothing.
2. Both evaluate `row is None`.
3. Both attempt `INSERT INTO idempotency_records`.
4. The second request crashes with a PostgreSQL `UniqueViolationError` (23505), throwing an unhandled 500 error instead of cleanly returning `status: "conflict"`.

---

## Required Remediation Action Items

```
+-----------------------------------------------------------------------------------------------+
|                                  ARCHITECTURAL FIX ROADMAP                                    |
+-----------------------------------------------------------------------------------------------+
|  1. Fast Lane Client Pool   │ Create a global singleton `httpx.AsyncClient` lifecycle in      |
|                             │ `backend/app/main.py` with keep-alive limits and 350ms timeout.  |
+-----------------------------+-----------------------------------------------------------------+
|  2. Grounded Fallback Fix   │ Remove the silent mock fallback from `book_event` when in live  |
|                             │ mode. Fail explicitly with `status="error"` on Google failure.  |
+-----------------------------+-----------------------------------------------------------------+
|  3. Enforce Mutating Locks  │ Add `MUTATING_TOOLS` check in `api/tools.py`. If key is missing  |
|                             │ for mutating tools, reject immediately with HTTP 400.           |
+-----------------------------+-----------------------------------------------------------------+
|  4. Atomic SQL Lock         │ Use `INSERT ... ON CONFLICT (key) DO NOTHING` in                |
|                             │ `db/idempotency.py` to eliminate concurrent lock race conditions.|
+-----------------------------------------------------------------------------------------------+
```

### Specific Code Changes Required

1. **Pre-warmed Client Pool:**
   - In `backend/app/main.py`: Create a global `app.state.http_client = httpx.AsyncClient(limits=httpx.Limits(max_keepalive_connections=20, max_connections=50), timeout=0.35)` during startup lifespan.
   - Inject this shared client into `google_calendar.py` instead of creating `async with httpx.AsyncClient()`.
   - In `agent/agent.py`: Initialize a single global `AsyncClient` on startup.

2. **Grounded Confirmation Fix:**
   - In `backend/app/tools/calendar.py`: If `settings.google_client_id` is configured and `book_google_calendar_event()` fails or returns `None`, raise an explicit `RuntimeError("Google Calendar event creation failed. The meeting was not scheduled.")` so the dispatcher returns `status: "error"`.
   - Never fall back to fake mock event IDs when live credentials are active.

3. **Strict Idempotency Validation:**
   - In `backend/app/api/tools.py`:
     ```python
     STATE_MODIFYING_TOOLS = {"book_event", "cancel_task"}
     if tool_name in STATE_MODIFYING_TOOLS and not idempotency_key:
         raise HTTPException(
             status_code=400,
             detail=f"idempotency_key is required for state-modifying action '{tool_name}'",
         )
     ```
   - In `agent/agent.py`: Only inject `idempotency_key` for `STATE_MODIFYING_TOOLS`. Leave it `None` for read operations.
