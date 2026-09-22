"""The 3CX call-failure action must be explicit and tenant-allowlisted."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.app.api.integrations import ThreeCXRequest
from backend.credential_broker.main import ThreeCXPayload
from db import threecx as threecx_db


def request_fields():
    return {
        "connection_name": "Office",
        "pbx_url": "https://pbx.example.invalid",
        "app_id": "service-principal",
        "route_point_dn": "9000",
        "client_secret": "test-secret-value",
        "dids": ["23050000001"],
        "transfer_destinations": ["8001", "8002"],
    }


@pytest.mark.parametrize("model", [ThreeCXRequest, ThreeCXPayload])
def test_disconnect_is_an_explicit_valid_failure_policy(model):
    fields = request_fields() | {"failure_action": "disconnect", "failure_destination": None}
    if model is ThreeCXPayload:
        fields["company_id"] = "123e4567-e89b-12d3-a456-426614174000"
    parsed = model.model_validate(fields)
    assert parsed.failure_action == "disconnect"
    assert parsed.failure_destination is None


@pytest.mark.parametrize("model", [ThreeCXRequest, ThreeCXPayload])
def test_transfer_failure_policy_must_select_an_allowlisted_destination(model):
    fields = request_fields() | {
        "failure_action": "transfer",
        "failure_destination": "8002",
    }
    if model is ThreeCXPayload:
        fields["company_id"] = "123e4567-e89b-12d3-a456-426614174000"
    parsed = model.model_validate(fields)
    assert parsed.failure_destination == "8002"

    fields["failure_destination"] = "9999"
    with pytest.raises(ValidationError):
        model.model_validate(fields)


def test_threecx_failure_policy_migration_degrades_existing_active_rows():
    migration = (
        Path(__file__).resolve().parents[2]
        / "db"
        / "migrations"
        / "022_threecx_failure_policy.sql"
    ).read_text(encoding="utf-8")
    assert "ADD COLUMN IF NOT EXISTS failure_action" in migration
    assert "ADD COLUMN IF NOT EXISTS failure_destination" in migration
    assert "SET state = 'degraded'" in migration
    assert "failure_action = 'transfer'" in migration
    assert "transfer_destinations @> jsonb_build_array(failure_destination)" in migration


@pytest.mark.asyncio
async def test_repository_rejects_non_allowlisted_fallback_before_database_access(monkeypatch):
    async def unexpected_database_access():
        raise AssertionError("invalid fallback policy must be rejected before SQL")

    monkeypatch.setattr(threecx_db, "get_db_pool", unexpected_database_access)
    with pytest.raises(ValueError, match="explicitly allowlisted"):
        await threecx_db.save_threecx_integration(
            company_id="123e4567-e89b-12d3-a456-426614174000",
            connection_name="Office",
            pbx_hostname="pbx.example.invalid",
            app_id="service-principal",
            route_point_dn="9000",
            client_secret_ciphertext="ciphertext",
            encryption_envelope={},
            dids=["23050000001"],
            transfer_destinations=["8001"],
            failure_action="transfer",
            failure_destination="9999",
        )
