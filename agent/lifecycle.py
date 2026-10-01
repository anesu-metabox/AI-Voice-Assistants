"""Sanitized voice-agent lifecycle and heartbeat messages for browser clients."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Literal


logger = logging.getLogger("voice_bot.agent.lifecycle")

AgentLifecycleState = Literal[
    "starting",
    "ready",
    "recovering",
    "recovered",
    "failed",
    "ended",
]


class AgentLifecyclePublisher:
    def __init__(
        self,
        room: Any,
        session_id: str,
        *,
        heartbeat_seconds: float = 5.0,
    ) -> None:
        self._room = room
        self._session_id = session_id
        self._heartbeat_seconds = max(heartbeat_seconds, 1.0)
        self._state: AgentLifecycleState = "starting"
        self._sequence = 0
        self._recovery_attempt = 0
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._stopped = asyncio.Event()

    @property
    def state(self) -> AgentLifecycleState:
        return self._state

    async def _publish(self, event_type: str, **fields: Any) -> None:
        participant = getattr(self._room, "local_participant", None)
        if participant is None:
            return
        self._sequence += 1
        payload = {
            "type": event_type,
            "state": self._state,
            "session_id": self._session_id,
            "sequence": self._sequence,
            "timestamp": time.time(),
            **fields,
        }
        try:
            await participant.publish_data(
                json.dumps(payload, separators=(",", ":")).encode("utf-8"),
                reliable=True,
            )
        except Exception as exc:
            logger.warning(
                "Failed to publish agent lifecycle event (state=%s error_type=%s)",
                self._state,
                type(exc).__name__,
            )

    async def transition(
        self,
        state: AgentLifecycleState,
        *,
        code: str | None = None,
        retryable: bool | None = None,
    ) -> None:
        self._state = state
        if state == "recovering":
            self._recovery_attempt += 1
        fields: dict[str, Any] = {"recovery_attempt": self._recovery_attempt}
        if code:
            fields["code"] = code
        if retryable is not None:
            fields["retryable"] = retryable
        await self._publish("agent_lifecycle", **fields)

    def start_heartbeat(self) -> None:
        if self._heartbeat_task is None or self._heartbeat_task.done():
            self._heartbeat_task = asyncio.create_task(
                self._heartbeat_loop(),
                name=f"agent-heartbeat-{self._session_id}",
            )

    async def _heartbeat_loop(self) -> None:
        while not self._stopped.is_set():
            try:
                await asyncio.wait_for(
                    self._stopped.wait(), timeout=self._heartbeat_seconds
                )
            except TimeoutError:
                await self._publish(
                    "agent_heartbeat",
                    recovery_attempt=self._recovery_attempt,
                )

    async def stop(self) -> None:
        self._stopped.set()
        task = self._heartbeat_task
        if task is not None and task is not asyncio.current_task():
            await task
