from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.production_preflight import (
    DEFAULT_POLICY,
    emit,
    load_json,
    validate_runtime_environment,
    validate_snapshot,
)


def _snapshot(policy):
    services = []
    commit = "a" * 40
    for name, rule in policy["services"].items():
        names = set(rule["required"])
        for group in rule.get("oneOf", []):
            names.add(group[0])
        services.append({
            "id": f"id-{name}",
            "name": name,
            "deploymentStatus": "SUCCESS",
            "commitSha": commit,
            "repository": policy["expectedRepository"],
            "branch": "main",
            "variableNames": sorted(names),
            "hasPublicDomain": rule["publicDomain"],
            "privateEndpoint": True,
        })
    return {
        "projectId": policy["expectedProject"]["id"],
        "projectName": policy["expectedProject"]["name"],
        "environmentId": "environment-id",
        "environmentName": policy["expectedProject"]["environment"],
        "services": services,
    }


def test_snapshot_passes_metadata_policy_but_keeps_secret_and_live_identity_checks_unknown():
    policy = load_json(DEFAULT_POLICY)
    findings = validate_snapshot(_snapshot(policy), policy)
    statuses = {(item.get("service"), item["check"]): item["status"] for item in findings}
    assert statuses[(None, "railway_project")] == "PASS"
    assert statuses[("Credential Broker", "required:CREDENTIAL_ENCRYPTION_KEY")] == "PASS"
    assert statuses[(None, "shared_secret_equality")] == "UNKNOWN"
    assert statuses[(None, "neon_endpoint_branch_identity")] == "UNKNOWN"
    assert statuses[("AI Voice Bot", "forbidden_absent:CREDENTIAL_ENCRYPTION_KEY")] == "PASS"


def test_snapshot_flags_missing_and_forbidden_scoped_variables():
    policy = load_json(DEFAULT_POLICY)
    snapshot = _snapshot(policy)
    frontend = next(item for item in snapshot["services"] if item["name"] == "AI Voice Bot")
    frontend["variableNames"] += ["DATABASE_URL", "LIVEKIT_API_SECRET"]
    api = next(item for item in snapshot["services"] if item["name"] == "Voice API")
    api["variableNames"].remove("RUNTIME_DB_ROLE")
    findings = validate_snapshot(snapshot, policy)
    checks = {(item.get("service"), item["check"]): item["status"] for item in findings}
    assert checks[("AI Voice Bot", "forbidden_absent:DATABASE_URL")] == "FAIL"
    assert checks[("AI Voice Bot", "forbidden_absent:LIVEKIT_API_SECRET")] == "FAIL"
    assert checks[("Voice API", "required:RUNTIME_DB_ROLE")] == "FAIL"


def test_snapshot_rejects_plaintext_variable_payload_without_echoing_values():
    policy = load_json(DEFAULT_POLICY)
    snapshot = _snapshot(policy)
    sentinel = "never-print-this-secret"
    snapshot["services"][0]["variables"] = {"DATABASE_URL": sentinel}
    with pytest.raises(ValueError):
        validate_snapshot(snapshot, policy)


def test_runtime_checks_only_emit_variable_names_and_booleans():
    policy = load_json(DEFAULT_POLICY)
    sentinel = "runtime-secret-sentinel"
    env = {key: "configured" for key in policy["services"]["Voice API"]["required"]}
    env.update({
        "APP_ENV": "production",
        "DATABASE_URL": "postgresql://voice_runtime:secret@db.example.invalid/app",
        "RUNTIME_DB_ROLE": "voice_runtime",
        "CORS_ORIGINS": "https://app.example.invalid",
        "CREDENTIAL_BROKER_URL": "https://broker.railway.internal",
        "CREDENTIAL_BROKER_SHARED_SECRET": sentinel,
    })
    findings = validate_runtime_environment("api", env, policy)
    rendered = json.dumps(findings)
    assert sentinel not in rendered
    assert "voice_runtime" not in rendered
    checks = {item["check"]: item["status"] for item in findings}
    assert checks["production_mode"] == "PASS"
    assert checks["database_user_matches_runtime_role"] == "PASS"
    assert checks["cors_origins_https"] == "PASS"
    assert checks["broker_url_https"] == "PASS"
    assert checks["cross_service_secret_equality"] == "UNKNOWN"


def test_broker_runtime_checks_key_shape_without_echoing_key():
    policy = load_json(DEFAULT_POLICY)
    key = "b" * 43  # Not a valid encoding of a 32-byte key.
    env = {key_name: "configured" for key_name in policy["services"]["Credential Broker"]["required"]}
    env.update({
        "APP_ENV": "production",
        "DATABASE_URL": "postgresql://voice_runtime:pw@db.example.invalid/app",
        "RUNTIME_DB_ROLE": "voice_runtime",
        "CREDENTIAL_ENCRYPTION_KEY": key,
    })
    findings = validate_runtime_environment("broker", env, policy)
    rendered = json.dumps(findings)
    assert key not in rendered
    assert {item["check"]: item["status"] for item in findings}["broker_encryption_key_shape"] == "FAIL"


def test_unknown_critical_identity_checks_fail_closed(capsys):
    code = emit([{"check": "neon_endpoint_branch_identity", "status": "UNKNOWN"}])
    assert code != 0
    output = capsys.readouterr().out
    assert "UNKNOWN" in output


def test_policy_file_has_explicit_service_roles():
    policy = load_json(Path(DEFAULT_POLICY))
    roles = {service["role"] for service in policy["services"].values()}
    assert roles == {"frontend", "api", "broker", "worker"}
