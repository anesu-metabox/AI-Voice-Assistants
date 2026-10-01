# Voice Agent Response Performance Plan

## Objective

Reduce real and perceived response latency without weakening tenant isolation,
calendar freshness, confirmation, idempotency, or the rule that unclear speech
must never trigger guessed actions.

## Implementation status (2026-09-30)

- Segment 1 is implemented: opaque request IDs now cross agent, API, and broker
  boundaries, with structured stage timings that exclude customer content and
  credentials. Required startup profile reads also run concurrently under one
  trace ID.
- Segment 2 is implemented: broker HTTP pooling, immutable profile snapshots,
  broker-memory OAuth token caching/refresh coalescing, and a 50-event realtime
  response bound are active in code.
- Segment 3 is implemented and enabled by default: successful availability and
  event reads use short bounded caches plus single-flight; writes invalidate the
  company cache and every booking still performs an uncached Google FreeBusy
  check immediately before the write.
- Segment 4 is implemented behind `CALENDAR_MIRROR_ENABLED`. Migration 024 was
  applied and verified on the `railway-development` Neon branch only on
  2026-09-30 (`FORCE RLS` on both tables and the range index verified). The
  production branch was not migrated. Enable the flag only on a service whose
  database points to that migrated development branch, then deploy and observe
  freshness/fallback metrics before any production rollout. Recently active
  tenants reconcile periodically with bounded concurrency, and confirmed live
  writes mark the advisory mirror stale before subsequent reads.
- Segment 5 is implemented: the standing Gemini instruction no longer carries
  the full FAQ/reference corpus; a strong deterministic local match injects one
  bounded approved fact for the relevant turn and fails closed on weak or mixed
  intent.

Local verification: 95/95 focused integration/safety tests, 59/59 agent tests, and
186 backend tests passed. Seventeen backend tests were intentionally skipped;
seven live-Postgres fixtures could not start inside the restricted sandbox
(`WinError 5`) and produced no assertion failures. The development Neon schema
was separately verified through migration 024. A privileged rerun of the
affected development-database selection completed with five passes and four
expected skips where the owner connection did not satisfy the dedicated
runtime-role prerequisite.

Railway development rollout completed on 2026-09-30. An isolated `development`
environment now contains successful optimized deployments of the Credential
Broker, Voice API, frontend, and LiveKit worker. The API and broker declare
`APP_ENV=development`, use the restricted `voice_bot_runtime_app` role on the
`railway-development` Neon branch, and enable the calendar mirror with the
bounded settings in this plan. The worker and API use the development-only
LiveKit dispatch name `calendar-assistant-development`, so the worker cannot
claim production jobs. Production deployment IDs were unchanged by this
rollout.

Live development verification: the public API `/health` and frontend both
returned HTTP 200; the API returned the exact development frontend CORS origin;
five sequential API health requests took 1056.6 ms cold and 471.4-494.0 ms
warm from the deployment host used for verification. Railway logs confirmed the
worker registered under the isolated name with no unrecoverable-session error.
The database role was verified as non-superuser, non-`BYPASSRLS`, without
database/role creation privileges; both `calendar_event_mirror` and
`calendar_sync_states` exist and enforce `FORCE ROW LEVEL SECURITY`.

The Railway development environment now uses the normal full-data Neon branch
`railway-development-auth` (created from production with a one-week expiry).
That branch contains the copied `neon_auth` schema and exactly one
`anesu@intern-mail.metabox.technology` account, plus migration 024. Its own
branch-specific Auth endpoint trusts
`https://ai-voice-bot-development.up.railway.app`, so development sign-in no
longer depends on production Auth. The prior schema-only `railway-development`
branch remains unused as a disposable fallback.

The final callback reproduction returned `401 Invalid email or password` for
the requested email with a deliberately invalid password, proving the callback
allowlist is fixed. A real sign-in still requires the account's actual password.
Google OAuth testing separately requires adding
`https://voice-api-development.up.railway.app/auth/google/callback` to the
development OAuth client's allowed redirect URIs; the deployed environment is
already configured to use that callback.

Synthetic fast-path benchmark (`scripts/benchmark_latency_fast_paths.py`): a
50 ms simulated provider read became approximately 0.025 ms on warm in-process
cache hits; 20 simultaneous cold reads produced one upstream call and completed
in approximately 55 ms. The 20-entry synthetic FAQ standing context fell from
24,362 to 434 characters (98.22%), and matching through the compiled per-session
index averaged approximately 0.048 ms. These numbers validate local overhead and
deduplication only; they are not substitutes for deployed Google/Gemini timing.

Local Railway-entrypoint smoke test: the API started with production database
access deliberately refused by the branch guard, returned HTTP 200 from
`/health`, echoed each supplied request ID, and emitted the correlated latency
record. After the first cold request, five consecutive server-side totals were
2.58-3.17 ms (local client round trips were 8.66-12.47 ms). Docker image
construction remains unverified on this host because no Docker executable is
installed; Railway deployment was not used as a build workaround because its
only configured environment is production.

Production preflight treats an enabled mirror as a gated capability: the flag
must be a valid boolean, freshness/reconciliation settings must remain within
their configured bounds, and a live read-only database probe must prove that
migration 024 and both mirror tables exist. An unknown or failed schema proof
blocks rollout.

## Delivery gates

### 1. Correlated latency measurement

- Generate one opaque request ID for every agent tool call.
- Propagate it from agent to API to the private credential broker.
- Record bounded stage timings for profile authorization, timezone resolution,
  idempotency, broker transport, OAuth token lookup/refresh, Google API work,
  local calculation, and total execution.
- Log timings as structured metadata without request payloads, tokens, event
  content, or company-provided text.
- Verify with unit tests that request IDs are bounded and timings are emitted.
- Summarize deployed sanitized logs by stage/outcome with p50, p95, p99, and
  maximum duration using `scripts/summarize_latency_logs.py`.

### 2. Connection, profile, and token fast paths

- Reuse an application-lifetime HTTP connection pool from the backend to the
  credential broker.
- Cache immutable, version-bound published profiles in-process with a bounded
  least-recently-used cache. Never cache the mutable "latest published" pointer.
- Cache valid Google access tokens only inside the credential broker process,
  bounded by token expiry, and deduplicate refreshes per company.
- Invalidate token cache entries on OAuth replacement and disconnect.

### 3. Calendar read deduplication and short cache

- Coalesce concurrent identical availability and event-list reads.
- Cache only successful read results for short, configurable TTLs.
- Include company, date range, timezone, duration, and business hours in keys.
- Invalidate a company's read cache after confirmed booking/cancellation.
- Never cache writes, reconnect errors, provider failures, or confirmation state.

### 4. Tenant calendar mirror

- Add migration-managed, RLS-protected mirror state and event tables.
- Add Google incremental synchronization using persisted `nextSyncToken`.
- Handle pagination, deleted events, and HTTP 410 full-resync requirements.
- Keep the mirror feature-gated; live Google remains the fallback.
- Use mirror reads only when freshness is within the configured bound.
- Keep live provider revalidation before every booking and cancellation.
- Treat push notifications as a synchronization trigger, not a complete or
  authoritative change stream; retain periodic reconciliation.

### 5. Compiled company-fact retrieval

- Compile bounded normalized FAQ and reference-note passages from the immutable
  published profile.
- Match exact/strong lexical aliases locally and fail closed below confidence.
- Inject only the matched approved fact into the current Gemini turn instead of
  carrying the entire FAQ/reference corpus in every model instruction.
- Preserve the same realtime voice; do not reintroduce blocking prerecorded
  filler audio.

## Verification gates

- Focused unit tests after every segment.
- Backend and agent suites after integration.
- Migration/schema checks without applying to a protected branch.
- Production preflight before deployment.
- A live microphone/calendar run remains required to claim end-to-end latency
  and acoustic improvement after deployment.

## Rollback boundaries

- Segments 2, 3, and 4 use independent configuration flags/defaults.
- Disabling read caches or the mirror returns reads to the existing live Google
  path without changing write behavior.
- Database changes are additive and retain the existing live calendar contract.
