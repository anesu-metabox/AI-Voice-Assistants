"""Small, dependency-free latency tracing helpers.

The trace deliberately records only opaque IDs, stage names, durations, and
low-cardinality status metadata. Provider payloads, tokens, event contents, and
company-provided text must never be added here.
"""

from __future__ import annotations

import contextvars
import logging
import re
import time
import uuid
from collections.abc import Awaitable
from typing import TypeVar


_TRACE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")
_trace_id: contextvars.ContextVar[str] = contextvars.ContextVar(
    "voice_bot_trace_id", default=""
)
T = TypeVar("T")


def normalized_trace_id(candidate: str | None) -> str:
    """Return a bounded opaque trace ID, replacing malformed input."""
    value = (candidate or "").strip()
    if _TRACE_ID_PATTERN.fullmatch(value):
        return value
    return uuid.uuid4().hex


def bind_trace_id(candidate: str | None = None) -> tuple[str, contextvars.Token[str]]:
    trace_id = normalized_trace_id(candidate)
    return trace_id, _trace_id.set(trace_id)


def reset_trace_id(token: contextvars.Token[str]) -> None:
    _trace_id.reset(token)


def current_trace_id() -> str:
    return _trace_id.get()


def log_latency(
    logger: logging.Logger,
    stage: str,
    started_at: float,
    *,
    outcome: str = "ok",
) -> float:
    duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
    logger.info(
        "latency trace_id=%s stage=%s duration_ms=%.2f outcome=%s",
        current_trace_id() or "unbound",
        stage,
        duration_ms,
        outcome,
    )
    return duration_ms


async def measured(
    logger: logging.Logger,
    stage: str,
    awaitable: Awaitable[T],
) -> T:
    """Await an operation and always emit its elapsed time."""
    started_at = time.perf_counter()
    try:
        result = await awaitable
    except Exception:
        log_latency(logger, stage, started_at, outcome="error")
        raise
    log_latency(logger, stage, started_at)
    return result
