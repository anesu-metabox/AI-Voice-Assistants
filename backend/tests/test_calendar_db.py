"""
End-to-End Integration Tests for Calendar Database Persistence (R1-R4)
Tests against live Neon Serverless PostgreSQL with strict tenant data isolation.

Acceptance Criteria Tested:
- AC1 / R1: Table schema, constraints, composite indexes, updated_at trigger in Neon DB.
- AC2 / R2: book_event persistence in calendar_events and audit logging in tasks.
- AC3 / R3: Dynamic availability excluding booked intervals.
- AC4 / R2: Atomic concurrency control, zero double-booking, and structured conflict response.
- Task Summary: Idempotent booking replay with identical idempotency_key.
- AC5 / R4: Soft-deletion (status='cancelled', cancelled_at=NOW()), task audit, and slot restoration.
- ANE-03: Destructive action confirmation gate interceptor for cancel_event.
"""

import asyncio
from datetime import datetime, timezone
import json
from typing import Any, Dict, List
import uuid

import asyncpg
import httpx
import pytest


pytestmark = pytest.mark.skip(
    reason=(
        "Legacy local-calendar persistence suite: the production contract now requires "
        "a tenant-owned Google Calendar integration and no longer uses the local fallback."
    )
)


def parse_utc_dt(ts: str) -> datetime:
    """
    Parse ISO timestamp to timezone-aware UTC datetime for invariant comparisons.
    """
    cleaned = ts.replace("Z", "+00:00")
    dt = datetime.fromisoformat(cleaned)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def contains_slot(target_slot: str, slot_list: List[str]) -> bool:
    """
    Check if a target timestamp exists in slot_list regardless of Z vs +00:00 representation.
    """
    target_dt = parse_utc_dt(target_slot)
    for slot_str in slot_list:
        try:
            if parse_utc_dt(slot_str) == target_dt:
                return True
        except Exception:
            if slot_str == target_slot:
                return True
    return False


# ==============================================================================
# Test 1: Schema & Migration Verification (R1)
# ==============================================================================
@pytest.mark.asyncio
async def test_calendar_events_schema_and_migration(db_pool: asyncpg.Pool):
    """
    R1: Verify that calendar_events exists in Neon PostgreSQL with:
    - Primary key id UUID
    - Required columns and data types
    - NOT NULL constraints
    - Check constraint on status IN ('confirmed', 'cancelled')
    - Composite index on (user_id, start_time)
    - Auto-updating updated_at trigger
    """
    async with db_pool.acquire() as conn:
        # 1. Verify table exists
        table_exists = await conn.fetchval(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = 'calendar_events'
            );
            """
        )
        assert table_exists is True, "Table 'calendar_events' does not exist in Neon DB."

        # 2. Verify columns and data types
        columns_info = await conn.fetch(
            """
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'calendar_events';
            """
        )
        col_map = {row["column_name"]: row for row in columns_info}

        required_columns = {
            "id": "uuid",
            "user_id": "uuid",
            "title": "character varying",
            "start_time": "timestamp with time zone",
            "end_time": "timestamp with time zone",
            "duration_minutes": "integer",
            "attendees": "jsonb",
            "meet_link": "character varying",
            "status": "character varying",
            "created_at": "timestamp with time zone",
            "updated_at": "timestamp with time zone",
            "cancelled_at": "timestamp with time zone",
        }

        for col_name, expected_type in required_columns.items():
            assert col_name in col_map, f"Missing required column '{col_name}' in calendar_events"
            assert col_map[col_name]["data_type"] == expected_type, (
                f"Column '{col_name}' type mismatch: expected {expected_type}, got {col_map[col_name]['data_type']}"
            )

        # 3. Check NOT NULL constraints
        for required_not_null in ["id", "user_id", "title", "start_time", "end_time", "duration_minutes", "status"]:
            assert col_map[required_not_null]["is_nullable"] == "NO", (
                f"Column '{required_not_null}' must have NOT NULL constraint"
            )

        # 4. Verify composite index on (user_id, start_time)
        indexes = await conn.fetch(
            """
            SELECT indexname, indexdef 
            FROM pg_indexes 
            WHERE schemaname = 'public' AND tablename = 'calendar_events';
            """
        )
        index_defs = [row["indexdef"] for row in indexes]
        has_user_start_idx = any(
            ("user_id" in idef and "start_time" in idef)
            for idef in index_defs
        )
        assert has_user_start_idx, (
            f"Composite index on (user_id, start_time) not found in indexes: {index_defs}"
        )

        # 5. Verify updated_at auto-update trigger attached
        triggers = await conn.fetch(
            """
            SELECT trigger_name 
            FROM information_schema.triggers 
            WHERE event_object_table = 'calendar_events';
            """
        )
        trigger_names = [row["trigger_name"] for row in triggers]
        has_update_trigger = any("updated_at" in name.lower() for name in trigger_names)
        assert has_update_trigger, f"Auto-update trigger not found on calendar_events: {trigger_names}"


# ==============================================================================
# Test 2: Book Event Persistence & Task Audit Trail (R2, AC2)
# ==============================================================================
@pytest.mark.asyncio
async def test_book_event_persists_to_db_and_emits_task(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    R2/AC2: Verify that invoking book_event via POST /tools/execute:
    1. Returns HTTP 200 with status='success'
    2. Returns confirmed event payload with valid UUID id/event_id and meet_link
    3. Persists row in calendar_events table with status='confirmed'
    4. Records execution audit record in tasks table
    """
    start_time_iso = "2026-10-15T10:00:00Z"
    request_payload = {
        "tool_name": "book_event",
        "user_id": test_user_id,
        "parameters": {
            "title": "Quarterly Sprint Alignment",
            "start_time": start_time_iso,
            "duration_minutes": 45,
            "attendees": ["anesu@metabox.ai", "lead@metabox.ai"],
            "description": "Aligning roadmap priorities",
            "location": "Google Meet",
        },
    }

    response = await async_client.post("/tools/execute", json=request_payload)
    assert response.status_code == 200, f"API error: {response.text}"
    body = response.json()
    assert body["status"] == "success", f"Expected 'success', got {body}"

    data = body["data"]
    event_id = data.get("event_id") or data.get("id")
    assert event_id is not None, "Missing event identifier in response"
    assert data["status"] == "confirmed"
    assert data["duration_minutes"] == 45
    assert data.get("meet_link") is not None and "meet" in data["meet_link"]

    # Verify direct Neon DB persistence in calendar_events
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, user_id, title, start_time, end_time, duration_minutes,
                   attendees, meet_link, status, created_at, updated_at, cancelled_at
            FROM calendar_events
            WHERE id = $1 AND user_id = $2;
            """,
            uuid.UUID(event_id),
            uuid.UUID(test_user_id),
        )
        assert row is not None, f"Event {event_id} was not persisted in Neon DB"
        assert row["title"] == "Quarterly Sprint Alignment"
        assert row["duration_minutes"] == 45
        assert row["status"] == "confirmed"
        assert row["cancelled_at"] is None
        assert row["created_at"] is not None
        assert row["updated_at"] is not None

        # Verify audit log in tasks table
        task_row = await conn.fetchrow(
            """
            SELECT id, user_id, status, tool_name, output_result
            FROM tasks
            WHERE user_id = $1 AND tool_name = 'book_event'
            ORDER BY created_at DESC
            LIMIT 1;
            """,
            uuid.UUID(test_user_id),
        )
        assert task_row is not None, "Audit record was not written to tasks table"
        assert task_row["status"] == "completed"


# ==============================================================================
# Test 3: Dynamic Availability Computation (R3, AC3)
# ==============================================================================
@pytest.mark.asyncio
async def test_dynamic_availability_excludes_booked_slots(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    R3/AC3: Verify that querying get_calendar_availability dynamically queries
    calendar_events and subtracts occupied intervals:
    1. Query baseline availability for 2026-10-16.
    2. Book a confirmed event for 2026-10-16T10:00:00Z (duration: 60 min).
    3. Query availability again and assert 10:00:00Z and 10:30:00Z are excluded.
    4. Assert adjacent free slots remain present.
    """
    target_date = "2026-10-16"
    slot_to_book = f"{target_date}T10:00:00Z"

    # 1. Baseline availability query
    baseline_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "get_calendar_availability",
            "user_id": test_user_id,
            "parameters": {
                "start_date": target_date,
                "end_date": target_date,
                "duration_minutes": 30,
            },
        },
    )
    assert baseline_resp.status_code == 200
    baseline_data = baseline_resp.json()
    assert baseline_data["status"] == "success"
    initial_slots = baseline_data["data"]["available_slots"]
    assert len(initial_slots) > 0, "Initial availability slots should not be empty"

    # 2. Book an event at the slot
    book_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Product Sync",
                "start_time": slot_to_book,
                "duration_minutes": 60,
            },
        },
    )
    assert book_resp.status_code == 200
    assert book_resp.json()["status"] == "success"

    # 3. Query availability after booking
    post_booking_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "get_calendar_availability",
            "user_id": test_user_id,
            "parameters": {
                "start_date": target_date,
                "end_date": target_date,
                "duration_minutes": 30,
            },
        },
    )
    assert post_booking_resp.status_code == 200
    post_booking_data = post_booking_resp.json()
    assert post_booking_data["status"] == "success"
    updated_slots = post_booking_data["data"]["available_slots"]

    # 4. Assert booked interval slots are excluded
    assert not contains_slot(slot_to_book, updated_slots), (
        f"Slot {slot_to_book} was not excluded from available slots after booking: {updated_slots}"
    )
    # The 10:30 slot falls inside the 60-minute booking window (10:00 - 11:00)
    overlapping_sub_slot = f"{target_date}T10:30:00Z"
    assert not contains_slot(overlapping_sub_slot, updated_slots), (
        f"Sub-interval slot {overlapping_sub_slot} should be excluded during 60-min booking"
    )

    # Free slots outside the booking interval must still be available
    assert len(updated_slots) < len(initial_slots), (
        "Available slots count should decrease after booking"
    )


# ==============================================================================
# Test 4: Atomic Concurrency & Zero Double-Booking (R2, AC4)
# ==============================================================================
@pytest.mark.asyncio
async def test_atomic_booking_concurrency_and_conflict_handling(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    R2/AC4: Verify atomic booking with concurrency locks and conflict handling:
    1. Sequential overlap: Booking Event 1 (14:00 - 15:00), then attempting Event 2 (14:30 - 15:00).
       Assert Event 2 returns status='conflict' with structured conflict information.
    2. Concurrent race: Send two simultaneous requests for the exact same slot via asyncio.gather.
       Assert exactly one succeeds with status='success' and the other returns status='conflict'.
    3. Verify Neon DB maintains exactly the confirmed events with zero corrupt records.
    """
    slot_overlap_start = "2026-10-17T14:00:00Z"

    # 1. Book first event (14:00 to 15:00)
    resp1 = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Primary Reserved Slot",
                "start_time": slot_overlap_start,
                "duration_minutes": 60,
            },
        },
    )
    assert resp1.status_code == 200
    assert resp1.json()["status"] == "success"

    # 2. Attempt overlapping booking (14:30 to 15:00)
    resp2 = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Conflicting Overlapping Slot",
                "start_time": "2026-10-17T14:30:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert resp2.status_code == 200
    body2 = resp2.json()
    # Contract: response status or payload status is 'conflict'
    is_conflict = (
        body2["status"] == "conflict"
        or (body2.get("data") and body2["data"].get("status") == "conflict")
    )
    assert is_conflict, f"Expected conflict status for overlapping booking, got {body2}"
    conflict_payload = body2.get("data") or body2
    assert (
        "conflict" in str(conflict_payload).lower()
        or "occupied" in str(conflict_payload).lower()
    ), f"Expected conflict details in payload: {conflict_payload}"

    # 3. True concurrent booking race condition test
    concurrent_slot = "2026-10-18T16:00:00Z"

    async def _send_concurrent_booking(index: int):
        return await async_client.post(
            "/tools/execute",
            json={
                "tool_name": "book_event",
                "user_id": test_user_id,
                "parameters": {
                    "title": f"Race Candidate {index}",
                    "start_time": concurrent_slot,
                    "duration_minutes": 30,
                },
            },
        )

    results = await asyncio.gather(_send_concurrent_booking(1), _send_concurrent_booking(2))
    statuses = []
    for r in results:
        b = r.json()
        if b["status"] == "success" and b.get("data", {}).get("status") != "conflict":
            statuses.append("success")
        elif b["status"] == "conflict" or (b.get("data") and b["data"].get("status") == "conflict"):
            statuses.append("conflict")
        else:
            statuses.append(b["status"])

    assert statuses.count("success") == 1, f"Expected exactly 1 success in race, got: {statuses}"
    assert statuses.count("conflict") == 1, f"Expected exactly 1 conflict in race, got: {statuses}"

    # 4. Verify DB integrity: only 2 confirmed rows exist for this user in total
    async with db_pool.acquire() as conn:
        count = await conn.fetchval(
            """
            SELECT COUNT(*) FROM calendar_events 
            WHERE user_id = $1 AND status = 'confirmed';
            """,
            uuid.UUID(test_user_id),
        )
        assert count == 2, f"Expected exactly 2 confirmed events in DB, found {count}"


# ==============================================================================
# Test 5: Idempotent Booking Replay (ADR-004)
# ==============================================================================
@pytest.mark.asyncio
async def test_idempotent_booking_replay(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    ADR-004: Verify that providing an idempotency_key prevents duplicate writes
    and returns cached payload on network replay:
    1. Send book_event request with unique idempotency_key.
    2. Capture event_id and response data.
    3. Replay exact same request with identical idempotency_key.
    4. Assert response is identical.
    5. Assert Neon DB contains exactly 1 row in calendar_events.
    """
    idempotency_key = f"idemp_{uuid.uuid4().hex}"
    request_payload = {
        "tool_name": "book_event",
        "user_id": test_user_id,
        "idempotency_key": idempotency_key,
        "parameters": {
            "title": "Idempotent Executive Review",
            "start_time": "2026-10-19T11:00:00Z",
            "duration_minutes": 30,
            "attendees": ["alex@metabox.ai"],
        },
    }

    # First execution
    resp1 = await async_client.post("/tools/execute", json=request_payload)
    assert resp1.status_code == 200
    body1 = resp1.json()
    assert body1["status"] == "success"
    event_id1 = body1["data"].get("event_id") or body1["data"].get("id")
    assert event_id1 is not None

    # Second execution (Replay)
    resp2 = await async_client.post("/tools/execute", json=request_payload)
    assert resp2.status_code == 200
    body2 = resp2.json()
    assert body2["status"] == "success"
    event_id2 = body2["data"].get("event_id") or body2["data"].get("id")

    # Both responses must reference the same booked event
    assert event_id1 == event_id2, "Replayed request returned a different event_id"

    # Verify exactly 1 database row exists in calendar_events
    async with db_pool.acquire() as conn:
        event_count = await conn.fetchval(
            "SELECT COUNT(*) FROM calendar_events WHERE user_id = $1;",
            uuid.UUID(test_user_id),
        )
        assert event_count == 1, (
            f"Expected exactly 1 row in calendar_events for idempotent key, found {event_count}"
        )

        # Verify idempotency record state
        idemp_row = await conn.fetchrow(
            "SELECT status, tool_name FROM idempotency_records WHERE key = $1;",
            idempotency_key,
        )
        if idemp_row:
            assert idemp_row["status"] == "committed"


# ==============================================================================
# Test 6: Soft Deletion & Availability Restoration (R4, AC5)
# ==============================================================================
@pytest.mark.asyncio
async def test_cancel_event_soft_delete_and_restores_availability(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    R4/AC5: Verify that cancelling an event with confirm=True:
    1. Books an initial event for 2026-10-20T15:00:00Z.
    2. Cancels it with confirm=True.
    3. Soft-deletes: sets status='cancelled' and cancelled_at=NOW() in calendar_events.
    4. Records task audit trail in tasks table.
    5. Restores slot availability in get_calendar_availability.
    """
    target_date = "2026-10-20"
    slot_time = f"{target_date}T15:00:00Z"

    # 1. Book initial event
    book_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Strategy Review to Cancel",
                "start_time": slot_time,
                "duration_minutes": 30,
            },
        },
    )
    assert book_resp.status_code == 200
    book_data = book_resp.json()
    assert book_data["status"] == "success"
    event_id = book_data["data"].get("event_id") or book_data["data"].get("id")

    # Verify slot is occupied prior to cancellation
    avail_before = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "get_calendar_availability",
            "user_id": test_user_id,
            "parameters": {"start_date": target_date, "end_date": target_date},
        },
    )
    slots_before = avail_before.json()["data"]["available_slots"]
    assert not contains_slot(slot_time, slots_before)

    # 2. Request confirmation, then cancel with the issued single-use token.
    gate_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "cancel_event",
            "user_id": test_user_id,
            "parameters": {
                "event_id": str(event_id),
                "reason": "Client requested cancellation",
                "confirm": False,
            },
        },
    )
    confirmation_token = gate_resp.json()["data"]["confirmation_token"]

    cancel_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "cancel_event",
            "user_id": test_user_id,
            "parameters": {
                "event_id": str(event_id),
                "reason": "Client requested cancellation",
                "confirm": True,
                "confirmation_token": confirmation_token,
            },
        },
    )
    assert cancel_resp.status_code == 200
    cancel_body = cancel_resp.json()
    assert cancel_body["status"] == "success"
    cancel_data = cancel_body["data"]
    assert cancel_data["status"] == "cancelled"
    assert cancel_data.get("cancelled_at") is not None

    # 3. Direct DB verification: soft delete preserved, status='cancelled'
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, user_id, status, cancelled_at, updated_at
            FROM calendar_events
            WHERE id = $1 AND user_id = $2;
            """,
            uuid.UUID(str(event_id)),
            uuid.UUID(test_user_id),
        )
        assert row is not None, "Event row was physically deleted! Must be soft-deleted."
        assert row["status"] == "cancelled"
        assert row["cancelled_at"] is not None

        # 4. Verify audit record in tasks table
        task_row = await conn.fetchrow(
            """
            SELECT id, user_id, tool_name, status
            FROM tasks
            WHERE user_id = $1 AND tool_name = 'cancel_event'
            ORDER BY created_at DESC
            LIMIT 1;
            """,
            uuid.UUID(test_user_id),
        )
        assert task_row is not None, "Audit record for cancel_event not found in tasks"
        assert task_row["status"] == "completed"

    # 5. Availability restoration check: slot is available again
    avail_after = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "get_calendar_availability",
            "user_id": test_user_id,
            "parameters": {"start_date": target_date, "end_date": target_date},
        },
    )
    slots_after = avail_after.json()["data"]["available_slots"]
    assert contains_slot(slot_time, slots_after), (
        f"Slot {slot_time} was not restored to available slots after cancellation: {slots_after}"
    )


# ==============================================================================
# Test 7: Confirmation Protocol Gating (ANE-03)
# ==============================================================================
@pytest.mark.asyncio
async def test_cancel_event_confirmation_gate(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    ANE-03: Verify that destructive cancel_event without confirm=True is intercepted
    by the confirmation gate:
    1. Books an event.
    2. Calls cancel_event with confirm=False.
    3. Assert response status='confirmation_required' with token and prompt_to_speak.
    4. Direct DB verification: event remains status='confirmed' and cancelled_at is NULL.
    """
    # 1. Book an event
    book_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Gated Event Test",
                "start_time": "2026-10-21T09:30:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert book_resp.status_code == 200
    book_data = book_resp.json()
    assert book_data["status"] == "success"
    event_id = book_data["data"].get("event_id") or book_data["data"].get("id")

    # 2. Attempt cancel without confirmation (confirm=False)
    gate_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "cancel_event",
            "user_id": test_user_id,
            "parameters": {
                "event_id": str(event_id),
                "confirm": False,
            },
        },
    )
    assert gate_resp.status_code == 200
    gate_body = gate_resp.json()
    assert gate_body["status"] == "confirmation_required", (
        f"Expected 'confirmation_required', got {gate_body}"
    )

    gate_data = gate_body["data"]
    assert gate_data.get("confirmation_token") is not None, "Missing confirmation token"
    assert "confirm" in gate_data.get("prompt_to_speak", "").lower() or (
        "cancel" in gate_data.get("prompt_to_speak", "").lower()
    ), f"Unexpected prompt: {gate_data.get('prompt_to_speak')}"

    # 3. Direct DB verification: event must remain confirmed and untampered
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, cancelled_at FROM calendar_events WHERE id = $1;",
            uuid.UUID(str(event_id)),
        )
        assert row is not None
        assert row["status"] == "confirmed", (
            f"Event status was altered without confirmation: {row['status']}"
        )
        assert row["cancelled_at"] is None, "cancelled_at must be NULL when gate intercepts"
