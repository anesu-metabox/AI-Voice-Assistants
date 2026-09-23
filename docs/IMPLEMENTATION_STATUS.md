# Implementation Status

This file is the handoff status for collaborators implementing the platform roadmap.

## Current deployment decision (2026-09-23)

- Railway is the only deployment platform in scope; AWS KMS/workload identity
  is not a current prerequisite. The private credential broker uses
  tenant-bound AES-GCM with `CREDENTIAL_ENCRYPTION_KEY` supplied as a Railway
  service secret. Keep it out of the frontend, general API, and LiveKit worker.
- The older AWS/KMS entries later in this history record the prior design and
  are superseded for the current Railway rollout by
  [CREDENTIAL_BROKER.md](CREDENTIAL_BROKER.md) and
  [PRODUCTION_ROLLOUT_CHECKLIST.md](PRODUCTION_ROLLOUT_CHECKLIST.md).

## Completed in the current working tree

- Next.js dashboard is the active frontend surface.
- LiveKit is the only active voice path; browser-direct Gemini is disabled.
- LiveKit sessions use client session IDs, deterministic room names, idempotent dispatch records, single-flight connection guards, cleanup, and transcript deduplication.
- The worker validates signed LiveKit metadata and exposes only the four calendar tools.
- The worker now applies the shared deterministic scope decision in LiveKit's `on_user_turn_completed` hook; rejected turns speak only the standard redirect and stop before Gemini/tool execution.
- Active LiveKit conversations now run a low-overhead event-loop wake-interval monitor (50 ms sampling, 100 ms stall threshold); it logs only session ID and observed interval and stops on session close. Focused standard-library tests detect a deliberate 160 ms blocking positive control and verify prompt monitor shutdown. This does not yet replace a production-like multi-session latency acceptance run.
- Browser and backend tool routes fail closed without a verified tenant context.
- The signed internal context now carries the verified Neon Auth subject end-to-end (Next.js BFF → FastAPI → LiveKit dispatch → worker); company memberships store that subject, reject cross-company conflicts, and remove only the legacy company-ID-as-user placeholder.
- The authenticated dashboard footer reads only the current Neon Auth user's display name/email via the same-origin BFF and provides a real POST `/sign-out`; session cookies remain managed by Neon Auth and are not exposed to frontend JavaScript.
- Company-specific onboarding instructions are appended as bounded operating context below the canonical security policy; they cannot grant tools or replace platform rules.
- Active persistence paths no longer seed demo company, assistant, or shared default-tenant data.
- Superseded root-level `PROJECT.md`, architectural-audit, and Google Calendar changelog documents now carry explicit historical-only warnings and links to the current roadmap/QA/security docs; `docs/README.md` has a corrected, numbered collaborator reading order.
- Dashboard metrics render explicit empty states instead of seeded sample records. The Calls page loads up to 50 actual 3CX call-session rows from an authenticated same-origin proxy and labels unavailable transcript playback; it does not advertise inert search/filter or sentiment analytics. The API caps results at 100 and excludes PBX call IDs, claim tokens, LiveKit rooms/dispatch IDs, and transcripts. Local SDK event/media adapters now exist, but are not deployed or wired to PBX credentials/LiveKit dispatch, so production call rows remain empty.
- Onboarding no longer shows a placeholder mic/transcript or an `ACTIVE` badge for a disconnected sandbox; the real LiveKit testing sandbox is the only session entry point.
- 3CX credentials are accepted through a write-only UI, validated against SSRF, encrypted before persistence, and never returned to the browser.
- Configured 3CX integrations can be explicitly disconnected from the UI after confirmation; the same recent-auth gate protects the DELETE route, backend records a redacted audit event, and the form clears its connection values on success.
- The 3CX “Test & save” action now uses one broker request (the save operation probes before persisting) instead of sending the client secret through duplicate test/save calls; the form clears the secret from React state on both success and failure.
- Fixed the 3CX Service Principal field mismatch: client ID (`app_id`) and Programmable Extension/Route Point DN are now separate inputs, probe parameters, and persisted metadata; only the write-only client secret is encrypted. Existing active integration rows lacking the new `app_id` are degraded by migration `021` until the owner reconnects with the correct Service Principal details. Safe configuration reload repopulates the client ID and non-secret settings but never restores the secret.
- Verification for the Service Principal contract: frontend tests 69/69, TypeScript typecheck, ESLint, and optimized Next build pass; two dependency-free schema/migration contract checks were executed directly. Full backend pytest remains unexecuted because the available Python runtime lacks pytest and project dependencies; migration `021` has not been applied to Neon.
- 3CX test, save, and disconnect requests require a server-verified Neon Auth session created within the previous ten minutes; missing, stale, malformed, and future timestamps fail closed at the Next.js boundary. The timestamp is stripped before signing/forwarding tenant context.
- 3CX connection probes are limited to 5 per company per 15 minutes and credential saves to 3 per company per 15 minutes through atomic Neon upserts. The budget table is forced-RLS and stores only a counter/window, not request data or secrets; over-budget calls fail with HTTP 429 and `Retry-After`.
- 3CX URL validation now enforces HTTPS FQDN-only input, port 443, no path/query/credentials, literal-IP rejection, stable DNS, and prohibited-address rejection before any probe.
- Google OAuth state is signed and bound to the company/session context; connected Google email is stored and returned as display metadata.
- Google access and refresh tokens are encrypted with authenticated encryption after migration `008_encrypted_google_integrations.sql`.
- Dormant contacts/email compatibility modules no longer return demo records or fabricated drafts; they fail closed because they are outside the Google-calendar-only capability surface.
- New tenant/company defaults are removed by migration `009_remove_demo_defaults.sql`.
- Assistant saves create a tenant-scoped versioned profile and compiled policy record; company instructions remain subordinate to the platform policy.
- Assistant profile version allocation now takes a transaction-scoped advisory lock per company before reading `MAX(version)`, preventing concurrent saves for one tenant from racing into the same version number; a focused regression test was added.
- New LiveKit sessions now snapshot the published profile version into dispatch metadata and the durable session ledger (`013_livekit_profile_binding.sql`); the worker loads that exact snapshot so later publishes do not mutate active sessions.
- Google Calendar OAuth now uses PKCE plus a database-backed one-time, tenant-bound state ledger (`010_oauth_state_pkce.sql`).
- OAuth PKCE state inserts and one-time consumption set `app.company_id` inside a transaction and constrain consumption to the signed company, so these paths work under forced RLS and the non-bypass runtime role.
- Google OAuth initiation now ensures the authenticated company exists before creating the state record, including first-time users who connect Calendar before saving other settings.
- Same-origin checks reject cross-site mutations at the Next.js BFF boundary before authentication or backend forwarding.
- Migration `011_legacy_settings_rls_and_preferences.sql` brings legacy settings, OAuth, confirmation, task, calendar-event, and LiveKit ledgers under tenant RLS while preserving compatibility columns.
- The active onboarding flow now loads and saves authenticated company and assistant drafts through the server proxies; post-login routing selects onboarding for an empty company or the dashboard for an existing one.
- Public account creation now routes through the actual Neon Auth sign-up endpoint rather than the legacy client-only form; newly authenticated companies go directly to the persisted company profile instead of the unsaved sample-goals screen.
- Migration `012_integration_audit_events.sql` adds a tenant-scoped redacted audit trail for integration lifecycle actions.
- User preferences and onboarding completion now have an authenticated persistence surface at `/user-preferences`.
- Assistant profile lifecycle endpoints now support tenant-scoped version listing, policy validation, publishing, and rollback through the Next.js BFF. Assistant Settings can save a draft and launch the real LiveKit sandbox against that exact company-owned draft version; token issuance rejects published/superseded versions from the draft-preview path, and session retries cannot rebind an existing room to another profile version.
- Onboarding and Assistant Settings now persist per-company grants for implemented receptionist, company FAQ, and Google Calendar capabilities; the shared policy compiler derives the enabled behavior and exact tool grants from the same canonical policy templates.
- Assistant onboarding and settings now persist a bounded structured operating profile (approved tone, per-weekday hours, escalation guidance, and FAQ question/answer entries) inside the tenant's versioned profile JSON; FAQ entries require the Company FAQs grant, and the LiveKit worker injects sanitized, delimiter-escaped values only as explicitly untrusted context. No relational migration is needed because the existing versioned profile is JSONB-backed.
- The configured inbound greeting is now consumed by the LiveKit worker after successful session startup through the direct `session.say` API, is limited to 500 characters, remains interruptible, and is omitted when unset/invalid; the direct speech path does not create a tool-enabled generated reply.
- The worker now JSON-serializes company instructions, approved reference notes, structured operating data, and company identity facts as untrusted context with `<`, `>`, and `&` escaped; adversarial closing-delimiter content cannot break out of the data envelope.
- Lead qualification and 3CX call transfer remain explicitly unimplemented and cannot be activated from onboarding. 3CX credential storage/probing is separate from a callable voice capability.
- Migration `016` and repository primitives add an atomic tenant-scoped 3CX event inbox, one-call claim, opaque deterministic room name, lease renewal, and compare-and-set lifecycle transitions. The separate local Node connector now includes PBX/LiveKit adapters, but these database primitives are not wired into a deployed connector runtime.
- The credential broker is a separate FastAPI entrypoint for Calendar operations, OAuth token exchange/storage/revocation, and 3CX setup-test/storage. General-backend calls are body-bound HMAC requests with timestamp and one-use tenant-scoped nonce; responses contain provider results or display metadata only. Migration `017` adds nonce replay protection. The KMS key policy now names a dedicated broker workload role.
- Broker startup now loads only an explicit provider/KMS secret allowlist from its dedicated local environment, with root dotenv fallback restricted to non-production isolated branches; protected branch or production mode will not import dotenv secrets. General backend settings no longer retain `DATABASE_URL_UNPOOLED`, which remains migration-job-only.
- Production preflight distinguishes general API from credential-broker configuration and rejects private database/provider/KMS credentials in Next.js and database/integration secrets in the LiveKit worker. The local launcher refuses to start Next.js if `frontend/.env.local` contains the prohibited private keys.
- Migration `018` adds the forced-RLS `integration_action_limits` table for cross-process 3CX setup throttling; the non-bypass runtime-role grant and all-tenant RLS fixture are updated.
- The authenticated `GET /api/integrations/3cx/calls` read path queries the migration-016 tenant-scoped call ledger with an explicit company predicate and transaction-local RLS context. Migration `019` indexes the bounded recent-history ordering. Mocked tests cover auth rejection, bounded reads, and safe response fields; database/RLS execution remains gated on an isolated Neon branch.
- Published LiveKit sessions fail closed if the exact signed profile snapshot is missing or has a different version; they cannot fall back to mutable settings. Legacy sessions without a bound profile version retain migration compatibility.
- Frontend linting is now configured with the pinned Next.js ESLint preset; the lint gate runs without warnings or errors.
- The LiveKit worker directory is an explicit Python package so its reliability and security tests run through the normal project pytest invocation.
- The local full-stack launcher now fails closed if the process environment, root `.env`, or `.neon` link identifies `production`, `main`, or `primary`, and also rejects conflicting branch names. This prevents overriding only `NEON_BRANCH` while leaving a production `.env` selected.
- Production configuration preflight now validates that the application `DATABASE_URL` username matches `RUNTIME_DB_ROLE`, and rejects unpooled migration URLs and the runtime-role provisioning password in API/broker service configuration. Those privileged values belong only in the controlled migration/provisioning job.
- Runtime-role provisioning now independently requires `DATABASE_URL_UNPOOLED` and an explicit `NEON_BRANCH`, refuses pooler URLs and protected production branch names without `--allow-production`, and has database-free preflight tests; this closes the previous mismatch with migration-runner safety checks.
- Tenant-table inventory for forced-RLS acceptance and runtime-role grants now comes from `db/tenant_tables.py`, removing two independently maintained lists that could drift when tenant tables are added.
- The unauthenticated `/health/db` diagnostic now returns 404 in production and no longer serializes raw connection errors in development; two mocked unit tests verify this without opening a database connection.
- FastAPI 422 validation responses now omit submitted values globally, preventing invalid 3CX setup requests (or other malformed requests) from echoing API keys/codes. Request-level synthetic-secret coverage passes.
- Backend integration tests now provide signed tenant context instead of relying on removed default-user behavior. Legacy local-calendar overlap suites are explicitly marked as migration-era tests; a replacement contract suite verifies Google Calendar actions fail closed with `GOOGLE_CALENDAR_REQUIRED` when no tenant integration exists.

## Required deployment steps

1. Apply migrations `007` through `022` using the direct/unpooled Neon connection, first on the isolated test branch. Migrations `016`–`018` add forced-RLS 3CX call/event records, credential-broker replay protection, and shared action throttles; `019` indexes recent call-history reads; `020` clears exact legacy sample defaults; `021` adds the distinct 3CX Service Principal client ID; `022` requires an explicit per-company call-failure policy and degrades integrations without one.
2. Enable Neon Auth for the Neon branch and set `NEON_AUTH_URL` in the Next.js server environment.
3. Set the same high-entropy `LIVEKIT_SESSION_CONTEXT_SECRET` in Next.js, FastAPI, and the LiveKit worker.
4. Set `GOOGLE_OAUTH_STATE_SECRET`; in production configure `CREDENTIAL_KEY_PROVIDER=aws-kms`, `CREDENTIAL_KMS_KEY_ID`, and `AWS_REGION` with deployment workload identity. Migration `008` removes legacy plaintext OAuth columns, so existing accounts must reconnect Google.
5. Register the local and deployed application origins as trusted Neon Auth domains.
6. The same-origin Neon Auth BFF and sign-in/sign-up surface are implemented in `frontend/src/app/api/auth/[...path]` and `frontend/src/app/sign-in`. The official SDK remains optional because the package registry was unavailable in this checkout.
7. Run `powershell -File scripts/check-config.ps1 -IncludeExternalAuth` before local/authenticated startup. Run `-Production` for the general API and `-Production -CredentialBroker` for the broker; the latter requires KMS selection/key/region and the Google OAuth client secret. Neither invocation prints secret values.
8. The migration runner refuses `NEON_BRANCH=production` unless invoked with `--allow-production`; test migrations on `codex-roadmap-migration-test` first, then obtain explicit deployment approval before using that flag.

## Verification state

- `npm --prefix frontend run typecheck`: passing.
- `npm --prefix frontend run test`: 59 passing in the current worktree, including Neon Auth account/sign-out proxy coverage, 3CX single-request secret handling/disconnect coverage, recent-auth/call-history coverage, and guards against inert controls or unsupported product claims.
- Latest frontend run after correcting signup/onboarding routing: 61 tests passing; TypeScript check, ESLint, and optimized Next production build all pass.
- Latest structured-profile, prompt-data, and greeting verification: 62 frontend tests, TypeScript, ESLint, and optimized Next production build pass; 46 focused backend capability/profile and LiveKit worker tests pass without database connections.
- Latest draft-preview verification: 63 frontend tests, TypeScript, ESLint, and optimized Next production build pass; 6 focused mocked API/session-binding/Auth-context tests pass without Neon or LiveKit connections.
- Latest combined backend, LiveKit agent/audio, and migration/runtime-role safety run: 130 passed, 1 database-backed case deselected. Live Neon/provider/RLS modules were explicitly excluded.
- Broker environment isolation tests cover development allowlisting, production/protected-branch dotenv refusal, process-environment precedence, and exclusion of the unpooled DSN from backend settings.
- Expanded database-isolated backend regression run: 83 passed, 1 database-backed confirmation-token case deselected. Calendar DB/provider-contract, full RLS, and edge-case integration modules were explicitly excluded; no Neon connection was opened. Fixed two tests still importing the tenant table inventory from its former module instead of `db/tenant_tables.py`.
- Latest LiveKit agent policy, audio-pipeline, and reliability regression run: 31 passed without database or external service connections.
- Database migration-runner and non-bypass runtime-role refusal/preflight tests: 10 passed without a Neon connection.
- `npm --prefix frontend run build`: passing in the current worktree.
- `npm --prefix frontend run lint`: passing with no warnings or errors in the current worktree.
- `npm --prefix frontend run typecheck`: passing in the current worktree.
- `npm --prefix frontend run build`: passing after adding the 3CX recent-authentication gate.
- `npm --prefix frontend run build`: passing after removing misleading call-analytics UI.
- Focused local backend action-budget and signed-context suite: 6 passing; no database connection was opened.
- Focused local backend policy/auth/OAuth/broker/3CX/call-history/health suite: 62 passing, including the `019` index contract; database-backed RLS tests were excluded and no database connection was opened.
- Latest database-free profile persistence regression run: 3 passing across per-company profile-version serialization and assistant publish-state handling; no database connection was opened.
- `python -m pytest agent -q`: 26 passing in the current worktree after updating the fake-agent fixture for the capability-aware pre-response hook.
- Focused local backend policy/auth/OAuth/broker/3CX/health/validation/action-budget unit suite: 58 passed after migration `018` code was added. Database-backed cross-tenant RLS integration test deliberately excluded while the environment selects production. The updated all-table RLS fixture check remains to be verified on an isolated branch.
- Local PowerShell check confirms `scripts/dev.ps1` refuses the current production branch before starting any service.
- `git diff --check`: passing.
- LiveKit agent reliability/audio/security pytest suite: 16 passing in the current focused package run, including the pre-response redirect gate, worker prewarm checks, signed-context validation, exact tool-surface checks, company scope, and immutable profile binding.
- Backend capability compiler, signed Auth-subject context, company-membership provisioning, guardrail/tool authorization, OAuth initiation, and profile-publish focused suite: 26 passing.
- 3CX call-claim, duplicate-event/call prevention, lifecycle transition, opaque-room, and runtime-role grant unit tests: 8 passing. Live PBX/DB concurrency acceptance remains open.
- Expanded RLS fixture collection now includes 21 tenant tables; the integration test itself remains intentionally unrun while `NEON_BRANCH=production`.
- Complete backend suite on the isolated migrated Neon branch under a fresh `NOSUPERUSER NOBYPASSRLS` runtime role: 24 passing and 17 explicitly skipped legacy local-calendar tests; guardrail, RLS isolation, 3CX security, settings, and Google-integration contract coverage pass. Provider-contract tests explicitly skip, with a migration prerequisite, when accidentally pointed at the unmigrated production schema.
- 3CX SSRF, URL-boundary, private-address, DNS-rebinding/pinning, and v20 Service Principal token-flow tests: 14 passing.
- Latest targeted OAuth/RLS, first-time company provisioning, and 3CX security regression run: 18 passing.
- Local runtime smoke check: Next `/` returned `200`, FastAPI `/health` returned `200` with database connected, and the worker probe returned `200`.
- Protected browser/API routes returned `401` without an authenticated Neon session, as intended.
- Assistant profile lifecycle proxies returned method-appropriate protected responses (`401` for GET version listing and CSRF rejection for unauthenticated POSTs).
- Google OAuth proxy smoke check returned `401` without an authenticated session and no longer throws a Next.js route error.
- Neon Auth BFF smoke check against the isolated Auth-enabled branch returned `200 null`; fixed an unbound `getSetCookie` Headers method that caused the previous `502 Illegal invocation` failure.
- The local launcher now uses the LiveKit `start` worker runtime instead of the deprecated Windows `dev` runner; registration/prewarm is clean and the repeated legacy-runner warnings are gone. One isolated 453 ms no-stack watchdog warning still appears during idle Windows load monitoring, so a production-like active-conversation latency run remains open.
- Worker prewarm imports the LiveKit session-report and HTTP transport modules before registration, removing the previously observed first-disconnect report-import stall. The non-deprecated local worker runtime still needs an active-conversation run to separate the remaining idle watchdog signal from real audio-path blocking.
- Added `docs/3CX_API_SPIKE.md` with the verified v20 Call Control/WebSocket/PCM boundary, the one-agent call-state architecture, required PBX prerequisites, and acceptance gates. The real adapter remains gated on a non-production PBX and credentials.
- 3CX planning now records the vendor-confirmed 8SC+ AI license and the requirement that inbound media traverse the app-owned programmable Route Point; monitored extension participants do not expose media to the external app. These boundaries are sourced in `docs/3CX_API_SPIKE.md`; they reinforce that a working DID/Route Point and PBX are required before media code can be accepted.
- The 3CX connection test sends the v20 Service Principal exchange as URL-encoded `client_id`, `client_secret`, and `grant_type=client_credentials` to `/connect/token`, then probes `/callcontrol` with the short-lived Bearer token. The token is never persisted or logged; focused request-contract and SSRF tests pass.
- 3CX probes now pin TCP connections to an address validated as globally routable while retaining hostname-based TLS certificate verification; environment proxies are disabled and redirects are not followed. Regression coverage verifies post-validation DNS changes cannot change the connected address.
- Further bounded 3CX probe resource use: each DNS lookup now has a two-second deadline; outstanding resolver threads are capped at four per process, and saturation fails within 250 ms without releasing slots while timed-out OS resolver work remains active. Token responses stream under a 64 KiB cap, Call Control responses under a 1 MiB cap, and broker concurrency is separately capped at four active probes per process with fail-fast `503` saturation behavior. Regression tests cover DNS timeout, resolver saturation, oversized token responses, and broker capacity saturation. Bundled Python syntax-compiles the changed files, but the focused pytest suite could not run because system Python/`py` are unavailable and bundled Python lacks pytest and application dependencies; no dependency installation or network access was attempted.
- Added `docs/PRODUCTION_ROLLOUT_CHECKLIST.md` as the final operator handoff for restore points, migration `008` account reconnection, KMS, RLS, synchronized deployment, 3CX acceptance, and rollback evidence.
- RLS audit found the Neon owner role has `rolbypassrls=true`, so policies alone were insufficient. Added migrations `014_force_tenant_rls.sql` and `015_oauth_state_and_audit_rls.sql`, plus `db/provision_runtime_role.py`. The production application connection must use a dedicated `NOSUPERUSER NOBYPASSRLS` role: it is a least-privilege login for normal app queries that is subject to forced tenant RLS, unlike the Neon owner/migration role. Keep the privileged role only for controlled schema migrations and administration; never use it as the API or broker's `DATABASE_URL`.
- An earlier, narrower cross-company RLS test passed with a dedicated `NOSUPERUSER NOBYPASSRLS` runtime role. The expanded rollback-only test now covers representative rows across every tenant table, but it has not been run against the database because this checkout currently selects `NEON_BRANCH=production`; only its local fixture-coverage assertion was run here.
- The prior read-only schema inspection confirmed the isolated Neon branch through migration `015`. Migrations `016`–`019` are new and remain unapplied; rerun schema inspection and expanded cross-company RLS tests on the isolated branch after applying them.
- The migration runner now requires an explicit `NEON_BRANCH` and rejects pooled Neon endpoints; regression tests cover both safety checks.
- A live production Neon Auth session and production database migration have not been verified from this checkout.
- Current read-only production inventory confirms `schema_migrations` has zero entries, migrations `006`-`015` are not deployed, `oauth_tokens` has one row, and legacy plaintext access/refresh-token columns remain. No credential values were queried.
- Recovery branch `codex-pre-migration-20260922` (`br-hidden-dew-zag5bkyh`) is ready and expires `2026-10-06`; isolated test branch `codex-roadmap-migration-test` (`br-empty-queen-zave7utb`) is ready and has all migrations `001`-`015` recorded. Production remains unchanged.
- Neon Auth was enabled and verified on the isolated migration branch; production Auth configuration remains unchanged pending the same explicit deployment approval.
- Production preflight currently reports missing service-context/OAuth secrets, runtime DB role credentials, AWS KMS provider/key/region, Neon Auth configuration, and production frontend/worker context secrets. The preflight now reports these missing keys instead of failing on a null KMS-provider value.
- Latest key-only production preflight additionally found the root app DSN user does not match the required runtime role and the root app config contains an unpooled migration URL and Google OAuth client secret. At that time `frontend/.env.local` also contained private copies; these were subsequently removed only after confirming each parsed value exactly matched its retained root copy. The frontend preflight no longer reports those private keys, but production configuration remains incomplete.
- The `.neon` workspace link identifies project `divine-hat-17233837`, but the Neon MCP account currently lists a different project set; the local Neon CLI is installed but cannot read its credential profile (`EPERM`). External branch state was therefore not refreshed in this turn. Do not assume project/account access or attempt a branch write until the owner signs in with the correct Neon account and the project is visible.

## Security notes

- Never reintroduce browser-provided `user_id`, `company_id`, or tool identity arguments.
- Never log transcript text or credential values.
- Rotate any API credentials that have been exposed in local environment files before production use.
- Migration `008` removes the legacy plaintext OAuth columns; reconnect every existing Google account after applying it.
- Credential encryption uses a local AES-GCM key only in development. Production uses AWS KMS `GenerateDataKey`/`Decrypt` envelope encryption in the isolated credential broker. Workload IAM and KMS key policy still need provisioning and verification before production rollout.
- Added `infra/aws/credential-kms.template.json` and `docs/AWS_KMS_SETUP.md`: retained, auto-rotating symmetric key; separate credential-broker and key-admin role inputs; and context-constrained KMS permissions. Only the broker role may decrypt credentials; the general API role must not have KMS rights. A static regression test guards the runtime action/context scope. The template still requires validation/deployment in the user's AWS account before it can unblock production.
- Credential envelopes no longer persist a secret-derived fingerprint; only nonce, authenticated context, and key version metadata are retained.
- `scripts/inspect_schema.py` provides a secret-free, read-only migration/table inventory for the deployment gate.

## Latest continuation — local launch and Neon access recheck

- The active LiveKit token path is the authenticated Next.js proxy to FastAPI. The legacy `/api/livekit-token` route has been retired with `410 Gone`; a frontend regression test ensures it cannot mint tokens independently.
- `scripts/dev.ps1` now passes LiveKit signing credentials to both FastAPI (to mint room tokens/dispatches) and the LiveKit worker (required for worker registration), passes the Gemini API key only to the worker, and provides one consistent session-signing secret to Next.js, FastAPI, and the worker. Missing local session/OAuth signing secrets are generated in memory for that local run only. The broker HMAC secret is scoped to the broker and FastAPI; migration-only DSNs and broker/KMS secrets are excluded from frontend/worker environments.
- Launcher static regression tests, PowerShell parsing, and the full frontend suite pass: 65 frontend tests, TypeScript typecheck, and the previously verified production build. Latest database-free backend/agent/security suite: 130 passed, 1 database-backed case deselected.
- Rechecked Neon access through the connected MCP account: its project list contains `Zimthreads Collective` and `Luxury Shop Mauritius`, not the workspace-linked `divine-hat-17233837`. The CLI remains unable to read its credential profile (`EPERM`). No remote database changes were made; apply migrations `016`–`019` only after the owner reconnects the correct Neon account and the isolated branch is visible.
- Private database, Google API/client-secret, LiveKit API, and Trigger credentials have been removed from the ignored `frontend/.env.local` after verifying their parsed values exactly match copies retained in the server-side root configuration. `TRIGGER_API_KEY` is now included in both frontend secret-deny lists. Production preflight no longer flags private frontend keys, but still reports a runtime-role/DSN mismatch, migration-only and broker-only secrets in root configuration, missing production context/OAuth secrets, and missing runtime role/KMS/Neon Auth setup.
- Browser/runtime acceptance remains blocked by the configured production branch guard; no services were started against production. The current Neon account still does not expose the linked project.

## Latest continuation — 3CX adapter implementation boundary

- Added `docs/3CX_ADAPTER_IMPLEMENTATION_SPEC.md` as the actionable Phase 6 build contract: it specifies trust boundaries, Route Point event handling, tenant/DID resolution, signed one-agent LiveKit dispatch, media framing/resampling, bounded queues, cleanup/recovery behavior, and staged tests.
- Confirmed against current official sources that the 3CX TypeScript SDK exposes PCM 8 kHz signed 16-bit mono for the app-owned Route Point, and that monitored extension participants do not expose media. LiveKit raw media APIs require explicit sample rates and frame publishing; arbitrary PBX buffers require application-level chunking/resampling.
- No executable 3CX adapter was added. Doing so safely still requires a chosen connector secret boundary, a PBX/vendor SDK fixture, a dedicated tenant-safe DID resolution design validated against the isolated schema, and a non-production PBX for media acceptance. Production Neon remains protected and inaccessible from the currently connected account; no production DB or PBX changes were made.
- Added an isolated PCM16 frame-assembly utility under `connector/` plus `npm run test:3cx-audio`; all five tests pass for fragmented buffers, 20 ms 8 kHz frames, sample alignment, copy safety, bounds, and invalid inputs. This is a tested adapter primitive only: it does not resample, connect to either SDK, or move call audio.
- Fresh verification: frontend tests 65/65, TypeScript typecheck pass, production Next.js build pass, agent tests 31/31, database-independent backend tests 90/90, and PCM assembler tests 5/5. Neon-backed calendar/RLS suites were intentionally excluded because the local environment selects the protected production branch.
- Phase 7 audit found migration `009` changed defaults for future rows but left existing legacy profile rows with exact migration-`005` fictional Acme/Ava/support-return values. Added migration `020_clear_legacy_demo_profile_values.sql` to blank only those exact matched fields, retain tenant rows and nonmatching user content, and normalize the exact legacy timezone default to `Indian/Mauritius`. Added static migration-safety and runtime-source regression tests (3 pass); actual SQL execution remains gated on an isolated Neon branch.
- GitHub connector verification: authenticated profile is Anesu Mupesa and `anesu-metabox/AI-Voice-Assistants` is readable on `develop`. The connected Neon MCP account still exposes only unrelated projects; Neon CLI 4.21.0 profile listing is unavailable in this environment. GitHub authentication does not prove Neon project access, so no migrations or database writes were made.

## Latest continuation — Neon connection verification

- GitHub repository access remains confirmed for Anesu Mupesa and `anesu-metabox/AI-Voice-Assistants` on `develop`.
- A strictly read-only transaction using the existing workspace DSN successfully connected to database `neondb` on the configured production endpoint (`ep-shiny-snow-za0dicjh.c-2.eu-west-2.aws.neon.tech`), PostgreSQL `18.6`, as `neondb_owner`. No application rows or secrets were read.
- The connected SQL role has `rolbypassrls=true`; it is an owner/admin connection and is not suitable for tenant runtime or RLS acceptance tests. No writes, DDL, migrations, or grants were issued.
- Neon MCP still returns `project not found` for the workspace-linked project ID `divine-hat-17233837`, and its project list remains limited to unrelated projects. Thus direct SQL connectivity is verified, but Neon project-management/branch API access through the connected Neon account is not. The migration gate remains blocked until the correct Neon account/project is connected and an isolated branch plus dedicated `NOBYPASSRLS` runtime role are available.
- The roadmap remains in progress. The current implementation has the setup/credential/call-claim foundations but not 3CX event processing, telephony-originated LiveKit dispatch, PCM bridge, or live PBX acceptance.

## Latest continuation — company capability scope-gate audit

- Traced the company profile compiler, immutable runtime snapshot, and LiveKit worker prompt assembly. Profile version and compiled tool grants are passed to the worker; published FAQ/business-rule fields and authenticated company-profile facts are available as bounded untrusted context.
- Closed a material scope-enforcement gap in `agent/assistant_policy.py`: FAQ/receptionist turns now pass the pre-response gate only when a configured fact or published FAQ is matched. Unknown requests and mixed company/unrelated requests fail closed; the classifier receives the company context from the exact runtime snapshot. No second model call was introduced.
- Added tests for approved company questions, missing company context, unrelated trivia/coding requests, mixed-scope requests, and the actual LiveKit pre-response hook speaking its redirect and raising `StopResponse`. Focused worker/backend guardrail run passes: 22 tests; the full agent suite passes: 22 tests. `git diff --check` is clean apart from Git's LF-to-CRLF notices. No database or production state was changed.
- Notion browser access is working and the AI VOICE BOT project hub was opened. Its Resources/Environment page is marked “visible to anyone with the link” and contains credential-like values (Neon API, database, LiveKit, and Google credentials). Treat them as exposed: rotate/revoke affected secrets and remove them from that page, then restrict its sharing. The Neon MCP API still lists only unrelated projects; the page's key has not been used from this session.

## Latest continuation — removal of inert integration UI

- A fresh active-source audit found that Integrations displayed Google Contacts as unavailable but still included a decorative “Auto-create contacts” toggle. Removed that unsupported card, the misleading subtitle, and the now-unused toggle component; the page now shows only implemented/configurable Calendar and 3CX integration surfaces.
- Added a regression assertion that Google Contacts and inert toggles are absent from the integration page. Frontend suite passes (66 tests), typecheck and ESLint pass, and Next.js production build passes. This is a targeted Phase 7 cleanup; database legacy-profile cleanup and full production acceptance remain open.

## Latest continuation — removal of legacy signup UI

- The dashboard's `signup` state already redirects into the real Neon Auth sign-up flow, but an unreachable legacy signup component still contained inert Google/Microsoft buttons, an unsubmitted email/password form, and a button that advanced onboarding without creating an account. Removed that dead component and its now-unused icon helpers.
- Updated the landing-page source test boundary and added a regression assertion that the fake signup UI does not return. Focused product-scope tests pass (11/11), full frontend tests pass (66/66), TypeScript and ESLint pass, and the optimized Next.js production build passes. This closes one more Phase 7 UI-cleanup item; migration 020 execution and end-to-end tenant/production acceptance remain open.
- Removed a stale LiveKit worker docstring that still described the implemented HMAC-bound tenant/session verifier as a future placeholder; the documentation now reflects the verified auth subject and profile-version binding.

## Latest continuation — remove simulated public landing telemetry

- The unauthenticated landing page had a fixed waveform, a green “LiveKit voice sandbox” indicator, and hard-coded empty activity rows. Replaced that pretend preview with a clear sign-in entry point and the four supported Calendar capabilities; the page now explicitly says no call, audio, transcript, or tool activity is fabricated there. Removed its now-unused arrow icon.
- Added regression checks against the simulated preview. Frontend tests pass (66/66), TypeScript, ESLint, optimized Next.js build, and `git diff --check` pass. This is another targeted Phase 7 cleanup. Phase 6 still requires the broker/connector hosting decision and non-production PBX before a real call/media adapter can be safely accepted.

## Latest continuation — remove unsupported onboarding demos and false health badge

- Removed the unreachable pre-persistence onboarding screens, which still advertised unsupported surveys, account verification, internal ops, and other workflows. The shared onboarding shell remains and is used by the real company/assistant persistence steps.
- Removed the dashboard header's permanently green “Voice Server Status” indicator; it did not query backend health. The sidebar remains the single authenticated account display, and its missing-email fallback now says “Email unavailable”.
- Added regression tests for unsupported onboarding content and health-status claims. Frontend suite passes (67/67), TypeScript, ESLint, optimized Next.js build, and `git diff --check` pass. Phase 7 data cleanup is still incomplete pending the isolated migration-020 execution and remaining rollout gates.

## Earlier continuation — roadmap gate revalidation (superseded by newer Phase 6 progress below)

- Re-ran the connector PCM framing suite (5/5), frontend suite (67/67), TypeScript check, ESLint, and optimized Next.js production build; all passed.
- At that checkpoint the 3CX media connector had only a PCM frame assembler; later adapter/resampler/media/fake-PBX progress is recorded below. The real PBX acceptance gate remains open.
- The agent/backend Python suites could not be executed in this environment: the project venv Python launcher returned Windows `Access is denied`, and bundled Python 3.12 has no pytest installed. No dependency installation or environment mutation was attempted.
- Neon CLI `4.21.0` is installed but cannot read/create its user credential profile due `EPERM` under `C:\Users\AnesuMetaBox\.config\neon`. Read-only Neon MCP project listing was available but returned only `Zimthreads Collective` and `Luxury Shop Mauritius`; searching for the linked `divine-hat-17233837` project returned no result. No branch or SQL operation was attempted. The isolated-branch migration/RLS gate therefore remains open.
- The roadmap remains incomplete. Production Neon, credentials, migrations, and PBX state were not changed.

## Earlier continuation — 3CX tenant-bound call lifecycle core (superseded by newer Phase 6 progress below)

- Added `connector/call-controller.mjs`, an SDK-independent controller for already-normalized events from one authenticated Route Point connection. It rejects unsupported event/direction, wrong Route Point, and unconfigured DID before claiming; it requires the DB claim result before dispatch; and dispatch metadata is limited to verified company, auth subject, published profile version, opaque session, and opaque room.
- The controller advances the injected durable state machine through `claimed -> connecting -> active` and `active -> ending -> ended`, tears down bridge/agent resources on failures and hang-up, redacts provider exception details to fixed reason codes, and keeps failed cleanup recoverable for retry.
- Added deterministic controller tests for tenant/event boundaries, duplicate event/call behavior, one dispatch, bound profile metadata, dispatch/media failure handling, cleanup retry, and required identity binding. Combined connector tests pass (12/12); `git diff --check -- connector` passes.
- At that checkpoint the SDK event consumer, resampler, audio bridge, fake-PBX suite, and real PBX acceptance were absent; later additions and current remaining gaps are recorded below.
## Latest continuation — 3CX SDK events and PCM resampling

- Pinned the official `@3cx/call-control-sdk` 0.1.10, LiveKit RTC Node 1.1.0, and LiveKit server SDK 2.19.1 in an isolated `connector/` package. Its supported engine is Node.js >=24; this host was running Node.js 22.23.2, so connector runtime deployment is not verified here.
- Added `ThreeCxSdkEventAdapter`: it registers listeners before connect, only accepts the configured Route Point's connected non-extension participant, requires stable provider identity and an injected PBX-verified inbound DID/direction result, hashes the call reference, and sends only the normalized event to the tenant-bound controller. Ambiguous provider fields fail closed.
- Added `Pcm16LiveKitResampler`: bounded PCM16LE frame conversion between 3CX 8 kHz mono and the configured LiveKit rate, fixed-duration output frames, and filter-tail flush. Added test coverage for conversion duration, format, close behavior, and malformed input.
- Added `ThreeCxLiveKitMediaBridge`: it publishes the caller's framed/resampled audio to a LiveKit local audio track, subscribes only to an injected dispatch-verified agent identity, resamples agent PCM back to the 3CX writer, applies bounded media queues, supports explicit barge-in queue clearing, and requires a safe failure callback. Fake-based tests cover caller input, rejection of an unverified room participant, trusted-agent output, cleanup, and queue overflow.
- Added failover triggers when the verified LiveKit agent disconnects, loses its audio subscription, or the room disconnects. The bridge invokes the required safe PBX failure callback once even if teardown emits multiple overlapping lifecycle events. Failure callbacks are deferred until the detecting media task can unwind, avoiding a cleanup self-await deadlock; rejected async callback errors are observed and redacted.
- Added a fake-PBX lifecycle test composing SDK event handling → tenant-bound durable claim → single dispatch → media attachment → hang-up cleanup; redelivery does not dispatch a second agent.
- Closed a call-ownership gap: active calls now renew their durable claim serially, retry one transient renewal error, and stop media/agent before invoking a required safe-fallback callback on confirmed lease loss. That callback still needs a tenant-configured PBX transfer/drop policy before production.
- Added orderly shutdown: the controller rejects new joins, waits for in-flight claims, closes media and agent sessions, invokes the PBX fallback, and only marks calls ended after fallback succeeds. The SDK adapter now coordinates drain before disconnecting the PBX client; incomplete drain leaves the PBX connection available for retry/hang-up handling.
- Closed a reconnect gap in the SDK adapter: it serializes lifecycle events, fences stale queued `connected` events against a later disconnect, keeps intake closed while retrieving a fresh REST call-control snapshot, ends locally tracked calls absent from that snapshot, and re-processes still-connected Route Point calls idempotently before declaring reconciliation complete. Snapshot/API failures remain fail-closed; regression tests cover duplicate prevention and failed reconciliation.
- Tightened `renew_threecx_call_lease` to require the existing lease is still unexpired, so a delayed worker cannot resurrect expired ownership; added a regression assertion for that SQL predicate.
- Added LiveKit dispatch verification using `AgentDispatchClient.getDispatch`: room ID, dispatch ID, and agent name must match; there must be one job in the running state; its server-reported participant identity is then bound to `ParticipantKind.AGENT`. `startVerifiedThreeCxLiveKitMediaBridge` performs this proof before opening the PBX audio path. Mismatch, failure, or timeout is fail-closed.
- Verification: connector suite passes 46 tests across 38 top-level tests, including reconnect reconciliation, the fast initial-disconnect race, fail-closed snapshot errors, agent/room media-loss fallback triggers, rejected asynchronous fallback handling, fallback-triggered bridge cleanup without deadlock, dispatch verification and mismatch cases, renewal retry/loss behavior, orderly shutdown/in-flight claim handling, refusal to disconnect PBX on incomplete drain, controller idempotency, SDK event filtering, native resampler timing/tail flush, bidirectional media adapter behavior, media identity filtering, cleanup, queue overflow, and fake call lifecycle. Node syntax checks and `git diff --check` pass.
- Frontend regression verification after this connector work: 67/67 frontend tests, TypeScript typecheck, ESLint, and Next.js optimized production build all pass.
- Python agent/backend tests remain unavailable in this host: `.venv\Scripts\python.exe` returns Windows `Access is denied` for both version and pytest checks. No Python packages or environment files were changed.
- The lease-expiry database regression was syntax-checked with the bundled Python runtime, but pytest is absent there and the project interpreter remains inaccessible; the Python test assertion is therefore not yet executed.
- Still absent: isolated credential lease, broker-hosted/private connector decision, verified DID resolver against an actual PBX, durable Neon adapters under NOBYPASSRLS, production LiveKit dispatch/session API wiring (the dispatch verifier exists but is not yet called by a deployed runtime), wiring the bridge failure callback to an operator-approved transfer/drop policy, broader composed fake-PBX protocol coverage (authenticated lifecycle, real media backpressure, transfer/fallback, and two-company isolation), and PBX acceptance. Focused SDK-adapter tests cover reconnect reconciliation, but tests use LiveKit/3CX fakes and do not establish real PBX/WebRTC interoperability. No PBX credentials are configured and no production DB/PBX changes were made.

## Latest continuation — active voice-path and demo-default audit

- Rechecked active frontend/runtime source for shared demo/default tenant identities and fictional company records. No active runtime match was found; remaining Acme/Ava/Charlie values are confined to historical seed/cleanup migrations. Tenant identity is derived from the verified Neon Auth user by the Next.js BFF and signed into the internal context.
- Audited the legacy browser-direct Gemini surface: `/api/gemini-token` returns `410` with `DIRECT_VOICE_DISABLED`, and the dormant Gemini hook has no active UI import. The active sandbox accepts LiveKit only. Existing regression tests cover both facts; no alternate browser voice credential path was found.
- Fresh local verification: frontend tests 69/69, TypeScript typecheck, ESLint, and optimized Next.js production build passed; connector suite passed 46/46; event-loop monitor tests passed 2/2 using the bundled Python runtime. The project `.venv` Python launcher still returns Windows `Access is denied`, and bundled Python lacks pytest/FastAPI/httpx/asyncpg, so the backend Python suite could not be rerun in this environment.
- No source behavior, database, credentials, or external services were changed during this audit. Live Neon/RLS, Google OAuth/calendar, credential-broker deployment, and 3CX PBX acceptance gates remain open as documented above.

## Latest continuation — production preflight and rollback-point check

- Confirmed the current branch is `codex/livekit-reliability` and rollback branch `codex/pre-elihu-merge-233f3ee` still exists locally.
- Inspected and ran the production preflight in both general-API and credential-broker modes. It prints configuration key names only, not values, and both modes fail closed. Outstanding classes include the root DSN/runtime-role mismatch, migration-only DSN present in service config, broker-only OAuth/KMS settings, production context/OAuth/broker settings, and scoped frontend/agent session-signing settings. No secret values were copied into logs or this report.
- Reconfirmed `scripts/dev.ps1` refuses local service startup when any configured Neon branch signal is `production`, `main`, or `primary`, and rejects disagreement between process, `.env`, and `.neon` branch identifiers. This guard remains necessary because the local connection targets the protected production branch.
- No branch, environment file, database, or external service was modified. Production rollout remains gated on a verified isolated Neon branch, dedicated non-bypass-RLS runtime identity, correct per-service secret configuration, and the live acceptance work listed in the rollout checklist.

## Latest continuation — database-independent Python regression suite

- Used the existing project virtualenv after its test process was approved; no dependencies were installed. The first run found a stale fake in `agent/test_audio_pipeline.py` that omitted the new `company_scope_context` property required by the pre-response guardrail hook. Updated only that test fixture.
- Reran the selected offline suite: **143 passed, 1 database-backed confirmation-token test deselected**. This covers the current backend security, OAuth-state unit behavior, credential broker, capability compiler, LiveKit agent, 3CX claim, and migration/runtime-role preflight tests. Neon-dependent calendar/RLS modules and the OAuth schema/provider acceptance module were excluded, and no Neon, Google, LiveKit, or PBX connection was opened.
- The previously inaccessible local venv can execute pytest under the approved elevated test run. This supersedes the earlier statement that Python tests could not be run in this host; it does not close the isolated Neon/RLS/provider acceptance gates.

## Latest continuation — Neon account and project recheck

- Confirmed the local `.neon` link still targets organization `org-ancient-dew-43434004`, project `divine-hat-17233837`, branch `production`. The Neon CLI is installed (`4.21.0`) but cannot read its credential profile (`EPERM` opening the user credentials file).
- The connected Neon MCP account is authenticated but exposes only the unrelated projects `Zimthreads Collective` and `Luxury Shop Mauritius`; searching for the linked project returns no result, and direct project lookup returns `project not found`. No branch was created under an unrelated project, and no production or database operation was attempted.
- The isolated migration/RLS gate therefore still needs the owner to connect the Neon account that can see the linked project (or explicitly relink this workspace to the intended project). Do not use the credential-like values on the publicly shared Notion Resources/Environment page as a workaround; rotate them and restrict that page as previously recorded.

## Latest continuation — application log/error redaction

- Removed remaining model tool-call arguments, call identifiers, cancellation IDs, and result objects from logging in the dormant Gemini hook. It remains disabled as an execution surface; logs now contain only static event labels.
- Replaced capability-validation and LiveKit profile-conflict exception text returned by settings endpoints with stable, non-reflective messages. Backend exception logs already emit only exception types for the audited handlers.
- Added frontend regression coverage for raw tool payload logging and safe error metadata, plus a backend endpoint test proving an exception sentinel is absent from both the HTTP error detail and captured logs.
- Verification: frontend tests **71/71**, TypeScript typecheck, ESLint, Next production build, focused backend redaction test **1/1**, and `git diff --check` pass. Build confirms the app routes compile; no DB, provider, or production services were contacted.
- This closes only the local redaction checks in this pass. The broader roadmap and external acceptance gates remain open; see the preceding Neon, production preflight, and 3CX status entries.
- A second full-source log scan found raw SQL-driver exception messages and request idempotency keys in `db/idempotency.py`, plus tenant UUIDs in OAuth credential persistence logs. These were changed to static events/exception-type-only diagnostics, and durable-task logs no longer emit generated task IDs or tenant-bound error details.
- Removed the final raw connection exception from the database CLI diagnostic output. The database health endpoint already suppresses provider details and is hidden in production.
- Extended the backend redaction regression to inject both a private DB error marker and a request key; both are absent from captured logs. Focused Python tests pass **2/2**; frontend remains **71/71**. No schema, database, or external service was changed.
- Re-ran the broad database-independent Python suite against the current checkout: **145 passed, 1 database-backed test deselected** across the LiveKit agent, backend security/OAuth/broker/capability/3CX modules, and migration/runtime-role checks. Neon/calendar/RLS/provider integration files were explicitly excluded; no external service was contacted.
- Re-ran the complete isolated 3CX connector test suite: **46/46 passed** on Node `v22.23.2`. The package declares Node `>=24`, so this verifies unit logic only and does not satisfy the connector runtime/deployment acceptance gate.
- Follow-up environment inspection found the Codex-bundled Node `v24.19.0`; reran the same connector suite using that supported runtime: **46/46 passed**. This supersedes the Node 22-only test limitation above, but no 3CX SDK/PBX runtime session was started and the real PBX acceptance gate remains open.
- Under Node 24, imported the installed `@3cx/call-control-sdk`, `@livekit/rtc-node` (including its native binding), and `livekit-server-sdk` successfully. This verifies local package loading only; no credentials, PBX, Neon database, or LiveKit service were contacted.
- Added a composed fake-PBX regression that runs two tenant-bound SDK adapters/controllers concurrently, verifies distinct company/profile/room/dispatch bindings for the same opaque provider call reference, and proves a cross-tenant DID is rejected before claim. The complete Node 24 connector suite now passes **47/47**. This is deterministic adapter evidence, not Neon RLS or real-PBX isolation evidence.

## Latest continuation — explicit tenant 3CX failure policy

- Implemented a required per-company call-failure choice in the 3CX setup UI: disconnect, or transfer to a selected approved destination. Both FastAPI and the isolated broker validate it, the DB repository rejects non-allowlisted targets before SQL, and the migration adds a DB constraint requiring a transfer destination to be present in that integration's allowlist.
- Added migration `022_threecx_failure_policy.sql`. Existing active integrations without a recorded choice are marked degraded until an owner reconfigures them; the migration has not been applied to Neon.
- Verification: focused policy/broker/input-security tests **29 passed**; broad database-independent Python suite **151 passed, 1 DB-backed test deselected**; frontend tests **72/72**, typecheck, ESLint, Next production build, and targeted `git diff --check` pass. No Neon, PBX, Google, or LiveKit connection was made.
- This persists and validates the operator's fallback choice but does not yet execute transfer/disconnect from the live connector. The broker-hosted vs. separately leased connector decision is still pending, and live PBX acceptance remains open.

## Latest continuation — fallback on startup failures

- Closed a Phase 6 lifecycle gap in `connector/call-controller.mjs`: initial dispatch, media-attachment, or activation failures previously cleaned up and recorded a terminal failure without executing the PBX fallback. The controller now records `ending` under the claim token before the fallback, only attempts the PBX action after media/agent cleanup succeeds, and records terminal `failed` only after the adapter confirms fallback success. Failed cleanup, lost state ownership, or unsuccessful fallback does not report success and leaves the call recoverable.
- Added regressions proving agent cleanup precedes fallback, fallback reason codes stay redacted, and an unsuccessful fallback remains in `ending` until shutdown retries and completes it.
- Verification: complete Node 24 connector suite **48/48**; `git diff --check` clean for the connector change. The PBX fallback remains injected and is not connected to persisted per-company settings or a real PBX.

## Latest continuation — active bridge failure lifecycle

- Added `ThreeCxCallController.handleMediaFailure` as the tenant/session-bound bridge callback target. It accepts only the bridge's fixed failure reason codes, serializes against other per-call work, stops lease renewal, transitions under the claim token, closes media/stops the agent, executes the injected PBX fallback, and reaches terminal failure only after confirmed fallback. Unrecognized reasons cannot trigger a PBX action.
- Added tests for cleanup-before-fallback order, untrusted failure-code rejection, and retained `ending` state plus shutdown retry when fallback fails.
- Verification: complete connector suite on Node 24.19.0 **50/50**, git diff --check clean. This creates a safe wiring point but does not wire it to the persisted failure policy or run against a PBX/Neon.
- Updated the verified media startup helper to require the tenant-bound controller and call session ID, then route bridge failure callbacks to `handleMediaFailure`. It rejects missing controller/session context and reports only static reason plus redacted outcome to an optional observer. The complete Node 24 suite remains **50/50**; no PBX, Neon, or LiveKit service was contacted.

## Latest continuation — controller consumes the persisted 3CX failure choice

- The controller now requires a failure policy as part of its verified tenant binding, validates a transfer destination against that tenant's allowlist, and rejects malformed/disconnect-with-destination bindings before accepting calls.
- Every fallback path (startup failure, active media failure, shutdown, and lost call-claim lease) now sends a normalized request containing the company/integration/call/session binding, a static failure reason, the selected action, and a destination only for an allowlisted transfer. This makes the fallback adapter's required contract explicit and prevents it from silently substituting a different per-company action.
- Added fake-PBX isolation assertions proving concurrent companies receive their own configured policy; corrected test fixtures that omitted the required policy.
- Verification: complete connector suite **50/50** on bundled Node 24.19.0. No PBX, LiveKit, or Neon service was contacted.
- Remaining gap: there is still no deployed connector composition root that obtains the tenant binding from the credential broker and implements `handlePbxFallback` against the authenticated 3CX call-control session. Thus this is validated controller plumbing, not live transfer/disconnect acceptance or Phase 6 completion.

## Latest continuation — demo-surface and canonical-policy audit

- Re-audited active dashboard, backend API/tool, agent, and database sources for fabricated calls/tasks/metrics, sample Calendar fallbacks, and legacy demo literals. The current dashboard shows authenticated tenant records or explicit empty/unavailable states; Calendar tools fail closed through the broker. The remaining Acme/Ava/Charlie strings are confined to historical migrations and their exact-value cleanup migration, not active runtime defaults.
- Found and removed a duplicate `systemInstruction` key from the shared `assistantPolicy.json`. Although both values were identical and ordinary JSON parsing silently selected one, duplicate keys make the policy ambiguous and can mask later policy edits. Added a regression assertion that the shared source defines the key exactly once.
- Refreshed the QA handoff's Phase 6 disposition: per-company failure policy is now captured and validated through the controller fallback request, while broker-backed connector composition and live PBX execution remain open.
- Verification: frontend tests **72/72**, TypeScript typecheck, ESLint, optimized Next production build, agent/capability policy tests **22/22**, full database-independent Python suite **152 passed, 2 skipped**, and connector suite **50/50** on Node 24.19.0. The calendar DB/edge-case and RLS integration modules were explicitly excluded because the configured branch is production. No Neon, provider, LiveKit, or PBX service was contacted.

## Latest continuation — single-tenant 3CX runtime composition boundary

- Added `connector/threecx-tenant-runtime.mjs` to compose one already-authenticated 3CX client and one already-verified tenant binding with the existing controller, SDK event adapter, and injected LiveKit/PBX media factory. It registers event listeners before connection, shares concurrent startup, exposes only static startup failures, drains calls before PBX disconnect, and leaves incomplete shutdown retryable while the PBX event path remains attached.
- This closes local wiring between the adapter/controller/media-factory interfaces without choosing where credentials are hosted or retrieved. It does not decrypt credentials, fetch tenant settings, implement the Neon repositories, sign/dispatch LiveKit sessions, or implement a concrete 3CX transfer/drop adapter. The deployment composition root still needs the approved broker-hosted or narrowly leased secret boundary.
- Added lifecycle tests for single-flight startup, listener cleanup on failed connect, and retry after incomplete call drain. The connector package now enforces Node.js >=24 before running tests; the default Node 22 correctly refuses, while the bundled Node 24.19.0 passes the version check and full suite **53/53**. No external service was contacted.
- Tightened the controller's tenant binding to copy only company, verified subject, profile version, integration, Route Point, DIDs, and validated failure-policy fields. It no longer retains arbitrary broker payload fields that could accidentally include decrypted credentials; empty DID lists and non-string route values fail closed. Regression coverage injects secret-like extra properties and proves they are absent from the public controller binding; connector suite remains **53/53**.

## Latest continuation — Neon project access recheck

- The Neon MCP tools are now available and authenticated. Read-only organization/project discovery shows organization `Anesu` (`org-misty-band-32565604`) with projects `Zimthreads Collective` and `Luxury Shop Mauritius`; searching the exact linked project ID `divine-hat-17233837` returns no result. This still does not expose the AI Voice Assistants database project.
- Neon CLI `4.21.0` is installed but `neon projects list` fails with `EPERM` opening the local credentials profile. No branch was created, no SQL was issued, and no database writes were made. The public Notion Resources/Environment values remain treated as exposed credentials and were not used.
- The isolated migration/RLS gate therefore remains externally blocked until the owner signs the correct Neon account into the MCP/CLI or relinks `.neon` to the intended project. Production remains untouched.

## Latest continuation — enforce branch safety across database access paths

- The launcher guard alone did not protect direct `asyncpg` paths. Shared target validation now runs before backend/broker pool access, migration DDL, privileged runtime-role provisioning, and the read-only schema inventory. It requires an explicit `NEON_BRANCH`, rejects disagreement with `.neon`, and refuses protected branches for local/test application pools. Migration and role-provisioning writes still require the explicit `--allow-production` flag; the schema inventory remains read-only but must match the linked branch.
- Added mocked tests for protected-branch refusal, missing branch, link mismatch, explicit production deployment mode, and proof that application/migration/inventory paths reject mismatches before opening a connection.
- Verification: targeted database branch-safety/migration/runtime-role tests **18/18**; full database-independent agent/backend/database suite **160 passed, 2 skipped**. Calendar DB/edge-case and RLS integration modules remained explicitly excluded. No Neon connection was attempted.

## Latest continuation — signed tenant-context regression coverage

- Expanded `backend/tests/test_auth_context.py` to verify that a validly signed claim is rejected when its company, session, or published profile version is changed; that an expired but correctly signed claim is rejected; and that verification fails closed when the signing secret is absent.
- Verification: focused auth-context tests **4/4**; full database-independent agent/backend/database suite **162 passed, 2 skipped**. Database-backed Calendar, edge-case, and RLS suites remain excluded because the configured Neon target is production. No external service was contacted.

## Latest continuation — offline RLS migration inventory guard

- The behavioral cross-company RLS test remains unrun against a real database because `.neon` targets production. Added an offline source-level regression that compares the canonical `TENANT_TABLES` inventory with all ordered SQL migrations and requires every tenant table to have both `FORCE ROW LEVEL SECURITY` and an explicit table policy.
- Verification: offline RLS fixture and migration-source tests **2/2**. This catches source omissions but is not a substitute for the isolated-branch behavioral RLS test with the dedicated non-bypass runtime role.

## Latest continuation — apply each company's timezone and hours to Calendar operations

- Calendar list and availability previously treated date boundaries and business-hour suggestions as UTC even though onboarding persisted a company IANA timezone. When timezone was omitted from a model tool call, Pydantic also inserted `UTC`, preventing the backend from applying the tenant setting. Tool schemas now leave timezone unset unless explicitly overridden; the authenticated backend resolves the company's saved timezone and fails closed if it is missing/invalid. Broker payloads validate IANA names.
- Google event-list and Free/Busy requests now use local-day boundaries converted to UTC and include the timezone; availability suggestions use the exact signed published profile's weekday hours, honor explicitly closed days, skip nonexistent local slots during DST spring-forward, and return UTC timestamps. Profiles without a configured weekly schedule retain the backward-compatible 09:00–17:00 default. Timezone-naive booking timestamps are interpreted in the company's timezone. Added `tzdata` to backend and agent requirements for environments without an OS IANA database.
- Updated LiveKit tool descriptions so its Gemini function schemas explicitly interpret date-only requests and timezone-naive booking times in the company-local timezone.
- Added route-level signed-session tests proving availability receives both the authenticated company's timezone and business hours from the session-bound published profile, while list-event requests receive the saved timezone before tool dispatch. Broker routing and policy compilation tests cover explicit weekly hours, closed days, malformed values, and profile-bound payload forwarding.
- Verification: focused timezone/capability/broker tests **33/33**; LiveKit agent security/reliability tests **12/12**; full database-independent Python suite **180 passed, 2 skipped**. No external provider or database was contacted.

## Latest continuation — bind timezone to each LiveKit session

- Timezone was loaded from the current company profile for every tool call, so changing company settings during a call could make one active session use different local dates/hours over time. LiveKit token issuance now snapshots the validated company IANA timezone into the already-HMAC-signed dispatch metadata. Backend and agent verifiers both bind and validate this optional claim, and the worker uses it in company context. Calendar tool dispatch prefers the signed session value; older contexts without it retain the profile lookup fallback. The frontend-to-backend auth claim shape and public token response remain unchanged.
- Added backend-to-worker signature parity coverage, tampering rejection, worker forwarding checks, and route-level proof that an existing session timezone bypasses current-profile reload.
- Verification: focused context/timezone/agent tests **29/29**; full database-independent Python suite **182 passed, 2 skipped**. No database or provider was contacted.

## Latest continuation — frontend release verification

- Re-ran the Next.js frontend gates after the session-bound timezone and profile-hours changes. Dashboard/API proxy tests remain green, including single-voice LiveKit lifecycle, tenant onboarding, 3CX write-only credential handling, and no-demo-surface assertions.
- Verification: frontend tests **72/72**, TypeScript typecheck, ESLint with no warnings/errors, and Next.js 14.2.11 production build all pass. The build exposes the dashboard at `/` and the authenticated proxy routes; no external service was contacted.

## Latest continuation — preserve timezone across future 3CX dispatches

- Extended the verified 3CX tenant binding with an explicit IANA timezone. The controller validates it, retains only that allowlisted metadata field, and passes it to the injected LiveKit dispatcher alongside the company, auth subject, profile version, integration, and generated session ID. Secret-like binding fields remain excluded. This keeps the planned PBX-to-LiveKit path aligned with browser session timezone snapshot semantics without choosing where credentials or dispatch signing will be hosted.
- Updated concurrent fake-PBX fixtures to use distinct tenant timezones and added invalid-timezone rejection coverage.
- Verification: bundled Node.js 24.19.0 connector suite **53/53**. The default Node.js 22 correctly refuses to run the connector because the pinned 3CX SDK requires Node.js 24+. No PBX, Neon, or LiveKit service was contacted.

## Latest continuation — broker-bound 3CX runtime composition

- Added `connector/broker-bound-tenant-runtime.mjs` as a deployment-neutral composition root. It accepts only an injected broker lease containing an already-authenticated PBX client and minimum verified tenant binding, single-flights lease acquisition, prevents runtime options from overriding leased tenant identity, and releases the lease on startup failure and shutdown. It never decrypts, logs, or forwards raw credentials and does not choose between broker-hosted and isolated-connector deployment.
- Added regressions for concurrent start deduplication, tenant/client binding, startup-failure release, shutdown release, invalid tenant references, and absence of credential fields from the runtime binding.
- Corrected an unsafe shutdown path: an incomplete underlying drain now leaves the broker lease and runtime in `draining` state for retry; the lease is released only after the runtime confirms it is stopped. Added a regression for two-step drain/release behavior.
- The lease contract now also requires an opaque lease ID, an exact tenant-reference match, and a future expiry before the PBX runtime is constructed; cross-tenant and expired leases fail closed without creating a runtime.
- Added a lease-expiry watchdog: once a tenant runtime is running, expiry enters the same guarded shutdown path, clears the lease only after a confirmed stop, and leaves incomplete drains retryable instead of serving past authorization.
- A broker-release failure can no longer be swallowed: shutdown remains `draining`, retains the leased runtime, and retries release instead of reporting a clean stop. Startup cleanup follows the same fail-closed behavior.
- Verification: complete bundled Node.js 24.19.0 connector suite **60/60**. This is composition and lifecycle coverage only; a real broker transport, Neon claim adapter, LiveKit dispatcher, PBX client, and non-production acceptance environment remain required.

## Latest continuation — authenticate tool schema discovery

- The backend `/tools/schemas` endpoint now requires the same verified signed tenant session context as tool execution. It returns no tool inventory to unauthenticated callers, closing the remaining unauthenticated API surface while preserving the exact four-tool calendar allowlist for authenticated sessions.
- Verification: database-independent Python suite **183 passed, 2 skipped**. The two skipped cases are database/provider checks intentionally excluded while the configured target is the protected production branch.

## Latest continuation — enforce assistant profile lifecycle transitions

- Explicit profile publishing now accepts only `validated` or `tested` versions, and rollback accepts only `superseded` versions. Drafts can no longer be promoted around the validation path, and repeated same-state publication is rejected. The existing save-and-publish request remains allowed because it compiles and validates the profile server-side in the same operation.
- Added source-state transition tests and retained tenant-scoped row locking before lifecycle mutation.
- Verification: database-independent Python suite **189 passed, 2 skipped**. Live database transition behavior still requires the isolated migrated Neon branch acceptance gate.

## Latest continuation — current local release gates

- Re-ran the current Next.js frontend release gates after the lifecycle changes: frontend tests **72/72**, TypeScript typecheck, ESLint with no warnings/errors, and the optimized Next.js 14.2.11 production build all pass. The build includes the dashboard, authenticated configuration/profile routes, integration proxies, and LiveKit token routes.

## Latest continuation — fail closed when no assistant profile is published

- LiveKit token issuance now requires a tenant's published profile, or an explicitly requested draft/validated/tested preview profile. A tenant with no approved profile can no longer start a session on a platform default, preventing an unconfigured assistant from bypassing onboarding policy.
- Verification: database-independent Python suite **190 passed, 2 skipped**; focused LiveKit/profile lifecycle tests **11/11**.

## Latest continuation — cap internal session credentials

- FastAPI and the LiveKit worker now enforce a hard 15-minute maximum for signed session-context acceptance. Invalid, zero, or overlong configured windows fail closed, preventing an accidental deployment setting from turning a dispatch credential into a long-lived service credential.
- Verification: signed-context and worker security tests **16/16**. The default configured window remains five minutes.
- Malformed worker configuration is also treated as an invalid zero-length window instead of crashing during import; a direct isolated import check confirms verification is disabled for a non-numeric value.

## Latest continuation — production configuration preflight

- The repository preflight was run against the current checkout. It correctly refuses rollout and reports the remaining deployment-only prerequisites: a dedicated non-bypass-RLS runtime role matching the application DSN, removal of migration-only/private secrets from general service environments, production session/OAuth signing secrets, broker URL/shared secret, and corresponding worker/frontend context secrets.
- No production configuration or database state was modified. These are operator-owned deployment inputs, not missing application code.

## Latest continuation — verified Neon migration-test branch and live RLS

- The Neon CLI was reauthenticated with the intended project `AI voice assistance` (`divine-hat-17233837`) under organization `org-ancient-dew-43434004`. The workspace was pinned to the existing isolated branch `codex-roadmap-migration-test` without pulling or overwriting local environment files.
- Read-only inventory before migration found the branch at migration `015`, with empty `company_profiles` and `assistant_configs`, and encrypted OAuth columns only. Pending migrations `016`–`022` were then applied successfully to this isolated branch; production was not touched.
- The existing `voice_bot_runtime_test` role had been created before the later migrations and lacked grants on the new 3CX tables. Updated `db/provision_runtime_role.py` to verify the role remains `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT` and refresh missing tenant-table grants idempotently without changing its password. The real cross-company RLS test then passed **3/3**.
- Administrative read-only inventory now confirms migrations `001`–`022`, all roadmap tables, encrypted OAuth columns, and forced RLS across the tenant tables. The runtime role intentionally cannot read `schema_migrations`; the inventory was run with the administrative role separately.
- Verification: runtime-role safety tests **9/9**, isolated Neon RLS behavior **3/3**, and administrative schema inventory exit code **0**. Production remains unmodified.

## Latest continuation — live calendar contract verification on Neon

- Updated the database-backed calendar contract fixtures to use per-run idempotency keys. This preserves the production conflict/idempotency behavior while keeping repeated acceptance runs isolated from their own prior rows.
- Verification: calendar integration contract tests **2/2** against the isolated Neon runtime role. The legacy local-calendar persistence and edge-case suites remain intentionally skipped (**17 skipped**) because the roadmap routes calendar writes through the Google integration broker.
