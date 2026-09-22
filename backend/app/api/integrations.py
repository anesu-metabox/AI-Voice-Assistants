"""Secure tenant-owned integration endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query, status
from pydantic import BaseModel, Field, model_validator

from ..auth_context import verify_session_context
from ..services.credential_broker_client import broker_post
from db.companies import ensure_company
from db.audit import record_integration_event
from db.integration_limits import consume_integration_action_budget
from db.threecx import delete_threecx_integration, get_threecx_integration, list_threecx_call_sessions

router = APIRouter(prefix="/integrations", tags=["integrations"])


class ThreeCXRequest(BaseModel):
    connection_name: str = Field(..., min_length=1, max_length=255)
    pbx_url: str = Field(..., min_length=8, max_length=255)
    app_id: str = Field(..., min_length=1, max_length=255)
    route_point_dn: str = Field(..., min_length=1, max_length=128)
    client_secret: str = Field(..., min_length=8, max_length=4096)
    dids: list[str] = Field(default_factory=list, max_length=100)
    transfer_destinations: list[str] = Field(default_factory=list, max_length=100)
    failure_action: str = Field(..., pattern="^(disconnect|transfer)$")
    failure_destination: str | None = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def validate_failure_policy(self):
        self.transfer_destinations = [
            value.strip() for value in self.transfer_destinations if value.strip()
        ]
        allowed = set(self.transfer_destinations)
        destination = self.failure_destination.strip() if self.failure_destination else None
        if self.failure_action == "transfer" and (not destination or destination not in allowed):
            raise ValueError("failure destination must be one of this integration's approved transfer destinations")
        if self.failure_action == "disconnect" and destination is not None:
            raise ValueError("disconnect failure policy cannot include a transfer destination")
        self.failure_destination = destination
        return self


async def _context(header: str | None):
    context = verify_session_context(header)
    if context is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authenticated context required")
    return context


async def _enforce_threecx_budget(company_id: str, action: str) -> None:
    limit = 5 if action == "threecx_test" else 3
    retry_after = await consume_integration_action_budget(
        company_id=company_id,
        action=action,
        limit=limit,
        window_seconds=900,
    )
    if retry_after is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many 3CX integration attempts. Try again later.",
            headers={"Retry-After": str(retry_after)},
        )


@router.get("/3cx")
async def get_3cx(verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context")):
    context = await _context(verified_context_header)
    await ensure_company(context.company_id, context.auth_subject)
    row = await get_threecx_integration(context.company_id)
    if not row:
        return {"configured": False, "state": "unconfigured"}
    return {
        "configured": True,
        "connectionName": row["connection_name"],
        "pbxHost": row["pbx_hostname"],
        "appId": row["app_id"],
        "routePointDn": row["route_point_dn"],
        "dids": row["dids"],
        "transferDestinations": row["transfer_destinations"],
        "failureAction": row["failure_action"],
        "failureDestination": row["failure_destination"],
        "credentialConfigured": True,
        "credentialUpdatedAt": row["credential_updated_at"].isoformat(),
        "state": row["state"],
        "lastCheckedAt": row["last_checked_at"].isoformat() if row["last_checked_at"] else None,
    }


@router.get("/3cx/calls")
async def list_3cx_calls(
    limit: int = Query(default=50, ge=1, le=100),
    verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context"),
):
    context = await _context(verified_context_header)
    await ensure_company(context.company_id, context.auth_subject)
    rows = await list_threecx_call_sessions(company_id=context.company_id, limit=limit)
    return {
        "calls": [
            {
                "did": row["did"],
                "direction": row["direction"],
                "state": row["state"],
                "createdAt": row["created_at"].isoformat(),
                "updatedAt": row["updated_at"].isoformat(),
                "endedAt": row["ended_at"].isoformat() if row["ended_at"] else None,
            }
            for row in rows
        ]
    }


@router.post("/3cx/test")
async def test_3cx(payload: ThreeCXRequest, verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context")):
    context = await _context(verified_context_header)
    await ensure_company(context.company_id, context.auth_subject)
    await _enforce_threecx_budget(context.company_id, "threecx_test")
    await broker_post("/internal/v1/threecx/test", {
        "company_id": context.company_id,
        **payload.model_dump(),
    })
    await record_integration_event(
        company_id=context.company_id,
        provider="threecx",
        action="connection_test",
        outcome="success",
        metadata={"action_source": "credential_broker"},
    )
    return {"status": "healthy", "message": "3CX connection test succeeded"}


@router.put("/3cx")
async def put_3cx(payload: ThreeCXRequest, verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context")):
    context = await _context(verified_context_header)
    await ensure_company(context.company_id, context.auth_subject)
    await _enforce_threecx_budget(context.company_id, "threecx_save")
    saved = await broker_post("/internal/v1/threecx/save", {
        "company_id": context.company_id,
        **payload.model_dump(),
    })
    await record_integration_event(
        company_id=context.company_id, provider="threecx", action="credentials_rotated",
        outcome="success", metadata={"pbx_host": saved["pbxHost"], "dids_count": len(payload.dids)},
    )
    return {"status": "success", "data": saved}


@router.delete("/3cx")
async def delete_3cx(verified_context_header: str | None = Header(default=None, alias="X-Verified-Session-Context")):
    context = await _context(verified_context_header)
    await ensure_company(context.company_id, context.auth_subject)
    disconnected = await delete_threecx_integration(context.company_id)
    await record_integration_event(
        company_id=context.company_id,
        provider="threecx",
        action="disconnect",
        outcome="success",
        metadata={"deleted": disconnected},
    )
    return {"status": "success", "disconnected": disconnected}
