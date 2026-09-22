"""Authenticated user/company preference endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from ..auth_context import verify_session_context
from db.preferences import get_preferences, save_preferences

router = APIRouter(prefix="/user-preferences", tags=["preferences"])


class PreferencesRequest(BaseModel):
    preferences: dict[str, Any] = Field(default_factory=dict)
    onboarding_complete: bool | None = None


def _company(header: str | None) -> str:
    context = verify_session_context(header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    return context.company_id


@router.get("")
async def read_preferences(verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context")):
    return {"status": "success", "data": await get_preferences(_company(verified_context_header))}


@router.put("")
async def update_preferences(payload: PreferencesRequest, verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context")):
    company_id = _company(verified_context_header)
    if len(payload.preferences) > 100:
        raise HTTPException(status_code=422, detail="Too many preference keys")
    return {"status": "success", "data": await save_preferences(company_id=company_id, preferences=payload.preferences, onboarding_complete=payload.onboarding_complete)}
