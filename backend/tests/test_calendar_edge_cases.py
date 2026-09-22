"""
Adversarial Edge Case & Boundary Verification Suite for Calendar Database Persistence
Authored by Challenger 2 (Edge Case & Boundary Challenger)

Tests against live Neon PostgreSQL (divine-hat-17233837) with strict tenant isolation.
Adversarial vectors tested:
1. Adjacent slot bookings (touching boundaries: end_time == start_time must NOT conflict)
2. Partial overlaps (left and right boundary penetrations)
3. Enclosing overlaps (superset interval engulfing existing booking)
4. Contained overlaps (subset interval nested inside existing booking)
5. Non-standard durations (15m, 45m, 90m, min 5m)
6. Day boundary bookings (09:00 start of day, 16:30 end of day)
7. Immediate re-booking of cancelled slots (verifying soft-delete exclusions)
8. Bridge overlap across multiple contiguous bookings
9. Schema boundary constraints (duration < 5, > 480)
10. Custom user preferences working hours availability computation
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
        "Legacy local-calendar edge suite: overlap behavior now belongs to the connected "
        "Google Calendar provider, not a local fallback store."
    )
)


def parse_utc_dt(ts: str) -> datetime:
    """Parse ISO timestamp to timezone-aware UTC datetime."""
    cleaned = ts.replace("Z", "+00:00")
    dt = datetime.fromisoformat(cleaned)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def contains_slot(target_slot: str, slot_list: List[str]) -> bool:
    """Check if target slot timestamp is present in slot list."""
    target_dt = parse_utc_dt(target_slot)
    for s in slot_list:
        try:
            if parse_utc_dt(s) == target_dt:
                return True
        except Exception:
            if s == target_slot:
                return True
    return False


# ==============================================================================
# Edge Case 1: Adjacent Slots (Touching Boundary)
# ==============================================================================
@pytest.mark.asyncio
async def test_edge_adjacent_slot_touching_boundaries(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    Verify that touching boundaries (end_time == start_time) are NOT treated as conflicts.
    Booking A: 10:00 - 10:30
    Booking B: 10:30 - 11:00 (immediately adjacent after)
    Booking C: 09:30 - 10:00 (immediately adjacent before)
    All three must succeed. In Neon DB, exactly 3 confirmed rows must exist.
    """
    # 1. Book Event A (10:00 - 10:30)
    resp_a = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Adjacent Anchor Meeting A",
                "start_time": "2026-11-02T10:00:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert resp_a.status_code == 200
    assert resp_a.json()["status"] == "success"

    # 2. Book Event B immediately adjacent after (10:30 - 11:00)
    resp_b = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Adjacent Meeting B (After)",
                "start_time": "2026-11-02T10:30:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert resp_b.status_code == 200
    body_b = resp_b.json()
    assert body_b["status"] == "success", f"Adjacent slot after was rejected: {body_b}"

    # 3. Book Event C immediately adjacent before (09:30 - 10:00)
    resp_c = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Adjacent Meeting C (Before)",
                "start_time": "2026-11-02T09:30:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert resp_c.status_code == 200
    body_c = resp_c.json()
    assert body_c["status"] == "success", f"Adjacent slot before was rejected: {body_c}"

    # Verify Neon DB rows
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, title, start_time, end_time, status
            FROM calendar_events
            WHERE user_id = $1 AND status = 'confirmed'
            ORDER BY start_time ASC;
            """,
            uuid.UUID(test_user_id),
        )
        assert len(rows) == 3, f"Expected exactly 3 confirmed rows, found {len(rows)}"

    # Check availability: 09:30, 10:00, 10:30 are occupied; 09:00 and 11:00 are available
    avail_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "get_calendar_availability",
            "user_id": test_user_id,
            "parameters": {
                "start_date": "2026-11-02",
                "end_date": "2026-11-02",
                "duration_minutes": 30,
            },
        },
    )
    assert avail_resp.status_code == 200
    slots = avail_resp.json()["data"]["available_slots"]
    assert not contains_slot("2026-11-02T09:30:00Z", slots)
    assert not contains_slot("2026-11-02T10:00:00Z", slots)
    assert not contains_slot("2026-11-02T10:30:00Z", slots)
    assert contains_slot("2026-11-02T09:00:00Z", slots)
    assert contains_slot("2026-11-02T11:00:00Z", slots)


# ==============================================================================
# Edge Case 2: Partial Overlaps (Left and Right)
# ==============================================================================
@pytest.mark.asyncio
async def test_edge_partial_overlaps_left_and_right(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    Given Base event: 10:00 - 10:30.
    1. Attempt Left Overlap: 09:45 - 10:15 (starts before, ends inside Base).
       Must be rejected as conflict.
    2. Attempt Right Overlap: 10:15 - 10:45 (starts inside Base, ends after).
       Must be rejected as conflict.
    Verify only 1 confirmed row exists in DB.
    """
    # 1. Book Base event
    base_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Base Anchor Meeting",
                "start_time": "2026-11-03T10:00:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert base_resp.status_code == 200
    assert base_resp.json()["status"] == "success"

    # 2. Attempt Left Overlap (09:45 - 10:15)
    left_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Left Overlapping Attempt",
                "start_time": "2026-11-03T09:45:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert left_resp.status_code == 200
    body_left = left_resp.json()
    assert body_left["status"] == "conflict"
    assert body_left.get("error_code") == "SLOT_CONFLICT"
    assert "occupied" in str(body_left).lower() or "conflict" in str(body_left).lower()

    # 3. Attempt Right Overlap (10:15 - 10:45)
    right_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Right Overlapping Attempt",
                "start_time": "2026-11-03T10:15:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert right_resp.status_code == 200
    body_right = right_resp.json()
    assert body_right["status"] == "conflict"
    assert body_right.get("error_code") == "SLOT_CONFLICT"

    # Verify only Base exists in DB
    async with db_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM calendar_events WHERE user_id = $1 AND status = 'confirmed';",
            uuid.UUID(test_user_id),
        )
        assert count == 1, f"Expected exactly 1 confirmed row, found {count}"


# ==============================================================================
# Edge Case 3: Enclosing Overlap (Superset Booking)
# ==============================================================================
@pytest.mark.asyncio
async def test_edge_enclosing_overlap(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    Given Base event: 10:00 - 10:30.
    Attempt Enclosing booking: 09:00 - 12:00 (180 minutes).
    The enclosing booking spans before and after Base.
    Must be rejected with status='conflict' and error_code='SLOT_CONFLICT'.
    """
    # 1. Book Base
    base_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Contained Kernel Meeting",
                "start_time": "2026-11-04T10:00:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert base_resp.status_code == 200
    assert base_resp.json()["status"] == "success"

    # 2. Attempt Enclosing (09:00 - 12:00)
    enclosing_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Mega Enclosing Workshop",
                "start_time": "2026-11-04T09:00:00Z",
                "duration_minutes": 180,
            },
        },
    )
    assert enclosing_resp.status_code == 200
    body = enclosing_resp.json()
    assert body["status"] == "conflict"
    assert body.get("error_code") == "SLOT_CONFLICT"
    conflicting = body["data"]["conflicting_event"]
    assert conflicting["title"] == "Contained Kernel Meeting"

    # Direct DB count
    async with db_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM calendar_events WHERE user_id = $1 AND status = 'confirmed';",
            uuid.UUID(test_user_id),
        )
        assert count == 1


# ==============================================================================
# Edge Case 4: Contained Overlap (Subset Booking)
# ==============================================================================
@pytest.mark.asyncio
async def test_edge_contained_overlap(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    Given Base event: 10:00 - 11:00 (60 minutes).
    1. Attempt strict inner subset: 10:10 - 10:20 (10 minutes).
    2. Attempt start-aligned subset: 10:00 - 10:30 (30 minutes).
    3. Attempt end-aligned subset: 10:30 - 11:00 (30 minutes).
    All three must be rejected as conflicts.
    """
    # 1. Book wide Base event (10:00 - 11:00)
    base_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Wide 60m Master Slot",
                "start_time": "2026-11-05T10:00:00Z",
                "duration_minutes": 60,
            },
        },
    )
    assert base_resp.status_code == 200
    assert base_resp.json()["status"] == "success"

    # 2. Strict inner subset (10:10 - 10:20)
    sub1_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Inner Subset 10m",
                "start_time": "2026-11-05T10:10:00Z",
                "duration_minutes": 10,
            },
        },
    )
    assert sub1_resp.status_code == 200
    assert sub1_resp.json()["status"] == "conflict"

    # 3. Start-aligned subset (10:00 - 10:30)
    sub2_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Start-Aligned Subset 30m",
                "start_time": "2026-11-05T10:00:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert sub2_resp.status_code == 200
    assert sub2_resp.json()["status"] == "conflict"

    # 4. End-aligned subset (10:30 - 11:00)
    sub3_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "End-Aligned Subset 30m",
                "start_time": "2026-11-05T10:30:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert sub3_resp.status_code == 200
    assert sub3_resp.json()["status"] == "conflict"


# ==============================================================================
# Edge Case 5: Non-Standard Durations (15m, 45m, 90m, 5m min)
# ==============================================================================
@pytest.mark.asyncio
async def test_edge_non_standard_durations(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    Test booking non-standard meeting lengths:
    - 15 minutes: 09:00 - 09:15
    - 45 minutes: 09:15 - 10:00
    - 90 minutes: 10:00 - 11:30
    - 5 minutes (minimum allowed by schema): 11:30 - 11:35
    Verify that all persist cleanly with exact start/end timestamps and duration_minutes.
    """
    bookings = [
        ("Quick Standup 15m", "2026-11-06T09:00:00Z", 15, "2026-11-06T09:15:00Z"),
        ("Design Jam 45m", "2026-11-06T09:15:00Z", 45, "2026-11-06T10:00:00Z"),
        ("Deep Dive 90m", "2026-11-06T10:00:00Z", 90, "2026-11-06T11:30:00Z"),
        ("Micro Sync 5m", "2026-11-06T11:30:00Z", 5, "2026-11-06T11:35:00Z"),
    ]

    for title, start_ts, dur, exp_end in bookings:
        resp = await async_client.post(
            "/tools/execute",
            json={
                "tool_name": "book_event",
                "user_id": test_user_id,
                "parameters": {
                    "title": title,
                    "start_time": start_ts,
                    "duration_minutes": dur,
                },
            },
        )
        assert resp.status_code == 200, f"Failed for {title}: {resp.text}"
        body = resp.json()
        assert body["status"] == "success"
        data = body["data"]
        assert data["duration_minutes"] == dur
        assert data["start_time"] == start_ts
        assert data["end_time"] == exp_end

    # Query Neon DB to confirm all 4 exist with accurate timestamps
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT title, start_time, end_time, duration_minutes
            FROM calendar_events
            WHERE user_id = $1 AND status = 'confirmed'
            ORDER BY start_time ASC;
            """,
            uuid.UUID(test_user_id),
        )
        assert len(rows) == 4
        assert [r["duration_minutes"] for r in rows] == [15, 45, 90, 5]


# ==============================================================================
# Edge Case 6: Day Boundaries & Working Hours
# ==============================================================================
@pytest.mark.asyncio
async def test_edge_day_boundaries_and_availability(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    Test day boundary conditions against default working hours (09:00 - 17:00 UTC):
    1. Book at exactly 09:00:00Z (start of day, 30m -> ends 09:30).
    2. Book at 16:30:00Z (end of day, 30m -> ends 17:00).
    3. Query availability for the day:
       - 09:00 and 16:30 must NOT be in available_slots.
       - 09:30, 10:00, ..., 16:00 MUST be in available_slots.
       - No slots before 09:00 or starting at/after 17:00.
    """
    target_date = "2026-11-07"

    # 1. Book start of day slot
    resp_start = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Morning Kickoff at Day Start",
                "start_time": f"{target_date}T09:00:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert resp_start.status_code == 200
    assert resp_start.json()["status"] == "success"

    # 2. Book end of day slot
    resp_end = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Evening Wrapup at Day End",
                "start_time": f"{target_date}T16:30:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert resp_end.status_code == 200
    assert resp_end.json()["status"] == "success"

    # 3. Query availability
    avail_resp = await async_client.post(
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
    assert avail_resp.status_code == 200
    avail_data = avail_resp.json()["data"]
    slots = avail_data["available_slots"]

    # Invariants
    assert not contains_slot(f"{target_date}T09:00:00Z", slots), "Day start slot should be excluded"
    assert not contains_slot(f"{target_date}T16:30:00Z", slots), "Day end slot should be excluded"
    assert contains_slot(f"{target_date}T09:30:00Z", slots), "Slot immediately after day start must be free"
    assert contains_slot(f"{target_date}T16:00:00Z", slots), "Slot immediately before day end must be free"

    # Ensure no slot starts before 09:00 or at/after 17:00
    for s in slots:
        dt = parse_utc_dt(s)
        assert dt.hour >= 9, f"Slot {s} is before working hours start (09:00)"
        assert dt.hour < 17, f"Slot {s} is at or after working hours end (17:00)"
        if dt.hour == 16:
            assert dt.minute <= 30


# ==============================================================================
# Edge Case 7: Re-Booking Cancelled Slot (Immediate Reuse)
# ==============================================================================
@pytest.mark.asyncio
async def test_edge_rebooking_cancelled_slots(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    Verify that cancelling an event frees the slot for immediate re-booking:
    1. Book 14:00 - 14:30.
    2. Attempting duplicate while confirmed fails with conflict.
    3. Cancel the event with confirm=True (soft delete).
    4. Immediately re-book the EXACT same slot (14:00 - 14:30).
    5. Re-booking must succeed with new event_id.
    6. Verify Neon DB contains exactly 2 rows for user: 1 cancelled, 1 confirmed.
    """
    target_slot = "2026-11-08T14:00:00Z"

    # 1. Book initial event
    resp1 = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Initial Booking to Cancel",
                "start_time": target_slot,
                "duration_minutes": 30,
            },
        },
    )
    assert resp1.status_code == 200
    body1 = resp1.json()
    assert body1["status"] == "success"
    event_id1 = body1["data"].get("event_id") or body1["data"].get("id")

    # 2. Attempt duplicate booking before cancellation -> must conflict
    dup_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Duplicate Booking Candidate",
                "start_time": target_slot,
                "duration_minutes": 30,
            },
        },
    )
    assert dup_resp.status_code == 200
    assert dup_resp.json()["status"] == "conflict"

    # 3. Cancel initial event with confirm=True
    gate_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "cancel_event",
            "user_id": test_user_id,
            "parameters": {
                "event_id": str(event_id1),
                "reason": "Rescheduling meeting",
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
                "event_id": str(event_id1),
                "reason": "Rescheduling meeting",
                "confirm": True,
                "confirmation_token": confirmation_token,
            },
        },
    )
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["status"] == "success"

    # 4. Re-book the EXACT same slot
    resp2 = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Replacement Booking in Same Slot",
                "start_time": target_slot,
                "duration_minutes": 30,
            },
        },
    )
    assert resp2.status_code == 200
    body2 = resp2.json()
    assert body2["status"] == "success", f"Re-booking cancelled slot failed: {body2}"
    event_id2 = body2["data"].get("event_id") or body2["data"].get("id")
    assert event_id1 != event_id2, "Re-booked event must have a distinct UUID"

    # 5. DB inspection: 1 cancelled row and 1 confirmed row
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, title, status, cancelled_at
            FROM calendar_events
            WHERE user_id = $1
            ORDER BY created_at ASC;
            """,
            uuid.UUID(test_user_id),
        )
        assert len(rows) == 2, f"Expected 2 rows in DB, found {len(rows)}"
        row_map = {str(r["id"]): r for r in rows}

        assert row_map[event_id1]["status"] == "cancelled"
        assert row_map[event_id1]["cancelled_at"] is not None

        assert row_map[event_id2]["status"] == "confirmed"
        assert row_map[event_id2]["cancelled_at"] is None


# ==============================================================================
# Edge Case 8: Bridge Overlap Across Contiguous Bookings
# ==============================================================================
@pytest.mark.asyncio
async def test_edge_bridge_overlap_across_multiple_events(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    Given two contiguous back-to-back bookings:
    Event 1: 10:00 - 10:30
    Event 2: 10:30 - 11:00
    Attempt booking a bridge slot: 10:15 - 10:45 (spans across both events).
    Must be detected as conflict and rejected.
    """
    # 1. Book Event 1 (10:00 - 10:30)
    r1 = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Bridge Test Event 1",
                "start_time": "2026-11-09T10:00:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert r1.status_code == 200
    assert r1.json()["status"] == "success"

    # 2. Book Event 2 (10:30 - 11:00)
    r2 = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Bridge Test Event 2",
                "start_time": "2026-11-09T10:30:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert r2.status_code == 200
    assert r2.json()["status"] == "success"

    # 3. Attempt Bridge Booking (10:15 - 10:45)
    r_bridge = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Bridge Attempt",
                "start_time": "2026-11-09T10:15:00Z",
                "duration_minutes": 30,
            },
        },
    )
    assert r_bridge.status_code == 200
    body_bridge = r_bridge.json()
    assert body_bridge["status"] == "conflict"
    assert body_bridge.get("error_code") == "SLOT_CONFLICT"


# ==============================================================================
# Edge Case 9: Schema Boundary Constraints (Duration Validation)
# ==============================================================================
@pytest.mark.asyncio
async def test_edge_duration_schema_limits(
    async_client: httpx.AsyncClient,
    test_user_id: str,
    clean_test_db: None,
):
    """
    Test schema boundary enforcement on duration_minutes:
    - duration_minutes = 0 -> Must return validation error (status='error', error_code='VALIDATION_ERROR')
    - duration_minutes = -15 -> Must return validation error
    - duration_minutes = 500 (> 480 max) -> Must return validation error
    - duration_minutes = 5 (minimum allowed) -> Must succeed
    """
    # 1. Zero duration
    resp_zero = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Zero Duration Booking",
                "start_time": "2026-11-10T10:00:00Z",
                "duration_minutes": 0,
            },
        },
    )
    body_zero = resp_zero.json()
    assert resp_zero.status_code == 200
    assert body_zero["status"] == "error"
    assert body_zero.get("error_code") == "VALIDATION_ERROR"

    # 2. Negative duration
    resp_neg = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Negative Duration Booking",
                "start_time": "2026-11-10T10:00:00Z",
                "duration_minutes": -15,
            },
        },
    )
    body_neg = resp_neg.json()
    assert body_neg["status"] == "error"
    assert body_neg.get("error_code") == "VALIDATION_ERROR"

    # 3. Excessive duration (> 480 max = 8 hours)
    resp_huge = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Excessive 500m Booking",
                "start_time": "2026-11-10T09:00:00Z",
                "duration_minutes": 500,
            },
        },
    )
    body_huge = resp_huge.json()
    assert body_huge["status"] == "error"
    assert body_huge.get("error_code") == "VALIDATION_ERROR"

    # 4. Valid minimum duration (5 minutes)
    resp_valid_min = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Valid Min Duration 5m",
                "start_time": "2026-11-10T10:00:00Z",
                "duration_minutes": 5,
            },
        },
    )
    assert resp_valid_min.status_code == 200
    assert resp_valid_min.json()["status"] == "success"


# ==============================================================================
# Edge Case 10: Custom Working Hours from User Preferences
# ==============================================================================
@pytest.mark.asyncio
async def test_edge_custom_user_preferences_working_hours(
    async_client: httpx.AsyncClient,
    db_pool: asyncpg.Pool,
    test_user_id: str,
    clean_test_db: None,
):
    """
    Verify dynamic availability calculation respects non-default user preferences:
    1. Set working_hours = {"start": "11:00", "end": "15:00"} in user_preferences.
    2. Query availability: slots must span 11:00 to 14:30 (with 30m slots).
       Slots at 09:00, 10:00, 15:00, 16:00 must NOT be generated.
    3. Book slot at 11:00 for 60 minutes (11:00 - 12:00).
    4. Re-query: 11:00 and 11:30 must be excluded; 12:00, 12:30, 13:00, 13:30, 14:00, 14:30 must remain available.
    """
    target_date = "2026-11-11"
    parsed_uid = uuid.UUID(test_user_id)

    # 1. Insert custom user preferences
    async with db_pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO user_preferences (user_id, timezone, working_hours, default_meeting_duration_minutes)
            VALUES ($1, 'UTC', $2, 30)
            ON CONFLICT (user_id) DO UPDATE
            SET working_hours = EXCLUDED.working_hours, timezone = EXCLUDED.timezone;
            """,
            parsed_uid,
            json.dumps({"start": "11:00", "end": "15:00"}),
        )

    # 2. Query initial availability
    resp_init = await async_client.post(
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
    assert resp_init.status_code == 200
    init_slots = resp_init.json()["data"]["available_slots"]

    # Invariants for 11:00 - 15:00 window
    assert contains_slot(f"{target_date}T11:00:00Z", init_slots)
    assert contains_slot(f"{target_date}T14:30:00Z", init_slots)
    assert not contains_slot(f"{target_date}T09:00:00Z", init_slots)
    assert not contains_slot(f"{target_date}T10:00:00Z", init_slots)
    assert not contains_slot(f"{target_date}T15:00:00Z", init_slots)

    # 3. Book 11:00 for 60 min (11:00 - 12:00)
    book_resp = await async_client.post(
        "/tools/execute",
        json={
            "tool_name": "book_event",
            "user_id": test_user_id,
            "parameters": {
                "title": "Custom Hours Brunch Review",
                "start_time": f"{target_date}T11:00:00Z",
                "duration_minutes": 60,
            },
        },
    )
    assert book_resp.status_code == 200
    assert book_resp.json()["status"] == "success"

    # 4. Re-query availability
    resp_after = await async_client.post(
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
    assert resp_after.status_code == 200
    after_slots = resp_after.json()["data"]["available_slots"]

    assert not contains_slot(f"{target_date}T11:00:00Z", after_slots)
    assert not contains_slot(f"{target_date}T11:30:00Z", after_slots)
    assert contains_slot(f"{target_date}T12:00:00Z", after_slots)
    assert contains_slot(f"{target_date}T14:30:00Z", after_slots)
