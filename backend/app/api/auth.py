"""
Google OAuth API Router
Handles OAuth redirects, callback handling, connection status checking, and account disconnection.
"""

from datetime import datetime, timedelta, timezone
import html
import json
import logging
from typing import Optional
import urllib.parse

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import HTMLResponse, RedirectResponse

from ..config import settings
from ..services.google_oauth import (
    exchange_code_for_tokens,
    get_authorization_url,
    revoke_and_disconnect,
)
from db.tokens import get_oauth_tokens, save_oauth_tokens

logger = logging.getLogger("voice_bot.api.auth")
router = APIRouter(prefix="/auth/google", tags=["auth"])

DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000001"


@router.get("/login", summary="Initiate Google OAuth Consent Flow")
async def google_login(user_id: str = Query(default=DEFAULT_USER_ID)):
    """
    Redirect the user to Google's OAuth 2.0 consent screen with offline access.
    """
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth credentials are not configured in backend settings.",
        )

    auth_url = get_authorization_url(user_id=user_id)
    logger.info("Initiating Google OAuth login redirect for user: %s", user_id)
    return RedirectResponse(url=auth_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@router.get("/url", summary="Get Google Authorization URL as JSON")
async def google_auth_url(user_id: str = Query(default=DEFAULT_USER_ID)):
    """
    Return the Google OAuth authorization URL as JSON for frontend popups or links.
    """
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth credentials are not configured in backend settings.",
        )

    auth_url = get_authorization_url(user_id=user_id)
    return {"auth_url": auth_url, "user_id": user_id}


@router.get("/callback", summary="Handle Google OAuth Callback", response_class=HTMLResponse)
async def google_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    """
    Handle authorization code redirect from Google OAuth server.
    Exchanges code for access/refresh tokens and persists them into Neon PostgreSQL.
    """
    if error:
        safe_error = html.escape(error)
        logger.warning("Google OAuth callback error received: %s", error)
        return HTMLResponse(
            content=f"""
            <html>
                <head><title>Google Connection Failed</title></head>
                <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f87171;">
                    <div style="background: #1e293b; padding: 2rem 3rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.5); text-align: center; max-width: 480px;">
                        <h2 style="margin-top: 0;">Connection Failed</h2>
                        <p style="color: #cbd5e1;">Google returned an error: <strong>{safe_error}</strong></p>
                        <a href="/auth/google/login" style="display: inline-block; margin-top: 1rem; padding: 0.6rem 1.2rem; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px;">Try Again</a>
                    </div>
                </body>
            </html>
            """,
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    if not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing 'code' query parameter in OAuth callback.",
        )

    # Extract user_id from state
    user_id = DEFAULT_USER_ID
    if state:
        try:
            state_data = json.loads(urllib.parse.unquote(state))
            user_id = state_data.get("user_id", DEFAULT_USER_ID)
        except Exception as exc:
            logger.warning("Failed to decode state payload (%s). Using default user.", exc)

    try:
        token_data = await exchange_code_for_tokens(code=code)
    except Exception as exc:
        logger.exception("Failed to exchange OAuth code for tokens: %s", exc)
        return HTMLResponse(
            content=f"""
            <html>
                <head><title>Token Exchange Failed</title></head>
                <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f87171;">
                    <div style="background: #1e293b; padding: 2rem 3rem; border-radius: 12px; text-align: center;">
                        <h2>Authentication Failed</h2>
                        <p style="color: #cbd5e1;">Could not exchange authorization code with Google.</p>
                        <p style="font-size: 0.85rem; color: #94a3b8;">{str(exc)}</p>
                    </div>
                </body>
            </html>
            """,
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 3600)
    token_type = token_data.get("token_type", "Bearer")
    scope = token_data.get("scope")

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    # Persist in Neon PostgreSQL
    await save_oauth_tokens(
        user_id=user_id,
        provider="google",
        access_token=access_token,
        refresh_token=refresh_token,
        token_type=token_type,
        scope=scope,
        expires_at=expires_at,
    )

    logger.info("Successfully connected and persisted Google OAuth tokens for user: %s", user_id)

    # Return polished success UI
    return HTMLResponse(
        content="""
        <!DOCTYPE html>
        <html>
            <head>
                <meta charset="utf-8">
                <title>Google Calendar Connected</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                        background: #090d16;
                        color: #f8fafc;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        height: 100vh;
                        margin: 0;
                    }
                    .card {
                        background: #111827;
                        border: 1px solid #1f2937;
                        border-radius: 16px;
                        padding: 2.5rem 3rem;
                        text-align: center;
                        max-width: 440px;
                        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
                    }
                    .icon {
                        width: 56px;
                        height: 56px;
                        background: #059669;
                        border-radius: 50%;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        margin-bottom: 1.25rem;
                        font-size: 28px;
                    }
                    h1 {
                        font-size: 1.4rem;
                        margin: 0 0 0.5rem 0;
                        color: #ffffff;
                    }
                    p {
                        font-size: 0.95rem;
                        color: #94a3b8;
                        line-height: 1.5;
                        margin: 0 0 1.5rem 0;
                    }
                    .badge {
                        display: inline-block;
                        background: #1e293b;
                        color: #38bdf8;
                        padding: 0.35rem 0.75rem;
                        border-radius: 9999px;
                        font-size: 0.8rem;
                        font-weight: 500;
                    }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="icon">✓</div>
                    <h1>Google Calendar Connected</h1>
                    <p>Your AI Voice Assistant is now authenticated to read calendar availability and schedule meetings with Google Meet links.</p>
                    <span class="badge">You can close this tab and return to the voice call</span>
                </div>
            </body>
        </html>
        """
    )


@router.get("/status", summary="Check Google Calendar Connection Status")
async def google_auth_status(user_id: str = Query(default=DEFAULT_USER_ID)):
    """
    Check if the user has an active Google Calendar integration.
    """
    tokens = await get_oauth_tokens(user_id=user_id, provider="google")
    if not tokens:
        return {
            "connected": False,
            "provider": "google",
            "user_id": user_id,
        }

    now = datetime.now(timezone.utc)
    is_expired = tokens["expires_at"] < now
    has_refresh = bool(tokens.get("refresh_token"))

    return {
        "connected": True,
        "provider": "google",
        "user_id": user_id,
        "expires_at": tokens["expires_at"].isoformat(),
        "is_expired": is_expired,
        "can_refresh": has_refresh,
        "scope": tokens.get("scope"),
    }


@router.post("/disconnect", summary="Disconnect Google Calendar Integration")
async def google_disconnect(user_id: str = Query(default=DEFAULT_USER_ID)):
    """
    Revoke Google tokens and remove from PostgreSQL database.
    """
    success = await revoke_and_disconnect(user_id=user_id)
    return {
        "status": "disconnected" if success else "not_found",
        "user_id": user_id,
        "provider": "google",
    }

