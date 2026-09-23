"""Private integration broker. Exposes provider results, never credentials."""

from contextlib import asynccontextmanager
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any
import logging
import uuid
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from .environment import load_broker_environment

load_broker_environment()

from backend.app.services.credential_broker_protocol import require_broker_secret, verify_broker_request
from backend.app.services.google_calendar import (
    book_google_calendar_event,
    cancel_google_calendar_event,
    get_google_calendar_availability,
    list_google_calendar_events,
)
from backend.app.services.google_oauth import (
    exchange_code_for_tokens,
    fetch_google_identity,
    revoke_and_disconnect,
)
from backend.app.services.credential_envelope import encrypt_secret
from backend.app.services.threecx_probe import probe_pbx
from backend.app.config import settings
from db.connection import close_db_pool, get_db_pool
from db.tokens import save_oauth_tokens
from db.threecx import save_threecx_integration

logger = logging.getLogger("voice_bot.credential_broker")
_THREECX_PROBE_CONCURRENCY = 4
_THREECX_PROBE_QUEUE_TIMEOUT_SECONDS = 0.25
_threecx_probe_slots = asyncio.Semaphore(_THREECX_PROBE_CONCURRENCY)


async def _probe_threecx(pbx_url: str, app_id: str, client_secret: str):
    try:
        await asyncio.wait_for(
            _threecx_probe_slots.acquire(), timeout=_THREECX_PROBE_QUEUE_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=503, detail="3CX probe capacity is temporarily unavailable") from exc
    try:
        return await probe_pbx(pbx_url, app_id, client_secret)
    finally:
        _threecx_probe_slots.release()


class BrokerPayload(BaseModel):
    company_id: uuid.UUID


class CalendarListPayload(BrokerPayload):
    start_date: str | None = Field(default=None, max_length=10)
    end_date: str | None = Field(default=None, max_length=10)
    timezone: str = Field(default="Indian/Mauritius", max_length=64)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("timezone must be a valid IANA timezone") from exc
        return value


class CalendarAvailabilityPayload(CalendarListPayload):
    duration_minutes: int = Field(default=30, ge=5, le=1440)
    business_hours: dict[str, str] | None = Field(default=None)

    @field_validator("business_hours")
    @classmethod
    def validate_business_hours(cls, value: dict[str, str] | None):
        if value is None:
            return None
        valid_days = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}
        if len(value) > 7 or any(
            day.lower() not in valid_days or not isinstance(hours, str) or len(hours) > 100
            for day, hours in value.items()
        ):
            raise ValueError("business_hours must contain at most seven bounded weekday entries")
        return value


class CalendarBookPayload(BrokerPayload):
    title: str = Field(min_length=1, max_length=255)
    start_time: str = Field(min_length=10, max_length=64)
    duration_minutes: int = Field(default=30, ge=5, le=1440)
    attendees: list[str] = Field(default_factory=list, max_length=100)
    description: str | None = Field(default=None, max_length=8000)
    location: str | None = Field(default="Google Meet", max_length=255)


class CalendarCancelPayload(BrokerPayload):
    event_id: str = Field(min_length=1, max_length=255)


class OAuthCompletePayload(BrokerPayload):
    code: str = Field(min_length=1, max_length=4096)
    code_verifier: str = Field(min_length=43, max_length=128)


class OAuthDisconnectPayload(BrokerPayload):
    pass


class ThreeCXPayload(BrokerPayload):
    connection_name: str = Field(min_length=1, max_length=255)
    pbx_url: str = Field(min_length=8, max_length=255)
    app_id: str = Field(min_length=1, max_length=255)
    route_point_dn: str = Field(min_length=1, max_length=128)
    client_secret: str = Field(min_length=8, max_length=4096)
    dids: list[str] = Field(default_factory=list, max_length=100)
    transfer_destinations: list[str] = Field(default_factory=list, max_length=100)
    failure_action: str = Field(pattern="^(disconnect|transfer)$")
    failure_destination: str | None = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def validate_failure_policy(self):
        self.transfer_destinations = [
            value.strip() for value in self.transfer_destinations if value.strip()
        ]
        allowed = set(self.transfer_destinations)
        destination = self.failure_destination.strip() if self.failure_destination else None
        if self.failure_action == "transfer" and (not destination or destination not in allowed):
            raise ValueError("failure destination must be allowlisted")
        if self.failure_action == "disconnect" and destination is not None:
            raise ValueError("disconnect failure policy cannot include a destination")
        self.failure_destination = destination
        return self


async def _validated(payload: dict[str, Any], model: type[BaseModel]):
    try:
        return model.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="Invalid broker operation payload") from exc


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Starting isolated credential broker")
    require_broker_secret()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required by the credential broker")
    await get_db_pool(dsn=settings.database_url)
    yield
    await close_db_pool()


app = FastAPI(
    title="Private Credential Broker",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "credential-broker"}


@app.post("/internal/v1/calendar/list")
async def calendar_list(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, CalendarListPayload)
    result = await list_google_calendar_events(
        str(request.company_id), request.start_date, request.end_date, request.timezone
    )
    return result or {"status": "integration_required", "error_code": "GOOGLE_CALENDAR_REQUIRED"}


@app.post("/internal/v1/calendar/availability")
async def calendar_availability(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, CalendarAvailabilityPayload)
    result = await get_google_calendar_availability(
        str(request.company_id), request.start_date, request.end_date,
        request.duration_minutes, request.timezone, request.business_hours,
    )
    if result:
        result["timezone"] = request.timezone
        return result
    return {"status": "integration_required", "error_code": "GOOGLE_CALENDAR_REQUIRED"}


@app.post("/internal/v1/calendar/book")
async def calendar_book(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, CalendarBookPayload)
    result = await book_google_calendar_event(
        str(request.company_id), request.title, request.start_time,
        request.duration_minutes, request.attendees, request.description, request.location,
    )
    return result or {"status": "integration_required", "error_code": "GOOGLE_CALENDAR_REQUIRED"}


@app.post("/internal/v1/calendar/cancel")
async def calendar_cancel(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, CalendarCancelPayload)
    success = await cancel_google_calendar_event(str(request.company_id), request.event_id)
    return {"status": "cancelled" if success else "integration_required", "event_id": request.event_id}


@app.post("/internal/v1/google/oauth/complete")
async def google_oauth_complete(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, OAuthCompletePayload)
    try:
        token_data = await exchange_code_for_tokens(
            code=request.code, code_verifier=request.code_verifier
        )
        access_token = str(token_data.get("access_token") or "")
        if not access_token:
            raise HTTPException(status_code=502, detail="Google did not return an access token")
        identity = await fetch_google_identity(access_token)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(token_data.get("expires_in", 3600)))
        await save_oauth_tokens(
            user_id=str(request.company_id), provider="google",
            access_token=access_token, refresh_token=token_data.get("refresh_token"),
            token_type=str(token_data.get("token_type") or "Bearer"),
            scope=token_data.get("scope"), expires_at=expires_at,
            google_subject=identity["subject"], google_email=identity["email"],
        )
        # Do not log or serialize token_data/access_token from this process.
        return {
            "connected": True,
            "google_email": identity["email"],
            "scope": token_data.get("scope"),
            "expires_at": expires_at.isoformat(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("OAuth completion failed in credential broker (%s: %s)", type(exc).__name__, exc)
        raise HTTPException(status_code=502, detail="Google account connection failed") from exc


@app.post("/internal/v1/google/oauth/disconnect")
async def google_oauth_disconnect(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, OAuthDisconnectPayload)
    try:
        disconnected = await revoke_and_disconnect(str(request.company_id))
    except Exception as exc:
        logger.error("OAuth disconnect failed in credential broker (%s)", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Google account disconnect failed") from exc
    return {"disconnected": disconnected}


@app.post("/internal/v1/threecx/test")
async def threecx_test(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, ThreeCXPayload)
    host, _addresses = await _probe_threecx(request.pbx_url, request.app_id, request.client_secret)
    return {"status": "healthy", "pbxHost": host}


@app.post("/internal/v1/threecx/save")
async def threecx_save(payload: dict = Depends(verify_broker_request)):
    request = await _validated(payload, ThreeCXPayload)
    host, _addresses = await _probe_threecx(request.pbx_url, request.app_id, request.client_secret)
    ciphertext, envelope = await asyncio.to_thread(
        encrypt_secret, request.client_secret,
        company_id=str(request.company_id), provider="threecx", field="client_secret",
    )
    saved = await save_threecx_integration(
        company_id=str(request.company_id), connection_name=request.connection_name,
        pbx_hostname=host, app_id=request.app_id, route_point_dn=request.route_point_dn,
        client_secret_ciphertext=ciphertext, encryption_envelope=envelope,
        dids=request.dids, transfer_destinations=request.transfer_destinations,
        failure_action=request.failure_action, failure_destination=request.failure_destination,
    )
    return {
        "configured": True,
        "connectionName": saved["connection_name"],
        "pbxHost": saved["pbx_hostname"],
        "state": saved["state"],
    }
