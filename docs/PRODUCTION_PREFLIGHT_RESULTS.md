# Production Configuration Preflight — 23 September 2026

This is a redacted read-only snapshot of Railway metadata. It contains service IDs, source metadata, variable **names**, and pass/fail results only. No Railway variable values, Neon connection strings, or secrets were retrieved or reported. AWS/KMS is out of scope; Railway is the only deployment platform in the current plan.

## Scope and safety

- Railway project: **AI Voice Bot Development**, environment **production**.
- Inspected Railway service status and `get_service_config` metadata, whose response provides variable names but omits values.
- No Railway or Neon settings were changed. No deploy or database query was run.
- The sanitized source snapshot used by the preflight is [production-config-preflight-2026-09-23.json](reports/production-config-preflight-2026-09-23.json).
- Re-run the static metadata validator with:

  ```powershell
  .\.venv\Scripts\python.exe scripts/production_preflight.py `
    --snapshot docs/reports/production-config-preflight-2026-09-23.json
  ```

## Results

All five Railway services reported deployment status `SUCCESS`; that status does not certify correct configuration.

| Check | Result | Evidence |
| --- | --- | --- |
| Expected Railway project/environment | PASS | Project and environment identifiers match the configured preflight policy. |
| Core service inventory | PASS | `AI Voice Bot`, `Voice API`, `Credential Broker`, and `LiveKit Worker` exist. |
| Unexpected service | FAIL | `Next.js with Neon` is an extra public service sourced from `neondatabase-labs/neon-railway-nextjs`, with no variables configured. Its intended purpose is unresolved. |
| Broker ingress boundary | PASS | Broker has a private endpoint and no public service domain in the inspected metadata. |
| Worker ingress boundary | PASS | Worker has no public service domain. |
| Frontend secret placement | FAIL | `AI Voice Bot` lists `DATABASE_URL`, `GEMINI_API_KEY`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`; these are forbidden in the frontend workload by the repository's production boundary. `LIVEKIT_URL` is also present and should be reviewed against the active frontend source. |
| API runtime-role configuration | FAIL | `Voice API` does not list `RUNTIME_DB_ROLE`. A variable-name check cannot establish the actual database user's flags. |
| Broker runtime-role configuration | FAIL | `Credential Broker` does not list `RUNTIME_DB_ROLE`. |
| Broker encryption-key placement | PASS (name/scope only) | The Railway Credential Broker lists `CREDENTIAL_ENCRYPTION_KEY`; its value/format was not read. The current code uses this broker-only Railway secret for AES-GCM envelope encryption. |
| Legacy provider selector | NOTE | The broker also lists `CREDENTIAL_KEY_PROVIDER` from the former KMS design. The updated implementation ignores this variable; remove it during a later Railway configuration cleanup if desired. |
| Release revision alignment | FAIL | API, broker, and worker are on `develop` at `6deef3f271f7aed7419578aa36bf78a44fc0595c`; the production `AI Voice Bot` frontend is on `main` at `3b980eb`. These are not one reviewed commit/branch set. |
| Secret equality | UNKNOWN | Matching variable names exist for session context on frontend/API/worker and broker HMAC on API/broker, but values were intentionally not retrieved. |
| Actual Neon branch and runtime role flags | UNKNOWN | `DATABASE_URL` and `NEON_BRANCH` names exist on API/broker, but values and live PostgreSQL identity were not inspected. Neon project discovery in the connected account returned projects named `Zimthreads Collective` and `Luxury Shop Mauritius`; neither identifies the AI Voice Bot database. No connection string was requested. |
| Broker encryption key value/format and rotation readiness | UNKNOWN | Railway metadata returns names only. The current key name is confined to the private broker by the inventory; a broker-side runtime preflight must confirm it decodes to 32 bytes and any previous-key settings form a valid pair. |
| Runtime URL/origin values | UNKNOWN | Variable names are present, but the values behind API URL, broker URL, CORS origins, redirect URI, and frontend origin were not retrieved. |

The machine-readable validator exits nonzero because of the confirmed scope/revision failures and unresolved required identity checks. It does not attempt to repair them.

## Required owner-approved follow-up

1. Confirm the purpose of the extra `Next.js with Neon` service. Do not delete or modify it as part of this read-only preflight.
2. Review the frontend's private variable scope and remove unnecessary server credentials only after confirming the exact deployed commit/runtime contract and arranging an approved Railway change.
3. Configure and verify a dedicated `NOSUPERUSER NOBYPASSRLS` runtime role for API and broker. Use a safe database identity probe on the intended production branch; do not print DSNs or inspect customer rows.
4. In Railway, ensure `CREDENTIAL_ENCRYPTION_KEY` is set only on the private Credential Broker and is URL-safe-base64 encoding of 32 random bytes. Set key version `1`; do not add AWS/KMS variables. Use the documented overlap procedure for any future rotation.
5. Reconcile the deployed frontend/API/broker/worker source revisions as one reviewed release. This report does not authorize deployment or rollback.
6. Have an authorized runtime operator run per-service value-presence and syntax checks in each Railway workload. Validate cross-service equality with an in-memory verifier that emits only booleans; if that cannot be done safely, retain `UNKNOWN`.
7. Re-run the preflight after changes and append fresh evidence. Broader migration, RLS-policy, grant, and schema inventory remains QA roadmap item 3.

## Implementation boundary

The preflight is diagnostic only. It never changes Railway variables, deploys services, mutates Neon, rotates credentials, or applies migrations. Fixes for the failures above require an explicit configuration/remediation task and should be performed one service at a time with rollback available.
