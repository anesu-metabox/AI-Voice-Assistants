"""Atomic persistence for the editor-compatible and versioned assistant profile."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from .agent_profiles import save_agent_profile_version_on_connection
from .connection import get_db_pool
from .settings import save_assistant_config_on_connection

logger = logging.getLogger("voice_bot.db.assistant_configuration")


async def save_assistant_configuration(
    *,
    company_id: str,
    created_by: str,
    assistant_name: str,
    voice_engine: str,
    inbound_greeting: str,
    system_prompt: str,
    knowledge_base_notes: str | None,
    is_deployed: bool = False,
    profile: dict[str, Any],
    compiled_policy: dict[str, Any],
    published: bool | None = None,
    **_kwargs: Any,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Write both assistant representations on one tenant-scoped transaction.

    The legacy row remains a compatibility projection while version history is
    written; callers must not split these writes across connections.
    """
    if published is not None:
        is_deployed = bool(published)
    company_uuid = uuid.UUID(company_id)
    operation_id = str(uuid.uuid4())
    stage = "acquire"
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            async with conn.transaction():
                stage = "tenant_context"
                await conn.execute(
                    "SELECT set_config('app.company_id', $1, true)", company_id
                )
                stage = "legacy_config_upsert"
                updated = await save_assistant_config_on_connection(
                    conn,
                    user_uuid=company_uuid,
                    assistant_name=assistant_name,
                    voice_engine=voice_engine,
                    inbound_greeting=inbound_greeting,
                    system_prompt=system_prompt,
                    knowledge_base_notes=knowledge_base_notes,
                    is_deployed=is_deployed,
                )
                stage = "profile_version_insert"
                saved_profile = await save_agent_profile_version_on_connection(
                    conn,
                    company_uuid=company_uuid,
                    company_id=company_id,
                    created_by=created_by,
                    profile=profile,
                    compiled_policy=compiled_policy,
                    published=is_deployed,
                )
                return updated, saved_profile
    except Exception as exc:
        # Avoid logging exception text: drivers may include query details. SQLSTATE
        # and exception class provide useful diagnostics without configuration data.
        logger.error(
            "Assistant configuration transaction failed "
            "(operation_id=%s stage=%s error_type=%s sqlstate=%s)",
            operation_id,
            stage,
            type(exc).__name__,
            getattr(exc, "sqlstate", None),
        )
        raise
