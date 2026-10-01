"""Deterministic local benchmark for the latency fast paths.

This uses simulated provider latency and synthetic company data. It measures
cache/coalescing overhead and prompt-size reduction, not real network latency.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
import sys
import time
import uuid


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agent.agent import format_company_operating_profile
from agent.assistant_policy import compile_company_fact_index, match_approved_company_fact
from backend.app.services.calendar_read_cache import CalendarReadCache


logging.getLogger("voice_bot.services.calendar_read_cache").setLevel(logging.WARNING)


async def benchmark_calendar_cache() -> dict[str, float | int]:
    cache = CalendarReadCache(max_entries=16)
    company_id = str(uuid.uuid4())
    key = (company_id, "availability", "2026-10-01", "2026-10-01")
    calls = 0

    async def provider_read():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        return {"available_slots": [], "source": "google_calendar_live"}

    cold_started = time.perf_counter()
    await cache.get_or_load(key, ttl_seconds=30, loader=provider_read)
    cold_ms = (time.perf_counter() - cold_started) * 1000

    warm_started = time.perf_counter()
    for _ in range(100):
        await cache.get_or_load(key, ttl_seconds=30, loader=provider_read)
    warm_total_ms = (time.perf_counter() - warm_started) * 1000
    if calls != 1:
        raise AssertionError(f"warm cache unexpectedly called provider {calls} times")

    concurrent_cache = CalendarReadCache(max_entries=16)
    concurrent_calls = 0

    async def concurrent_provider_read():
        nonlocal concurrent_calls
        concurrent_calls += 1
        await asyncio.sleep(0.05)
        return {"events": [], "source": "google_calendar_live"}

    concurrent_started = time.perf_counter()
    await asyncio.gather(
        *(
            concurrent_cache.get_or_load(
                key, ttl_seconds=30, loader=concurrent_provider_read
            )
            for _ in range(20)
        )
    )
    concurrent_ms = (time.perf_counter() - concurrent_started) * 1000
    if concurrent_calls != 1:
        raise AssertionError(
            f"single-flight unexpectedly called provider {concurrent_calls} times"
        )

    return {
        "simulated_provider_delay_ms": 50,
        "cold_read_ms": round(cold_ms, 3),
        "warm_read_average_ms": round(warm_total_ms / 100, 3),
        "warm_provider_calls": calls,
        "twenty_concurrent_reads_ms": round(concurrent_ms, 3),
        "concurrent_provider_calls": concurrent_calls,
    }


def benchmark_company_fact_context() -> dict[str, float | int]:
    profile = {
        "tone": "professional",
        "business_hours": {"monday": "09:00-17:00"},
        "faq_entries": [
            {
                "question": f"What is the return policy for product {index}?",
                "answer": ("Approved company answer. " * 45).strip(),
            }
            for index in range(20)
        ],
    }
    full = format_company_operating_profile(profile, include_faq_entries=True)
    compact = format_company_operating_profile(profile, include_faq_entries=False)
    fact_index = compile_company_fact_index(profile)

    match_started = time.perf_counter()
    for _ in range(1000):
        match_approved_company_fact(
            "What is the return policy for product 7?", compiled_index=fact_index
        )
    match_total_ms = (time.perf_counter() - match_started) * 1000

    if len(compact) >= len(full):
        raise AssertionError("compiled fact retrieval did not reduce standing context")
    return {
        "standing_context_before_chars": len(full),
        "standing_context_after_chars": len(compact),
        "standing_context_reduction_percent": round(
            (1 - len(compact) / len(full)) * 100, 2
        ),
        "fact_match_average_ms": round(match_total_ms / 1000, 4),
    }


async def main() -> None:
    print(
        json.dumps(
            {
                "calendar_cache": await benchmark_calendar_cache(),
                "company_fact_context": benchmark_company_fact_context(),
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
