# Archived Project Notes: Calendar DB Persistence for AI Voice Bot

> **Historical only — not the current architecture or implementation contract.**
> This document records an earlier single-user calendar implementation. Its
> `user_id` parameters, shared demo UUID examples, schema description, and
> migration/test status are superseded and must not be copied into active code.
> The current source of truth is [the implementation roadmap](docs/IMPLEMENTATION_ROADMAP.md),
> [implementation status](docs/IMPLEMENTATION_STATUS.md), and
> [QA/security review](docs/QA-review.md). Tenant identity now comes from
> verified Neon Auth sessions and company-scoped authorization.

## Architecture
- **Database Layer**: Neon Serverless PostgreSQL (`divine-hat-17233837`), managed via `asyncpg`. Pooled connection (`DATABASE_URL`) with `statement_cache_size=0` for runtime queries; unpooled direct connection (`DATABASE_URL_UNPOOLED`) for migrations and DDL.
- **Migration Engine**: `db/migrations/` containing sequential SQL migrations (`001_initial_schema.sql`, `002_calendar_events.sql`) applied via `db/run_migrations.py`.
- **API & Dispatch Layer**: FastAPI router in `backend/app/api/tools.py` dispatching tool requests (`POST /tools/execute`), injecting `request.user_id`, enforcing schema validation, handling idempotency locks, and formatting `success`, `conflict`, and `error` responses.
- **Tool Logic**: `backend/app/tools/calendar.py` executing `book_event`, `get_calendar_availability`, and `cancel_event` with transaction advisory locks, interval math, and dual-speed state logging into `tasks`.
- **Testing Layer**: Pytest suite in `backend/tests/test_calendar_db.py` exercising the full lifecycle against Neon DB with isolated test user UUIDs.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Calendar Events Schema (R1) | DDL in `002_calendar_events.sql` with UUID PK, constraints, composite indexes, and auto-update timestamp trigger | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Connection Sanitization & Migration Runner | Fix `asyncpg` DSN query parameter handling in `db/connection.py` and implement `db/run_migrations.py` | M1 | Survey Findings |
| 3 | Context & User Injection | Inject `request.user_id` into calendar tools and support `user_id` in parameter schemas | M2 | Survey Findings |
| 4 | Atomic Booking & Zero Double-Booking (R2) | Atomic transaction booking with `pg_advisory_xact_lock`, overlap query check, and structured conflict response | M2 | ORIGINAL_REQUEST §R2 |
| 5 | Booking Audit Logging | Persist booking record in `calendar_events` and emit audit task to `tasks` table | M2 | ORIGINAL_REQUEST §R2, §AC2 |
| 6 | Idempotent Booking Replay | Replay with identical `idempotency_key` returns previous booking without duplicate database rows | M2 | ORIGINAL_REQUEST §Task Summary |
| 7 | Dynamic Availability Computation (R3) | Query `user_preferences` for working hours/timezone, query confirmed events, subtract occupied periods, return free slots | M3 | ORIGINAL_REQUEST §R3 |
| 8 | Soft Deletion & Audit Trail (R4) | Soft delete via `status='cancelled'` and `cancelled_at=NOW()`, emit audit event to `tasks`, and restore slot availability | M4 | ORIGINAL_REQUEST §R4 |
| 9 | Confirmation Gate Handling | Preserve ANE-03 confirmation check for `cancel_event` when `confirm=False` | M4 | Survey Findings |
| 10 | E2E Test Harness & Suite | Setup `backend/tests/` (`pytest.ini`, `conftest.py`, `test_calendar_db.py`) covering all acceptance criteria | E2E Test Track | ORIGINAL_REQUEST §AC1-6 |
| 11 | Neon DB Live Migration & Integration Pass | Run migration against `divine-hat-17233837` and pass 100% of integration tests | Final Milestone | ORIGINAL_REQUEST §AC1, §AC6 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Database Schema & Migration | Create `db/migrations/002_calendar_events.sql`, fix `db/connection.py` DSN parsing, create `db/run_migrations.py` | None | DONE |
| M2 | Atomic Booking & Concurrency Lock | Update `backend/app/tools/calendar.py` `book_event`, update `backend/app/api/tools.py` context injection & conflict handling, update schemas | M1 | DONE |
| M3 | Dynamic Availability Computation | Update `backend/app/tools/calendar.py` `get_calendar_availability` to query `user_preferences` and subtract occupied intervals | M1, M2 | DONE |
| M4 | Soft Deletion & Audit Trail | Update `backend/app/tools/calendar.py` `cancel_event` to set `status='cancelled'`, `cancelled_at=NOW()`, emit `tasks` audit record | M1, M2 | DONE |
| M-TEST | E2E Test Suite Development | Install test dependencies, create `pytest.ini`, `conftest.py`, and 7 integration test cases in `backend/tests/test_calendar_db.py` -> publish `TEST_READY.md` | M1 | DONE |
| M-FINAL | Verification & Adversarial Hardening | Run migrations on Neon DB (`divine-hat-17233837`), verify 100% pass of `test_calendar_db.py`, adversarial stress testing, and forensic audit | M1, M2, M3, M4, M-TEST | DONE |

## Interface Contracts
### `backend/app/tools/calendar.py` ↔ `backend/app/api/tools.py`
- `book_event(title: str, start_time: str, duration_minutes: int = 30, attendees: Optional[List[str]] = None, user_id: str = "00000000-0000-0000-0000-000000000001", session_id: Optional[str] = None) -> Dict[str, Any]`
  - Success returns: `{"id": UUID_str, "title": str, "start_time": ISO_str, "end_time": ISO_str, "duration_minutes": int, "attendees": list, "meet_link": str, "status": "confirmed"}`
  - Conflict returns: `{"status": "conflict", "error": "Slot already occupied", "conflicting_event": {...}, "next_available_slot": ISO_str}`
- `get_calendar_availability(start_date: str, end_date: Optional[str] = None, user_id: str = "00000000-0000-0000-0000-000000000001") -> Dict[str, Any]`
  - Returns: `{"user_id": str, "start_date": str, "end_date": str, "available_slots": List[str]}` (slots in ISO 8601 UTC)
- `cancel_event(event_id: str, reason: Optional[str] = None, confirm: bool = False, user_id: str = "00000000-0000-0000-0000-000000000001") -> Dict[str, Any]`
  - If `confirm=False`: returns `{"status": "confirmation_required", "message": "...", "event_id": event_id}`
  - If `confirm=True`: soft deletes and returns `{"event_id": event_id, "status": "cancelled", "cancelled_at": ISO_str}`

### `backend/app/tools/calendar.py` ↔ `calendar_events` & `tasks`
- Table `calendar_events`:
  - `id UUID PRIMARY KEY`, `user_id UUID NOT NULL`, `title VARCHAR(255)`, `start_time TIMESTAMPTZ`, `end_time TIMESTAMPTZ`, `duration_minutes INT`, `attendees JSONB`, `meet_link VARCHAR`, `status VARCHAR(32)`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`, `cancelled_at TIMESTAMPTZ`
- Table `tasks` (Audit):
  - `id UUID PRIMARY KEY`, `user_id UUID NOT NULL`, `title VARCHAR(255)`, `status 'completed'`, `tool_name 'book_event' | 'cancel_event'`, `input_parameters JSONB`, `output_result JSONB`

## Code Layout
- `db/migrations/002_calendar_events.sql` — Neon PostgreSQL DDL for calendar events table, indexes, and triggers
- `db/connection.py` — Asyncpg connection pooling with DSN query param sanitization and SSL handling
- `db/run_migrations.py` — Database migration runner script
- `backend/app/tools/calendar.py` — Calendar tool business logic with atomic transactions and Neon DB persistence
- `backend/app/api/tools.py` — Tool execution router with context injection and conflict response mapping
- `backend/app/schemas/tools.py` — Pydantic models for tool execution parameters and responses
- `backend/tests/conftest.py` — Pytest fixtures for DB pool, isolated test user, and cleanup
- `backend/tests/test_calendar_db.py` — Integration test suite verifying R1, R2, R3, R4 against live Neon DB
- `pytest.ini` — Pytest configuration
