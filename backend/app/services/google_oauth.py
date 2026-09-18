"""
Google OAuth 2.0 Service
Handles OAuth authorization URL generation, code exchange, automatic token refresh, and token revocation.
Communicates asynchronously via httpx to avoid blocking the event loop.
"""

from datetime import datetime, timedelta, timezone
import json
import logging
from typing import Any, Dict, Optional
import urllib.parse

import httpx

from ..config import settings
from db.tokens import delete_oauth_tokens, get_oauth_tokens, save_oauth_tokens

logger = logging.getLogger("voice_bot.services.google_oauth")

GOOGLE_AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"

DEFAULT_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]


def get_authorization_url(
    user_id: str,
    redirect_uri: Optional[str] = None,
    scopes: Optional[list[str]] = None,
) -> str:
    """
    Generate the Google OAuth 2.0 authorization URL.
    Enforces access_type=offline and prompt=consent to ensure a refresh token is returned.
    """
    resolved_redirect = redirect_uri or settings.google_redirect_uri
    resolved_scopes = scopes or DEFAULT_SCOPES

    state_payload = {"user_id": user_id}
    state = urllib.parse.quote(json.dumps(state_payload))

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": resolved_redirect,
        "response_type": "code",
        "scope": " ".join(resolved_scopes),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "include_granted_scopes": "true",
    }

    url = f"{GOOGLE_AUTH_BASE_URL}?{urllib.parse.urlencode(params)}"
    return url


async def exchange_code_for_tokens(
    code: str,
    redirect_uri: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Exchange the authorization code for access and refresh tokens.
    """
    resolved_redirect = redirect_uri or settings.google_redirect_uri

    data = {
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": resolved_redirect,
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(GOOGLE_TOKEN_URL, data=data)
        if response.status_code != 200:
            logger.error("Failed to exchange code for tokens: %s - %s", response.status_code, response.text)
            raise ValueError(f"Google OAuth token exchange failed: {response.text}")
        return response.json()


async def get_valid_access_token(user_id: str) -> Optional[str]:
    """
    Retrieve an active Google access token for user_id.
    Automatically refreshes the token using the refresh_token if expired or within 60s of expiration.
    """
    token_record = await get_oauth_tokens(user_id=user_id, provider="google")
    if not token_record:
        logger.debug("No OAuth token found for user %s", user_id)
        return None

    expires_at = token_record["expires_at"]
    now = datetime.now(timezone.utc)

    # Check if token is still valid with a 60-second safety cushion
    if expires_at > (now + timedelta(seconds=60)):
        return token_record["access_token"]

    # Token is expired or expiring soon; refresh it
    refresh_token = token_record.get("refresh_token")
    if not refresh_token:
        logger.warning("Access token expired for user %s and no refresh token is stored.", user_id)
        return None

    logger.info("Access token expired for user %s. Refreshing with Google...", user_id)
    new_tokens = await refresh_access_token(refresh_token)
    if not new_tokens or "access_token" not in new_tokens:
        logger.error("Failed to refresh access token for user %s", user_id)
        return None

    new_access_token = new_tokens["access_token"]
    expires_in = new_tokens.get("expires_in", 3600)
    new_expires_at = now + timedelta(seconds=expires_in)
    new_refresh = new_tokens.get("refresh_token") or refresh_token

    await save_oauth_tokens(
        user_id=user_id,
        provider="google",
        access_token=new_access_token,
        refresh_token=new_refresh,
        expires_at=new_expires_at,
        scope=new_tokens.get("scope"),
    )

    logger.info("Access token refreshed and updated in DB for user %s", user_id)
    return new_access_token


async def refresh_access_token(refresh_token: str) -> Optional[Dict[str, Any]]:
    """
    Call Google OAuth token endpoint to obtain a fresh access token using refresh_token.
    """
    data = {
        "client_id": settings.google_client_id,
        "client_secret": settings.google_client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(GOOGLE_TOKEN_URL, data=data)
        if response.status_code != 200:
            logger.error("Google token refresh failed: %s - %s", response.status_code, response.text)
            return None
        return response.json()


async def revoke_and_disconnect(user_id: str) -> bool:
    """
    Revoke the stored token at Google's servers and remove it from the PostgreSQL database.
    """
    token_record = await get_oauth_tokens(user_id=user_id, provider="google")
    if not token_record:
        return False

    token_to_revoke = token_record.get("refresh_token") or token_record.get("access_token")
    if token_to_revoke:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.post(GOOGLE_REVOKE_URL, params={"token": token_to_revoke})
                res.raise_for_status()
        except Exception as exc:
            logger.warning("Token revocation request to Google failed (%s). Proceeding with DB cleanup.", exc)

    return await delete_oauth_tokens(user_id=user_id, provider="google")

