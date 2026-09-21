"""
FastAPI Router for Company Setup, Assistant Configuration, and LiveKit Session Tokens
Handles persistent client configuration in Neon PostgreSQL and mints WebRTC tokens.
"""

from datetime import timedelta
import logging
import os
from typing import Any, Dict, Optional
import uuid

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from ..config import settings
from db.settings import (
    get_assistant_config,
    get_company_profile,
    save_assistant_config,
    save_company_profile,
)

logger = logging.getLogger("voice_bot.api.settings")
router = APIRouter(tags=["settings"])

DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001"


# ─── Pydantic Schemas ─────────────────────────────────────────────────────────

class CompanyProfileRequest(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=255)
    website_url: Optional[str] = Field(default="")
    company_phone: Optional[str] = Field(default="")
    support_email: Optional[str] = Field(default="")
    timezone: str = Field(default="America/New_York (EST)")


class AssistantConfigRequest(BaseModel):
    assistant_name: str = Field(..., min_length=1, max_length=255)
    voice_engine: str = Field(default="Aoede")
    inbound_greeting: str = Field(default="")
    system_prompt: str = Field(default="")
    knowledge_base_notes: Optional[str] = Field(default="")
    is_deployed: bool = Field(default=False)


# ─── Company Profile Endpoints ───────────────────────────────────────────────

@router.get("/company-profile", summary="Retrieve Company Profile")
async def fetch_company_profile(user_id: str = Query(default=DEFAULT_USER_ID)):
    """Fetch company profile and operational parameters from Neon PostgreSQL."""
    try:
        profile = await get_company_profile(user_id=user_id)
        return {"status": "success", "data": profile}
    except Exception as exc:
        logger.error("Failed to fetch company profile: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch company profile: {str(exc)}",
        )


@router.post("/company-profile", summary="Save Company Profile")
async def update_company_profile(
    payload: CompanyProfileRequest,
    user_id: str = Query(default=DEFAULT_USER_ID),
):
    """Save or update company profile and operational parameters into Neon PostgreSQL."""
    try:
        updated = await save_company_profile(
            user_id=user_id,
            company_name=payload.company_name,
            website_url=payload.website_url,
            company_phone=payload.company_phone,
            support_email=payload.support_email,
            timezone=payload.timezone,
        )
        return {"status": "success", "message": "Company profile saved successfully", "data": updated}
    except Exception as exc:
        logger.error("Failed to save company profile: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save company profile: {str(exc)}",
        )


# ─── Assistant Configuration Endpoints ───────────────────────────────────────

@router.get("/assistant-config", summary="Retrieve Assistant Configuration")
async def fetch_assistant_config(user_id: str = Query(default=DEFAULT_USER_ID)):
    """Fetch assistant prompt, voice engine, and greeting parameters from Neon PostgreSQL."""
    try:
        config = await get_assistant_config(user_id=user_id)
        return {"status": "success", "data": config}
    except Exception as exc:
        logger.error("Failed to fetch assistant config: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch assistant config: {str(exc)}",
        )


@router.post("/assistant-config", summary="Save Assistant Configuration")
async def update_assistant_config(
    payload: AssistantConfigRequest,
    user_id: str = Query(default=DEFAULT_USER_ID),
):
    """Save or update assistant configuration into Neon PostgreSQL."""
    try:
        updated = await save_assistant_config(
            user_id=user_id,
            assistant_name=payload.assistant_name,
            voice_engine=payload.voice_engine,
            inbound_greeting=payload.inbound_greeting,
            system_prompt=payload.system_prompt,
            knowledge_base_notes=payload.knowledge_base_notes,
            is_deployed=payload.is_deployed,
        )
        return {"status": "success", "message": "Assistant configuration saved successfully", "data": updated}
    except Exception as exc:
        logger.error("Failed to save assistant config: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save assistant config: {str(exc)}",
        )


# ─── LiveKit Room Token Minting Endpoint ─────────────────────────────────────

@router.get("/livekit/token", summary="Generate LiveKit Room Access Token")
async def generate_livekit_token(
    room_name: Optional[str] = Query(default=None),
    user_id: str = Query(default=DEFAULT_USER_ID),
    participant_name: Optional[str] = Query(default="Tester"),
):
    """
    Generate an authenticated WebRTC access token to join the LiveKit Cloud room
    for the interactive Gemini Live Testing Sandbox.
    """
    api_key = os.getenv("LIVEKIT_API_KEY")
    api_secret = os.getenv("LIVEKIT_API_SECRET")
    ws_url = os.getenv("LIVEKIT_URL", "wss://ai-voice-assistant-vu6rr406.livekit.cloud")

    if not api_key or not api_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be configured in environment.",
        )

    resolved_room = room_name or f"sandbox-{uuid.uuid4().hex[:8]}"
    identity = f"user-{uuid.uuid4().hex[:6]}"

    try:
        from livekit.api import AccessToken, VideoGrants

        token = (
            AccessToken(api_key, api_secret)
            .with_identity(identity)
            .with_name(participant_name)
            .with_grants(
                VideoGrants(
                    room_join=True,
                    room=resolved_room,
                    can_publish=True,
                    can_subscribe=True,
                    can_publish_data=True,
                )
            )
            .with_ttl(timedelta(hours=2))
        )

        jwt_token = token.to_jwt()

        # Ensure room and dispatch agent worker so the AI bot enters the session immediately
        try:
            from livekit.api import LiveKitAPI, CreateRoomRequest, CreateAgentDispatchRequest
            lk_api = LiveKitAPI(ws_url, api_key, api_secret)
            try:
                await lk_api.room.create_room(CreateRoomRequest(name=resolved_room, empty_timeout=300))
            except Exception:
                pass
            try:
                await lk_api.agent_dispatch.create_dispatch(CreateAgentDispatchRequest(room=resolved_room))
            except Exception as d_exc:
                logger.debug("Agent dispatch note: %s", d_exc)
            await lk_api.aclose()
        except Exception as dispatch_err:
            logger.warning("Could not dispatch agent to room %s: %s", resolved_room, dispatch_err)

        return {
            "token": jwt_token,
            "ws_url": ws_url,
            "room": resolved_room,
            "identity": identity,
        }
    except Exception as exc:
        logger.error("Failed to generate LiveKit room token: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not generate LiveKit access token: {str(exc)}",
        )
