# Production Configuration Preflight — Implementation Plan

**QA roadmap item:** 2 — verify Railway production configuration safely before treating the deployment as ready.

**Status:** Implemented for Railway-only operation. AWS/KMS requirements below are superseded by the Railway broker-key design documented in [PRODUCTION_ROLLOUT_CHECKLIST.md](PRODUCTION_ROLLOUT_CHECKLIST.md). The preflight remains read-only; no Railway values were changed as part of its implementation.

## Goal

Create a repeatable, read-only preflight that checks the Railway service inventory, variable presence and placement, cross-service configuration consistency, broker-only Railway encryption-key settings, and the actual Neon runtime branch/role. It must fail closed when evidence is missing or ambiguous and must not reveal secret values.

The report may contain only service names, deployment commit identifiers, variable names, check identifiers, and `PASS` / `FAIL` / `UNKNOWN`. It must never contain secret values, partial values, lengths, hashes/fingerprints, connection strings, raw exception messages, or serialized process environments.

## Evidence from the repository

- Production is split across Next.js, FastAPI, LiveKit worker, and credential broker service boundaries. The broker is private-only and owns Google OAuth secrets and integration-secret encryption.
- [scripts/check-config.ps1](../scripts/check-config.ps1) already checks some local presence/forbidden-scope rules and prints key names rather than values. It reads local dotenv files and the invoking process environment; it is not a Railway inventory tool and cannot prove the actual remote configuration.
- The checker tests session-context key presence but not equality between Next.js/API/worker; it does not verify API/broker HMAC equality, actual Neon branch identity, actual role flags, or effective Railway variable values.
- Its username check compares `DATABASE_URL`'s parsed username with `RUNTIME_DB_ROLE`; this does not prove that PostgreSQL reports the runtime role as `NOSUPERUSER NOBYPASSRLS`.
- [.env.example](../.env.example) mixes local-development examples, application settings, and migration/provisioning inputs. It is not a service-by-service production manifest.
- [docs/PRODUCTION_ROLLOUT_CHECKLIST.md](PRODUCTION_ROLLOUT_CHECKLIST.md) requires a broker-only Railway encryption key, a restricted Neon runtime role, and migration credentials excluded from runtime services.
- The current [scripts/inspect_schema.py](../scripts/inspect_schema.py) prints table row counts as well as schema facts. Do not use it as the configuration-preflight output path; keep broader schema/RLS inventory in roadmap item 3.
- Prior QA notes recorded a split frontend/backend deployment revision, but current production service inventory and commit SHAs are unknown and must be rechecked.

Repository configuration is evidence of intended behavior, not evidence that Railway or Neon currently satisfies it.

## Service-scope policy to validate

Implement a versioned, testable service matrix rather than treating every `.env.example` key as required everywhere. Classify each input as **required**, **optional**, **conditional**, or **forbidden** for each workload. A missing optional value is not a failure; a missing required value, invalid conditional value, or forbidden placement is.

| Workload | Validate presence/structure | Reject in this workload |
| --- | --- | --- |
| Next.js | Backend URL, Neon Auth server endpoint, production origin, server-side signed-session context as required by the deployed frontend contract | Database DSNs, OAuth client secret, Google API key, LiveKit server API credentials, broker HMAC/encryption key, migration-role password |
| FastAPI API | Runtime `DATABASE_URL`, `RUNTIME_DB_ROLE`, production mode, LiveKit server settings, session-context secret, Google OAuth state secret, broker URL and shared HMAC, approved CORS/origin settings | Google OAuth client secret, broker encryption keys, unpooled/migration DSN, runtime-role provisioning password |
| LiveKit worker | LiveKit settings, Gemini API key, backend URL, session-context secret and any required dispatch identity/configuration | Database DSNs/passwords, Google OAuth secrets, broker HMAC/encryption keys, migration credentials |
| Credential broker | Runtime database DSN/role, production mode, broker HMAC, Google OAuth client ID/secret and redirect configuration as actually required, `CREDENTIAL_ENCRYPTION_KEY` and version; optional previous key only during rotation | Migration/admin database credentials; no public ingress |

Names in this table must be reconciled with the exact deployed commit and runtime code before implementation. Do not use this table to add or remove Railway variables automatically.

## Target design

### 1. Separate inventory from validation

Add a Railway-specific, read-only preflight entry point; retain `scripts/check-config.ps1` for local dotenv/process checks. The Railway adapter should accept explicit project and environment identifiers and enumerate the expected service identities, deployment status/commit, and configured variable **names**.

Use Railway service-configuration metadata that omits values for inventory. Do not call an interface that returns rendered plaintext variable values to the agent, shell output, CI logs, or artifacts. If only an unsafe interface is available, stop and use an owner-operated checker that emits a redacted presence report; do not weaken the secret-handling rule.

The adapter must fail closed on a missing/duplicate expected service, wrong project/environment, inaccessible metadata, unknown response shape, or ambiguous service mapping. Flag unexpected public/sample services for human review rather than silently treating them as part of the product.

### 2. Validate each environment in its own scope

Use a versioned policy/configuration matrix consumed by tested validation logic. A service must never inherit a value from a local `.env`, a different Railway service, or the current shell in a way that masks a missing remote variable.

Validation reports a check ID and status only. For values needed to check syntax, scopes, URL scheme, or equality, checks must execute in a controlled process where the value stays in memory and output is strictly allowlisted. Do not print or persist values or fingerprints. If a check cannot be performed safely, report `UNKNOWN`, not `PASS`.

Required checks include:

- required/conditional values present and nonblank, optional values handled as optional;
- production mode explicitly enabled on server workloads;
- URL/scheme/origin syntax checked without returning the URL;
- forbidden values absent from frontend, worker, and non-owning backend services;
- migration-only DSNs and provisioning credentials absent from runtime services;
- broker remains private, and the API targets its private endpoint;
- frontend targets the intended API deployment/origin;
- expected service revisions are recorded as non-secret commit SHAs and reviewed as a compatible release set.

### 3. Verify cross-service relationships without disclosure

Check in memory and emit only `MATCH`, `MISMATCH`, or `UNKNOWN`:

- `LIVEKIT_SESSION_CONTEXT_SECRET` is the same across the relevant Next.js, API, and worker processes;
- `CREDENTIAL_BROKER_SHARED_SECRET` matches between API and broker;
- API and broker database endpoints belong to the same approved Neon project/branch and use the approved runtime role;
- API/worker LiveKit deployment and agent/dispatch configuration are compatible;
- Google OAuth client ID and redirect settings agree where used, while the client secret stays broker-only;
- frontend backend origin and API-to-broker private routing point to their intended services.

Never print secret prefixes, lengths, hashes, or fingerprints. A value comparison that is not available under the approved interface must remain `UNKNOWN`; do not infer equality from matching variable names.

### 4. Verify Railway broker-key boundary

- Require a current 32-byte URL-safe-base64 `CREDENTIAL_ENCRYPTION_KEY` only in the private Credential Broker service.
- Require a key version and validate that optional previous-key and previous-version settings are either both present or both absent.
- Confirm the frontend, general API, and LiveKit Worker do not receive either encryption key.
- Treat Railway project/service administrators as trusted with the broker key. Railway secret-variable storage is not an independent KMS boundary; record that control-plane risk explicitly.
- Never print key values or fingerprints. Runtime preflight reports only whether format and placement checks pass.
- Do not rotate by replacing the current key alone. Keep the old key as previous while credentials are re-encrypted, then remove it only after confirming no persisted envelope uses that version.

### 5. Verify Neon branch and actual database role

Treat this as a restricted, read-only identity check, not a migration or data audit:

- Confirm the configured runtime DSN username matches `RUNTIME_DB_ROLE` without printing the DSN or username.
- Establish the endpoint-to-project/branch relationship using authoritative Neon control-plane metadata or another owner-approved endpoint mapping. `NEON_BRANCH` text or hostname parsing alone is not sufficient evidence.
- Connect only after project/branch identity is unambiguous; use read-only queries for current database and role flags. Require `rolsuper = false` and `rolbypassrls = false` for application runtime roles.
- Verify API and broker select the approved branch and runtime role. Do not use the privileged migration/owner role for application traffic.
- Keep broader migration-ledger, RLS-policy, grants, and table inventory checks in roadmap item 3; do not read customer rows, table samples, OAuth records, or secret-bearing data here.
- Stop if branch identity is ambiguous, unexpectedly production-bound, or inconsistent with the intended environment. Do not mutate or migrate the database.

### 6. Report and gate; never auto-repair

Produce a redacted report suitable for a release record. It should include the project/environment/service identifiers needed for audit, deployment commit SHAs, check IDs and statuses, and the time of verification—but no config values. The command exits nonzero for any `FAIL` or required `UNKNOWN` gate.

The preflight must not set Railway variables, redeploy services, run migrations, rotate secrets, or edit service configuration. Remediation is a separate explicitly approved task.

## Ordered implementation and execution plan

1. **Freeze scope and identities:** have the owner confirm the intended Railway project/environment and map the frontend, API, worker, and broker service IDs. Check deployed commits from metadata; do not inspect variable values.
2. **Define the service-policy source:** add a versioned matrix for required/optional/conditional/forbidden settings, secret classification, service ownership, and allowed equality relationships. Reconcile it against the exact deployed commit and environment templates.
3. **Implement the redacted validator:** retain the local checker; add Railway inventory/validation adapters with explicit project/environment arguments and no environment auto-discovery. Ensure results and exception handling are allowlisted and value-free.
4. **Implement separate identity probes:** database branch/role and Railway broker-key placement checks must be isolated and emit booleans only.
5. **Add tests before touching production:** exercise policy parsing, missing/empty/optional values, wrong-scope secrets, malformed inputs, missing services, wrong environment, stale/mixed commits, Neon wrong-branch/owner/BYPASSRLS states, broker-key format/rotation settings, `UNKNOWN` behavior, exit codes, and sentinel-secret redaction.
6. **Run on fixtures, then non-production:** validate synthetic metadata and isolated Railway/Neon identities first. Review logs/artifacts for leakage. Do not change variables during this run.
7. **Run production preflight:** use names-only Railway metadata and approved runtime identity probes. Stop on ambiguity. Human reviewers confirm branch, database role, broker-key scope, approved origins, and release commit compatibility.
8. **Record outcome:** update the production rollout checklist with dated evidence and unresolved gates. Repeat after relevant service/variable changes and immediately before production promotion.

## Test and acceptance gates

The preflight is acceptable only if:

- all four intended service scopes are identified independently;
- each configured input is reported as required/optional/conditional/forbidden in the correct service;
- forbidden secret placement and required-value absence are detected without displaying values;
- secret equality checks return only match/mismatch, or unknown when they cannot be safely performed;
- service URLs, deployment commits, and routing relationships are compatible and explicitly reviewed;
- broker-only Railway key presence/format and key-version configuration are verified;
- the live database endpoint maps to the intended Neon project/branch and uses the expected `NOSUPERUSER NOBYPASSRLS` role;
- missing metadata, permission failures, unexpected services, or branch ambiguity fail closed;
- automated tests prove no sentinel secret appears in stdout, stderr, logs, exception text, or saved artifacts;
- the command is read-only and does not silently remediate Railway or Neon.

## Review reconciliation and current unknowns

The systems-design and senior-developer reviewers agree that local dotenv validation cannot establish remote Railway values, secret consistency, workload identity, or database branch/role. They recommend service-scoped policy, in-memory checks with boolean-only output, strict fail-closed handling, and separate live identity verification. The senior reviewer additionally recommends a Railway metadata adapter, independent testable validator, and a CI/release gate only after safe metadata access is proven.

Current Railway variable values, deployed commits, shared-secret equality, and the actual Neon branch/runtime-role properties remain **unverified** by the names-only inventory. Never paste credentials into reports or chat.
