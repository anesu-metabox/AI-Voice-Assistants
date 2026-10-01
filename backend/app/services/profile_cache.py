"""Bounded cache for immutable, version-bound assistant profiles."""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from copy import deepcopy
import logging
import time
from typing import Any

from db.agent_profiles import get_published_agent_profile

from .latency import log_latency


logger = logging.getLogger("voice_bot.services.profile_cache")
_MAX_PROFILE_CACHE_ENTRIES = 512
_cache: OrderedDict[tuple[str, int], dict[str, Any]] = OrderedDict()
_inflight: dict[tuple[str, int], asyncio.Task[dict[str, Any] | None]] = {}
_lock = asyncio.Lock()


async def get_cached_published_agent_profile(
    *, company_id: str, version: int | None = None
) -> dict[str, Any] | None:
    """Cache only exact immutable versions; mutable latest lookups bypass it."""
    if version is None:
        return await get_published_agent_profile(company_id=company_id, version=None)

    started_at = time.perf_counter()
    key = (company_id, version)
    async with _lock:
        cached = _cache.get(key)
        if cached is not None:
            _cache.move_to_end(key)
            log_latency(logger, "profile_snapshot_cache", started_at, outcome="hit")
            return deepcopy(cached)
        task = _inflight.get(key)
        if task is None:
            task = asyncio.create_task(
                get_published_agent_profile(company_id=company_id, version=version)
            )
            _inflight[key] = task

    try:
        result = await asyncio.shield(task)
    finally:
        if task.done():
            async with _lock:
                if _inflight.get(key) is task:
                    _inflight.pop(key, None)

    if result is not None:
        async with _lock:
            _cache[key] = deepcopy(result)
            _cache.move_to_end(key)
            while len(_cache) > _MAX_PROFILE_CACHE_ENTRIES:
                _cache.popitem(last=False)
    log_latency(logger, "profile_snapshot_cache", started_at, outcome="miss")
    return deepcopy(result)


async def clear_profile_snapshot_cache() -> None:
    """Test and lifecycle hook; published version keys never need invalidation."""
    async with _lock:
        _cache.clear()
        _inflight.clear()
