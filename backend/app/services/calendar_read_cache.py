"""Bounded in-process cache and single-flight coordinator for calendar reads."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Hashable
from copy import deepcopy
from dataclasses import dataclass
import logging
import time
from typing import Any

from .latency import log_latency


logger = logging.getLogger("voice_bot.services.calendar_read_cache")


@dataclass(frozen=True)
class _Entry:
    expires_at: float
    value: dict[str, Any]


class CalendarReadCache:
    def __init__(self, max_entries: int = 1024) -> None:
        self._max_entries = max(1, max_entries)
        self._entries: OrderedDict[Hashable, _Entry] = OrderedDict()
        self._inflight: dict[Hashable, asyncio.Task[dict[str, Any] | None]] = {}
        self._lock = asyncio.Lock()

    async def get_or_load(
        self,
        key: Hashable,
        *,
        ttl_seconds: float,
        loader: Callable[[], Awaitable[dict[str, Any] | None]],
    ) -> dict[str, Any] | None:
        if ttl_seconds <= 0:
            return await loader()

        started_at = time.perf_counter()
        now = time.monotonic()
        creator = False
        async with self._lock:
            entry = self._entries.get(key)
            if entry and entry.expires_at > now:
                self._entries.move_to_end(key)
                log_latency(logger, "calendar_read_cache", started_at, outcome="hit")
                return deepcopy(entry.value)
            if entry:
                self._entries.pop(key, None)
            task = self._inflight.get(key)
            if task is None:
                task = asyncio.create_task(loader())
                self._inflight[key] = task
                creator = True

        try:
            result = await asyncio.shield(task)
        finally:
            if task.done():
                async with self._lock:
                    if self._inflight.get(key) is task:
                        self._inflight.pop(key, None)

        cacheable = (
            isinstance(result, dict)
            and not result.get("status")
            and result.get("source") in {"google_calendar_live", "google_calendar_mirror"}
        )
        if cacheable:
            async with self._lock:
                self._entries[key] = _Entry(
                    expires_at=time.monotonic() + ttl_seconds,
                    value=deepcopy(result),
                )
                self._entries.move_to_end(key)
                while len(self._entries) > self._max_entries:
                    self._entries.popitem(last=False)
        log_latency(
            logger,
            "calendar_read_cache",
            started_at,
            outcome="miss" if creator else "coalesced",
        )
        return deepcopy(result)

    async def invalidate_company(self, company_id: str) -> None:
        async with self._lock:
            for key in list(self._entries):
                if isinstance(key, tuple) and key and key[0] == company_id:
                    self._entries.pop(key, None)

    async def clear(self) -> None:
        async with self._lock:
            self._entries.clear()
            self._inflight.clear()


CALENDAR_READ_CACHE = CalendarReadCache()
