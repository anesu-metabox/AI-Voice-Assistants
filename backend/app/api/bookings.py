"""Authenticated status lookup for deferred calendar booking requests."""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Header, HTTPException, status

from ..auth_context import verify_session_context
from db.booking_requests import cancel_booking_request, get_booking_request, list_booking_requests

logger = logging.getLogger("voice_bot.api.bookings")
router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.get("")
async def recent_booking_requests(
    verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context"),
):
    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    try:
        requests = await list_booking_requests(user_id=context.company_id)
    except Exception as exc:
        logger.error("Booking request list failed (error_type=%s)", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Booking requests unavailable") from exc
    return {"requests": requests}


@router.get("/{request_id}")
async def booking_request_status(
    request_id: str,
    verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context"),
):
    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    try:
        row = await get_booking_request(request_id=request_id, user_id=context.company_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Booking request not found") from exc
    except Exception as exc:
        logger.error("Booking status lookup failed (error_type=%s)", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Booking status unavailable") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Booking request not found")
    return row


@router.post("/{request_id}/cancel")
async def cancel_booking(
    request_id: str,
    verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context"),
):
    context = verify_session_context(verified_context_header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    try:
        cancelled = await cancel_booking_request(request_id=request_id, user_id=context.company_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Booking request not found") from exc
    except Exception as exc:
        logger.error("Booking cancellation failed (error_type=%s)", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Booking cancellation unavailable") from exc
    return {"request_id": request_id, "cancelled": cancelled}
