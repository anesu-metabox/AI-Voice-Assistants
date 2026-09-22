"""
Google OAuth 2.0 Service
Handles OAuth authorization URL generation, code exchange, automatic token refresh, and token revocation.
Communicates asynchronously via httpx to avoid blocking the event loop.
"""

from datetime import datetime, timedelta, timezone
import base64
import json
import hashlib
import hmac
import logging
import os
import secrets
import time
from typing import Any, Dict, Optional
import urllib.parse

import httpx

from ..config import settings
from db.tokens import delete_oauth_tokens, get_oauth_tokens, save_oauth_tokens
from db.oauth_states import consume_oauth_state, save_oauth_state
from .http_client import get_http_client

logger = logging.getLogger("voice_bot.services.google_oauth")


def _google_client_secret() -> str:
    """Read the OAuth client secret only in the credential-broker process."""
    value = os.getenv("GOOGLE_CLIENT_SECRET", "")
    if not value:
        raise RuntimeError("Google OAuth client secret is not configured in the credential broker")
    return value

GOOGLE_AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"

DEFAULT_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]


async def get_authorization_url(
    company_id: str,
    session_id: str,
    redirect_uri: Optional[str] = None,
    scopes: Optional[list[str]] = None,
) -> str:
    """
    Generate the Google OAuth 2.0 authorization URL.
    Enforces access_type=offline and prompt=consent to ensure a refresh token is returned.
    """
    resolved_redirect = redirect_uri or settings.google_redirect_uri
    resolved_scopes = scopes or DEFAULT_SCOPES

    if not settings.google_oauth_state_secret:
        raise RuntimeError("GOOGLE_OAUTH_STATE_SECRET is not configured")
    state_payload = {
        "company_id": company_id,
        "session_id": session_id,
        "issued_at": int(time.time()),
        "nonce": secrets.token_urlsafe(18),
    }
    message = json.dumps(state_payload, sort_keys=True, separators=(",", ":")).encode()
    state_payload["signature"] = hmac.new(
        settings.google_oauth_state_secret.encode(), message, hashlib.sha256
    ).hexdigest()
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode("ascii")).digest()
    ).rstrip(b"=").decode("ascii")
    await save_oauth_state(
        nonce=state_payload["nonce"], company_id=company_id, session_id=session_id,
        code_verifier=code_verifier, expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    state = urllib.parse.quote(json.dumps(state_payload, separators=(",", ":")))

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": resolved_redirect,
        "response_type": "code",
        "scope": " ".join(resolved_scopes),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "include_granted_scopes": "true",
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{GOOGLE_AUTH_BASE_URL}?{urllib.parse.urlencode(params)}"


async def verify_authorization_state(state: str) -> dict[str, str] | None:
    if not settings.google_oauth_state_secret or not state:
        return None
    try:
        payload = json.loads(urllib.parse.unquote(state))
        signature = str(payload.pop("signature"))
        issued_at = int(payload["issued_at"])
        if abs(time.time() - issued_at) > 600:
            return None
        message = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        expected = hmac.new(
            settings.google_oauth_state_secret.encode(), message, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return None
        stored = await consume_oauth_state(str(payload["nonce"]), str(payload["company_id"]))
        if not stored:
            return None
        if stored["company_id"] != str(payload["company_id"]) or stored["session_id"] != str(payload["session_id"]):
            return None
        return stored
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None

async def exchange_code_for_tokens(
    code: str,
    redirect_uri: Optional[str] = None,
    code_verifier: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Exchange the authorization code for access and refresh tokens.
    """
    resolved_redirect = redirect_uri or settings.google_redirect_uri

    data = {
        "client_id": settings.google_client_id,
        "client_secret": _google_client_secret(),
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": resolved_redirect,
    }
    if code_verifier:
        data["code_verifier"] = code_verifier

    client = get_http_client()
    response = await client.post(GOOGLE_TOKEN_URL, data=data)
    if response.status_code != 200:
        logger.error("Google OAuth token exchange failed with status %s", response.status_code)
        raise ValueError("Google OAuth token exchange failed")
    return response.json()


async def fetch_google_identity(access_token: str) -> dict[str, str]:
    """Fetch the connected Google subject/email without persisting raw profile data."""
    response = await get_http_client().get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if response.status_code != 200:
        raise ValueError("Google identity lookup failed")
    payload = response.json()
    subject = str(payload.get("sub") or "")
    email = str(payload.get("email") or "")
    if not subject or not email:
        raise ValueError("Google identity response was incomplete")
    return {"subject": subject, "email": email}


async def get_valid_access_token(user_id: str) -> Optional[str]:
    """
    Retrieve an active Google access token for user_id.
    Automatically refreshes the token using the refresh_token if expired or within 60s of expiration.
    """
    token_record = await get_oauth_tokens(user_id=user_id, provider="google")
    if not token_record:
        logger.debug("No OAuth token found for company")
        return None

    expires_at = token_record["expires_at"]
    now = datetime.now(timezone.utc)

    # Check if token is still valid with a 60-second safety cushion
    if expires_at > (now + timedelta(seconds=60)):
        return token_record["access_token"]

    # Token is expired or expiring soon; refresh it
    refresh_token = token_record.get("refresh_token")
    if not refresh_token:
        logger.warning("Google access token expired and no refresh token is stored")
        return None

    logger.info("Google access token expired. Refreshing with Google")
    new_tokens = await refresh_access_token(refresh_token)
    if not new_tokens or "access_token" not in new_tokens:
        logger.error("Failed to refresh Google access token")
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
        google_subject=token_record.get("google_subject"),
        google_email=token_record.get("google_email"),
    )

    logger.info("Google access token refreshed and updated")
    return new_access_token


async def refresh_access_token(refresh_token: str) -> Optional[Dict[str, Any]]:
    """
    Call Google OAuth token endpoint to obtain a fresh access token using refresh_token.
    """
    data = {
        "client_id": settings.google_client_id,
        "client_secret": _google_client_secret(),
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }

    client = get_http_client()
    response = await client.post(GOOGLE_TOKEN_URL, data=data)
    if response.status_code != 200:
        logger.error("Google token refresh failed with status %s", response.status_code)
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
            client = get_http_client()
            res = await client.post(GOOGLE_REVOKE_URL, params={"token": token_to_revoke})
            res.raise_for_status()
        except Exception as exc:
            logger.warning("Google token revocation failed in broker (%s); removing stored credential", type(exc).__name__)

    return await delete_oauth_tokens(user_id=user_id, provider="google")

