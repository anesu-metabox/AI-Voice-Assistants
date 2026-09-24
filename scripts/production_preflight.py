"""Fail-closed, value-redacted checks for Railway production configuration.

Railway snapshots accepted by this tool contain service metadata and variable
names only. Secret-bearing variable maps are rejected. Runtime mode validates
the environment of exactly one service and never emits values or exceptions.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import sys
from typing import Any, Mapping
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_POLICY = ROOT / "config" / "production-preflight.json"
REQUIRED_UNKNOWN = {
    "shared_secret_equality", "cross_service_secret_equality",
    "neon_endpoint_branch_identity", "neon_runtime_role_flags",
}
SNAPSHOT_KEYS = {
    "projectId", "projectName", "environmentId", "environmentName", "services"
}
SERVICE_KEYS = {
    "id", "name", "deploymentStatus", "commitSha", "repository", "branch",
    "variableNames", "hasPublicDomain", "privateEndpoint",
}


def _finding(check: str, status: str, service: str | None = None, detail: str | None = None) -> dict[str, str]:
    item = {"check": check, "status": status}
    if service:
        item["service"] = service
    if detail:
        item["detail"] = detail
    return item


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("input file is unavailable or invalid JSON") from exc


def validate_snapshot(snapshot: Any, policy: Mapping[str, Any]) -> list[dict[str, str]]:
    """Validate a sanitized Railway metadata snapshot; never accept variable values."""
    if not isinstance(snapshot, dict) or set(snapshot) != SNAPSHOT_KEYS:
        raise ValueError("snapshot must contain only the documented metadata fields")
    services = snapshot.get("services")
    if not isinstance(services, list):
        raise ValueError("snapshot services must be a list")

    expected_project = policy["expectedProject"]
    findings: list[dict[str, str]] = []
    project_ok = snapshot.get("projectId") == expected_project["id"] and snapshot.get("projectName") == expected_project["name"]
    findings.append(_finding("railway_project", "PASS" if project_ok else "FAIL"))
    environment_ok = snapshot.get("environmentName") == expected_project["environment"] and bool(snapshot.get("environmentId"))
    findings.append(_finding("railway_environment", "PASS" if environment_ok else "FAIL"))

    by_name: dict[str, dict[str, Any]] = {}
    for service in services:
        if not isinstance(service, dict) or set(service) != SERVICE_KEYS:
            # This also rejects `variables`/`values`, so a plaintext export never
            # gets passed through this reporting code accidentally.
            raise ValueError("service snapshot must contain metadata fields only")
        name = service.get("name")
        variable_names = service.get("variableNames")
        if not isinstance(name, str) or not isinstance(variable_names, list) or any(not isinstance(k, str) for k in variable_names):
            raise ValueError("service name or variable-name inventory is invalid")
        if name in by_name:
            findings.append(_finding("duplicate_service", "FAIL", name))
        by_name[name] = service

    expected_services = policy["services"]
    for unexpected in sorted(set(by_name) - set(expected_services)):
        findings.append(_finding("unexpected_service", "FAIL", unexpected))

    active_commits: list[str] = []
    for name, rule in expected_services.items():
        service = by_name.get(name)
        if service is None:
            findings.append(_finding("service_present", "FAIL", name))
            continue
        findings.append(_finding("service_present", "PASS", name))

        status = service.get("deploymentStatus")
        findings.append(_finding("deployment_active", "PASS" if status == "SUCCESS" else "FAIL", name))
        commit = service.get("commitSha")
        repo = service.get("repository")
        source_ok = isinstance(commit, str) and bool(commit) and repo == policy["expectedRepository"]
        findings.append(_finding("source_identity", "PASS" if source_ok else "FAIL", name))
        branch = service.get("branch")
        if not branch:
            findings.append(_finding("source_branch", "UNKNOWN", name))
        if isinstance(commit, str) and commit:
            active_commits.append(commit)

        names = set(service["variableNames"])
        for key in rule["required"]:
            findings.append(_finding(f"required:{key}", "PASS" if key in names else "FAIL", name))
        for alternatives in rule.get("oneOf", []):
            matched = sorted(set(alternatives) & names)
            findings.append(_finding(f"one_of:{'|'.join(alternatives)}", "PASS" if matched else "FAIL", name))
        for key in rule["forbidden"]:
            findings.append(_finding(f"forbidden_absent:{key}", "FAIL" if key in names else "PASS", name))
        has_public = service["hasPublicDomain"]
        has_private = service["privateEndpoint"]
        findings.append(_finding("network_public_scope", "PASS" if has_public is rule["publicDomain"] else "FAIL", name))
        findings.append(_finding("network_private_endpoint", "PASS" if (not rule["privateEndpoint"] or has_private) else "FAIL", name))

    if policy.get("requireOneReleaseCommit"):
        all_present = all(name in by_name for name in expected_services)
        same_commit = len(active_commits) == len(expected_services) and len(set(active_commits)) == 1
        findings.append(_finding("release_commit_alignment", "PASS" if all_present and same_commit else "FAIL"))
    if policy.get("requireOneSourceBranch"):
        branches = [by_name[name].get("branch") for name in expected_services if name in by_name]
        findings.append(_finding("release_branch_alignment", "PASS" if len(branches) == len(expected_services) and all(branches) and len(set(branches)) == 1 else "FAIL"))

    # Names-only metadata cannot prove the values, effective role, or identity.
    for check in (
        "shared_secret_equality",
        "runtime_values_and_url_semantics",
        "neon_endpoint_branch_identity",
        "neon_runtime_role_flags",
    ):
        findings.append(_finding(check, "UNKNOWN"))
    return findings


def validate_runtime_environment(
    role: str,
    env: Mapping[str, str],
    policy: Mapping[str, Any],
    *,
    database_probed: bool = False,
) -> list[dict[str, str]]:
    """Validate one workload's live process environment; output statuses only."""
    rule = next((item for item in policy["services"].values() if item["role"] == role), None)
    if rule is None:
        raise ValueError("unknown service role")
    findings: list[dict[str, str]] = []
    for key in rule["required"]:
        present = bool(env.get(key, "").strip())
        findings.append(_finding(f"present:{key}", "PASS" if present else "FAIL", role))
    for alternatives in rule.get("oneOf", []):
        present = any(bool(env.get(key, "").strip()) for key in alternatives)
        findings.append(_finding(f"one_of_present:{'|'.join(alternatives)}", "PASS" if present else "FAIL", role))
    for key in rule["forbidden"]:
        absent = not bool(env.get(key, "").strip())
        findings.append(_finding(f"absent:{key}", "PASS" if absent else "FAIL", role))

    if "APP_ENV" in rule["required"]:
        production = env.get("APP_ENV", "").strip().lower() in {"prod", "production"}
        findings.append(_finding("production_mode", "PASS" if production else "FAIL", role))
    if "DATABASE_URL" in rule["required"] and env.get("DATABASE_URL", "").strip():
        parsed = urlsplit(env["DATABASE_URL"])
        runtime_user = env.get("RUNTIME_DB_ROLE", "").strip()
        valid = parsed.scheme in {"postgres", "postgresql"} and bool(parsed.hostname and parsed.username)
        matches = valid and parsed.username == runtime_user
        findings.append(_finding("database_url_shape", "PASS" if valid else "FAIL", role))
        findings.append(_finding("database_user_matches_runtime_role", "PASS" if matches else "FAIL", role))
    if role == "booking_worker" and env.get("BOOKING_WORKER_DATABASE_URL", "").strip():
        parsed = urlsplit(env["BOOKING_WORKER_DATABASE_URL"])
        valid = parsed.scheme in {"postgres", "postgresql"} and bool(parsed.hostname and parsed.username)
        matches = valid and parsed.username == env.get("BOOKING_WORKER_DB_ROLE", "").strip()
        findings.append(_finding("booking_worker_database_url_shape", "PASS" if valid else "FAIL", role))
        findings.append(_finding("booking_worker_database_user_matches_role", "PASS" if matches else "FAIL", role))
    if role == "broker":
        def valid_key(key_value: str) -> bool:
            try:
                decoded = base64.b64decode(key_value.encode("ascii"), altchars=b"-_", validate=True)
                return len(decoded) == 32
            except Exception:
                return False

        current_key = env.get("CREDENTIAL_ENCRYPTION_KEY", "")
        findings.append(_finding("broker_encryption_key_shape", "PASS" if valid_key(current_key) else "FAIL", role))
        previous_version = env.get("CREDENTIAL_ENCRYPTION_PREVIOUS_KEY_VERSION", "").strip()
        previous_key = env.get("CREDENTIAL_ENCRYPTION_PREVIOUS_KEY", "")
        rotation_pair_valid = bool(previous_version) == bool(previous_key)
        findings.append(_finding("broker_previous_key_pair", "PASS" if rotation_pair_valid else "FAIL", role))
        if previous_key:
            findings.append(_finding("broker_previous_key_shape", "PASS" if valid_key(previous_key) else "FAIL", role))
    if role == "frontend":
        backend = env.get("BACKEND_URL", "").strip()
        findings.append(_finding("backend_url_scheme", "PASS" if urlsplit(backend).scheme == "https" else "FAIL", role))
        origin = env.get("APP_ORIGIN", "").strip()
        parsed_origin = urlsplit(origin)
        findings.append(_finding("app_origin_https", "PASS" if parsed_origin.scheme == "https" and parsed_origin.netloc else "FAIL", role))
    if role == "api":
        origins = [origin.strip() for origin in env.get("CORS_ORIGINS", "").split(",") if origin.strip()]
        valid_origins = bool(origins) and "*" not in origins and all(urlsplit(origin).scheme == "https" and bool(urlsplit(origin).netloc) for origin in origins)
        findings.append(_finding("cors_origins_https", "PASS" if valid_origins else "FAIL", role))
        broker_url = urlsplit(env.get("CREDENTIAL_BROKER_URL", "").strip())
        broker_scheme_ok = (
            broker_url.scheme == "https"
            or (
                broker_url.scheme == "http"
                and bool(broker_url.hostname)
                and (
                    broker_url.hostname.endswith(".railway.internal")
                    or broker_url.hostname.endswith(".internal")
                    or broker_url.hostname in {"localhost", "127.0.0.1"}
                )
            )
        )
        findings.append(_finding("broker_url_https", "PASS" if broker_scheme_ok and broker_url.hostname else "FAIL", role))
    if role == "broker":
        findings.append(_finding("public_ingress_absent", "UNKNOWN"))
    # A one-service process cannot safely prove equality against other Railway
    # workloads. Never use value hashes/fingerprints as a substitute.
    findings.append(_finding("cross_service_secret_equality", "UNKNOWN", role))
    findings.append(_finding("neon_endpoint_branch_identity", "UNKNOWN", role))
    if not database_probed:
        check = "booking_worker_table_grants_restricted" if role == "booking_worker" else "neon_runtime_role_flags"
        findings.append(_finding(check, "UNKNOWN", role))
    return findings


def probe_database(dsn: str, runtime_role: str) -> list[dict[str, str]]:
    """Read only current database role flags; do not report identifiers or DSNs."""
    try:
        import asyncpg
    except ImportError:
        return [_finding("database_probe", "UNKNOWN")]

    async def query() -> tuple[bool, bool]:
        conn = await asyncpg.connect(dsn, ssl="require", timeout=8)
        try:
            async with conn.transaction(readonly=True):
                row = await conn.fetchrow(
                    """SELECT current_user = $1 AS role_matches,
                              r.rolsuper AS is_superuser,
                              r.rolbypassrls AS bypasses_rls
                       FROM pg_roles r WHERE r.rolname = current_user""",
                    runtime_role,
                )
            if row is None:
                raise RuntimeError
            return bool(row["role_matches"]), bool(row["is_superuser"] or row["bypasses_rls"])
        finally:
            await conn.close()

    try:
        matches, bypass = asyncio.run(query())
    except Exception:
        # Database drivers may include connection details in exception strings.
        return [_finding("database_probe", "FAIL")]
    return [
        _finding("database_probe", "PASS"),
        _finding("database_user_matches_runtime_role", "PASS" if matches else "FAIL"),
        _finding("neon_runtime_role_flags", "FAIL" if bypass else "PASS"),
        _finding("neon_endpoint_branch_identity", "UNKNOWN"),
    ]


def probe_booking_worker_database(dsn: str, worker_role: str) -> list[dict[str, str]]:
    """Verify the intentionally BYPASSRLS role is limited to the booking queue."""
    try:
        import asyncpg
    except ImportError:
        return [_finding("database_probe", "UNKNOWN")]

    async def query() -> tuple[bool, bool, bool]:
        conn = await asyncpg.connect(dsn, ssl="require", timeout=8)
        try:
            async with conn.transaction(readonly=True):
                row = await conn.fetchrow(
                    """SELECT current_user = $1 AS role_matches,
                              r.rolsuper AS is_superuser,
                              r.rolbypassrls AS bypasses_rls,
                              r.rolinherit AS inherits_roles,
                              has_table_privilege(current_user, 'public.calendar_booking_requests', 'SELECT') AS can_read_queue,
                              has_column_privilege(current_user, 'public.calendar_booking_requests', 'status', 'UPDATE') AS can_update_queue,
                              has_column_privilege(current_user, 'public.calendar_booking_requests', 'user_id', 'UPDATE') AS can_change_tenant,
                              EXISTS (
                                SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                                 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
                                   AND c.relname <> 'calendar_booking_requests'
                                   AND (has_table_privilege(current_user, c.oid, 'SELECT')
                                     OR has_table_privilege(current_user, c.oid, 'INSERT')
                                     OR has_table_privilege(current_user, c.oid, 'UPDATE')
                                     OR has_table_privilege(current_user, c.oid, 'DELETE'))
                              ) AS has_other_public_table_access
                       FROM pg_roles r WHERE r.rolname = current_user""",
                    worker_role,
                )
            if row is None:
                raise RuntimeError
            valid = (not row["is_superuser"] and row["bypasses_rls"] and not row["inherits_roles"]
                     and row["can_read_queue"] and row["can_update_queue"]
                     and not row["can_change_tenant"] and not row["has_other_public_table_access"])
            return bool(row["role_matches"]), bool(valid), bool(row["is_superuser"])
        finally:
            await conn.close()

    try:
        matches, grants_valid, is_superuser = asyncio.run(query())
    except Exception:
        return [_finding("database_probe", "FAIL")]
    return [
        _finding("database_probe", "PASS"),
        _finding("booking_worker_database_user_matches_role", "PASS" if matches else "FAIL"),
        _finding("booking_worker_db_is_not_superuser", "PASS" if not is_superuser else "FAIL"),
        _finding("booking_worker_table_grants_restricted", "PASS" if grants_valid else "FAIL"),
        _finding("neon_endpoint_branch_identity", "UNKNOWN"),
    ]


def emit(findings: list[dict[str, str]]) -> int:
    print(json.dumps({"checks": findings}, sort_keys=True))
    return 1 if any(
        item["status"] == "FAIL" or (item["status"] == "UNKNOWN" and item["check"] in REQUIRED_UNKNOWN)
        for item in findings
    ) else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    parser.add_argument("--snapshot", type=Path, help="sanitized Railway metadata JSON; names only")
    parser.add_argument("--runtime-role", choices=("frontend", "api", "worker", "broker", "booking_worker"))
    parser.add_argument("--probe-database", action="store_true", help="read-only role flag check using current process DATABASE_URL")
    args = parser.parse_args(argv)
    try:
        policy = load_json(args.policy)
        findings: list[dict[str, str]] = []
        if args.snapshot:
            findings.extend(validate_snapshot(load_json(args.snapshot), policy))
        if args.runtime_role:
            findings.extend(validate_runtime_environment(
                args.runtime_role,
                os.environ,
                policy,
                database_probed=args.probe_database,
            ))
        if args.probe_database:
            booking_worker = args.runtime_role == "booking_worker"
            dsn = os.getenv("BOOKING_WORKER_DATABASE_URL", "") if booking_worker else os.getenv("DATABASE_URL", "")
            role = os.getenv("BOOKING_WORKER_DB_ROLE", "") if booking_worker else os.getenv("RUNTIME_DB_ROLE", "")
            if not dsn or not role:
                findings.append(_finding("database_probe", "FAIL"))
            elif booking_worker:
                findings.extend(probe_booking_worker_database(dsn, role))
            else:
                findings.extend(probe_database(dsn, role))
        if not findings:
            parser.error("provide --snapshot, --runtime-role, or --probe-database")
        return emit(findings)
    except ValueError as exc:
        # Deliberately omit the underlying exception text.
        print(json.dumps({"checks": [_finding("input_validation", "FAIL")]}, sort_keys=True))
        return 2


if __name__ == "__main__":
    sys.exit(main())
