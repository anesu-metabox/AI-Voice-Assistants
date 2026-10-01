"""Aggregated read models for the authenticated workspace dashboard."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Header, HTTPException, status

from ..auth_context import verify_session_context
from db.agent_profiles import list_agent_profile_versions
from db.settings import get_company_profile
from db.threecx import get_threecx_integration, list_threecx_call_sessions
from db.tokens import get_oauth_connection_metadata
from .integrations import _serialize_threecx

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
async def dashboard_summary(
    verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context"),
):
    """Return the dashboard read model after one session-context validation."""
    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")

    profile, threecx, calls, google, versions = await asyncio.gather(
        get_company_profile(user_id=context.company_id),
        get_threecx_integration(context.company_id),
        list_threecx_call_sessions(company_id=context.company_id, limit=50),
        get_oauth_connection_metadata(user_id=context.company_id, provider="google"),
        list_agent_profile_versions(company_id=context.company_id),
    )
    published = next(
        (item["version"] for item in versions if item.get("lifecycle_state") == "published"),
        None,
    )
    return {
        "company": profile,
        "threeCx": _serialize_threecx(threecx),
        "calls": [
            {
                "did": row["did"],
                "direction": row["direction"],
                "state": row["state"],
                "createdAt": row["created_at"].isoformat(),
                "updatedAt": row["updated_at"].isoformat(),
                "endedAt": row["ended_at"].isoformat() if row["ended_at"] else None,
            }
            for row in calls
        ],
        "google": {
            "connected": bool(google),
            "email": google.get("google_email") if google else None,
        },
        "publishedVersion": published,
    }
