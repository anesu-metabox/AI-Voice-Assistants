"""Durable LiveKit room/dispatch idempotency helpers."""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict

from db.connection import get_db_pool


CreateDispatch = Callable[[str], Awaitable[str]]


class SessionProfileConflict(RuntimeError):
    """An idempotent LiveKit session cannot be rebound to another profile."""


async def get_or_create_session(
    *,
    user_id: str,
    session_id: str,
    room_name: str,
    create_dispatch: CreateDispatch,
    profile_version: int | None = None,
) -> Dict[str, Any]:
    """Return the durable room/dispatch pair, creating it exactly once.

    The advisory transaction lock covers the LiveKit API call as well as the
    insert. This is intentional: a second browser retry must wait instead of
    dispatching another agent while the first request is in flight.
    """
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.company_id', $1, true)", user_id)
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
                f"livekit:{user_id}:{session_id}",
            )
            existing = await conn.fetchrow(
                """
                SELECT room_name, dispatch_id, profile_version
                FROM livekit_sessions
                WHERE user_id = $1 AND session_id = $2
                """,
                user_id,
                session_id,
            )
            if existing:
                if existing["profile_version"] != profile_version:
                    raise SessionProfileConflict(
                        "LiveKit session is already bound to a different assistant profile version"
                    )
                await conn.execute(
                    """
                    UPDATE livekit_sessions
                    SET last_seen_at = NOW()
                    WHERE user_id = $1 AND session_id = $2
                    """,
                    user_id,
                    session_id,
                )
                return {
                    "room_name": existing["room_name"],
                    "dispatch_id": existing["dispatch_id"],
                    "profile_version": existing["profile_version"],
                    "reused": True,
                }

            dispatch_id = await create_dispatch(room_name)
            await conn.execute(
                """
                INSERT INTO livekit_sessions (user_id, session_id, room_name, dispatch_id, profile_version)
                VALUES ($1, $2, $3, $4, $5)
                """,
                user_id,
                session_id,
                room_name,
                dispatch_id,
                profile_version,
            )
            return {
                "room_name": room_name,
                "dispatch_id": dispatch_id,
                "profile_version": profile_version,
                "reused": False,
            }
