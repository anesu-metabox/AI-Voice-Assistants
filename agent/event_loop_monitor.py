"""Low-overhead event-loop stall monitoring for active voice sessions."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable


logger = logging.getLogger("voice_bot.event_loop")
DEFAULT_INTERVAL_SECONDS = 0.05
DEFAULT_STALL_THRESHOLD_MS = 100.0


async def monitor_active_conversation(
    session_id: str,
    stop_event: asyncio.Event,
    *,
    interval_seconds: float = DEFAULT_INTERVAL_SECONDS,
    stall_threshold_ms: float = DEFAULT_STALL_THRESHOLD_MS,
    on_stall: Callable[[float], None] | None = None,
) -> None:
    """Report delayed event-loop wakeups until the voice session closes.

    This intentionally measures loop scheduling delay rather than wall-clock
    model/network latency. It runs only while a conversation is active and
    reports session correlation plus duration, never caller transcript data.
    """
    if not session_id or interval_seconds <= 0 or stall_threshold_ms <= 0:
        raise ValueError("session ID, positive interval, and positive threshold are required")

    loop = asyncio.get_running_loop()
    previous_tick = loop.time()
    threshold_seconds = stall_threshold_ms / 1000
    while not stop_event.is_set():
        deadline = previous_tick + interval_seconds
        delay = max(0.0, deadline - loop.time())
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=delay)
            break
        except asyncio.TimeoutError:
            pass

        now = loop.time()
        observed_interval_seconds = now - previous_tick
        if observed_interval_seconds >= threshold_seconds:
            interval_ms = observed_interval_seconds * 1000
            logger.warning(
                "Active conversation event-loop stall: session_id=%s interval_ms=%.1f",
                session_id,
                interval_ms,
            )
            if on_stall is not None:
                on_stall(interval_ms)
        previous_tick = now
