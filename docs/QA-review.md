# QA and Systems-Design Review

## Purpose

This document is the handoff for QA, security, and systems-design collaborators. It records the risks found in the current implementation and the controls that must be verified before multi-company use.

## Current live-application audit and continuation handoff — 23 September 2026

This section supersedes older status statements below wherever they conflict. It combines a read-only source review, independent QA and architecture reviews, and a names-only Railway configuration inspection. No application code or Railway variables were changed. Existing local edits were preserved. Secret values and customer profile contents were not inspected.

### Executive assessment

The current system is not merely client-side mockup code: it has a Next.js same-origin backend-for-frontend, Neon Auth session verification, signed tenant context to FastAPI, company/profile persistence, capability compilation, versioned agent profiles, RLS migrations, and a separate credential broker. However, the deployed setup is not yet demonstrated as a coherent, production-safe release. Most urgently, assistant profile saves are failing in production; onboarding completion can be inferred too early; deployment revisions are split; and the production database role, migrations, cookie flags, and credential encryption provider have not all been verified against live state.

### Confirmed live failure: assistant profile save returns 500

Railway logs for 23 September 2026 show:

- `GET /assistant-config` succeeded repeatedly; `POST /assistant-config/validate` succeeded on the later attempts.
- Three `POST /assistant-config` requests returned HTTP 500 at approximately 08:15, 08:16, and 08:17 UTC.
- The Voice API logged `Failed to save assistant config (error_type=AmbiguousParameterError)` for those failures. The API maps unexpected exceptions to the generic “Assistant configuration service is unavailable” message in `backend/app/api/settings.py` around lines 252–256.
- The corresponding frontend proxy requests reached Railway and returned HTTP 500. Therefore this observed save failure is not explained by the Next.js route being absent, a failed sign-in, or a missing backend connection. It is a backend persistence-path failure.

The precise SQL statement is **not proven**: the production handler logs only the exception class and suppresses the traceback/SQL. A strong first query to isolate is the versioned-profile insert in `db/agent_profiles.py` around lines 49–56, particularly the reused `$3` lifecycle-state parameter in its `CASE` expression. This is a hypothesis for the next engineer to reproduce against an isolated database branch, not a confirmed root cause. The legacy `assistant_configs` save occurs first (`backend/app/api/settings.py` around lines 218–226), then the versioned profile save follows (around lines 227 onward); they are separate repository transactions. If the second step fails, the endpoint reports failure even though the first representation may already have persisted. This creates a confirmed partial-save/inconsistent-state risk.

**Next action:** reproduce both draft-save and publish requests on an isolated migrated Neon branch, identify the failing statement without recording request bodies or secrets, fix the parameter typing/query, make the two writes atomic (or provide explicit recovery semantics), and add a real database-backed regression test. Do not diagnose this from the generic UI message alone.

### Deployment and Railway configuration findings

Railway's production service configuration currently shows:

| Service | Source | Commit | Finding |
| --- | --- | --- | --- |
| AI Voice Bot (Next.js) | `main` | `3b980eb` | Browser-facing frontend. |
| Voice API | `develop` | `6deef3f` | Public HTTPS domain and FastAPI process. |
| Credential Broker | `develop` | `6deef3f` | Private service endpoint; no public domain shown. |
| LiveKit Worker | `develop` | `6deef3f` | Separate worker process. |
| Next.js with Neon | unrelated `neondatabase-labs/neon-railway-nextjs` sample | `c4c5e28` | Extra public Railway service, not the repository's frontend; confirm its intended purpose and remove/disable only with owner approval. |

This split across `main` and `develop` is verified, but a specific frontend/backend contract mismatch has not been proven. It does mean the running application is not pinned to one reviewed release and complicates diagnosis/rollback. Reconcile and deploy a reviewed compatible commit set before calling the whole stack one release.

Railway variable **names only** were inspected. Absence from one service is not automatically a defect: the Google Calendar OAuth client secret belongs in the credential broker, not the browser or general API; migration-only unpooled DSNs and privileged credentials should not be in runtime services; worker/API/frontend secrets should be scoped to their use. However:

- The frontend service has names for `DATABASE_URL`, `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`; none of these names is referenced under `frontend/src` in the current source. The browser-direct Gemini route returns 410 and the UI requests LiveKit tokens through the backend proxy. These frontend variables appear redundant and expand secret exposure; validate against the exact deployed frontend commit before removing them.
- The broker variable-name inventory includes `CREDENTIAL_ENCRYPTION_KEY` and `CREDENTIAL_KEY_PROVIDER`, but does not show `CREDENTIAL_KMS_KEY_ID`, `AWS_REGION`, or `AWS_DEFAULT_REGION`. The actual values and any out-of-band workload identity were not inspected. This does not prove what provider value the broker is using; it does mean KMS readiness is unverified and the environment-key variable name is inconsistent with the production policy. The code rejects the `env` provider when `APP_ENV` is production (`backend/app/services/credential_envelope.py`); the rollout checklist requires AWS KMS workload identity and broker-only KMS permission (`docs/PRODUCTION_ROLLOUT_CHECKLIST.md`, lines 18–27). Confirm via the production preflight without printing values. Do not switch to static AWS access keys.
- Core variable names exist in the expected service scopes: Neon Auth URL on Next.js; database and signed-context settings on API/broker as appropriate; LiveKit settings on API/worker; Google client secret on the broker. Names alone do not prove values are non-empty, correct, rotated, or equal across services.

Thus, “many missing variables” needs a service-by-service matrix, not one global checklist. Some omissions are intentional security boundaries; wrong or empty values for a required service input will break that service. The current evidence cannot certify the values.

### Persistence, onboarding, and Google account behavior

- Company information is persisted through the authenticated `/company-profile` API into `company_profiles`; the assistant save path writes legacy `assistant_configs` and a structured/versioned `agent_profile_versions.profile` JSONB document. Railway logs show company-profile and assistant-config reads returning 200. These are server/database paths, not local-storage-only onboarding.
- Neon Auth owns application users/sessions. Company tenancy and memberships are represented in `companies` and `company_memberships`. Integration metadata and encrypted credential records, profile versions, preferences, and voice/session state also exist; the database is not limited to only the four requested categories. It should not store raw audio/transcripts or mirror Google Calendar event contents except for explicitly justified, tenant-scoped operational data.
- Returning users are routed to the dashboard if `company_name` exists (`frontend/src/App.tsx` around lines 1861–1874). The persisted `onboarding_complete` preference exists in backend/database code, but frontend routing does not consult it. Nor does this decision verify that an assistant profile is published or required integrations are ready. This can send a user to the dashboard after only company details were saved, while voice startup later rejects a missing published profile. Make completion a persisted, explicit state derived from required setup milestones and test same-account sign-in/reload plus partial setup.
- The v1 model is one company per application login (`company_memberships` has a unique user constraint). It does not yet support multiple employee logins sharing a company. This is consistent with the plan but must be an explicit product limitation.
- Google application sign-in and Google Calendar connection are distinct OAuth uses. The app can support password sign-in through Neon Auth and social sign-in through Google; Calendar connection is a separate Google OAuth consent grant. The user should enter a Google email/password only on Google's own authorization page. The app must never collect or proxy a Google password. The Calendar connected-account email should be persisted and displayed as non-secret metadata.

### Architecture and security review

Positive controls found in source:

- The Next.js Auth catch-all forwards Auth cookies/`Set-Cookie`; backend API requests do not forward the browser cookie. `frontend/src/lib/backendProxy.ts` checks same-origin mutations, obtains a server-verified Neon session, and sends a signed tenant context instead.
- `frontend/src/lib/sessionContext.ts` verifies the cookie by calling Neon Auth server-side and derives a company identifier from the authenticated subject. Backend repositories set transaction-local `app.company_id`; migrations define tenant RLS policies and `FORCE ROW LEVEL SECURITY` on tenant tables.
- Google OAuth credentials are brokered and encrypted in code; migration and production docs require a non-bypass-RLS role, KMS, and secret separation.

Open verification gaps / design risks:

1. **Live cookie attributes are unknown.** The Next.js proxy passes `Set-Cookie` through and does not itself enforce `HttpOnly`, `Secure`, or `SameSite`. Verify the actual production response in browser developer tools and add tests for those flags; do not assume proxy code proves them.
2. **Live Neon production state is unknown.** Local migrations and the isolated test branch do not prove which migrations are applied to Railway's DATABASE_URL, whether the service uses the expected `NOSUPERUSER NOBYPASSRLS` role, or whether every RLS policy/grant works for the production runtime. Check the actual Railway database target and only run read-only schema/role inventory first; do not dump customer rows or secret-bearing tables.
3. **Company name is duplicated.** `companies.display_name` and `company_profiles.company_name` are separate fields. `ensure_company` inserts the company name on first creation but does not update it on later profile changes. Declare a source of truth or keep both synchronized transactionally.
4. **Google integration schema has possible drift.** `google_integrations` is created in migration 007 while OAuth token repositories also use the older `oauth_tokens` table. Audit and document the authoritative source for status/email, ciphertext, scopes, and refresh lifecycle before adding more integration code.
5. **Repeated authenticated reads are slow in observed logs.** Several production assistant/profile reads took roughly 3.7–4.8 seconds at the API layer; some integrations were also several seconds. Profile end-to-end timing and Neon cold-start/connection-pool behavior need measurement. The frontend test suite cannot establish acceptable production latency.
6. **Production-ready does not mean all future integrations work.** Existing plans record that 3CX runtime composition/PBX acceptance and several production rollout gates remain incomplete; do not expose unfinished capabilities as working product behavior.

### Independent QA and architecture perspective

Two independent read-only reviewers reached the same high-level conclusion: the generic configuration message masks backend persistence exceptions; saves are not atomic; onboarding completion is inferred from company-name presence; production RLS/migration/runtime-role and cookie flags need live verification. The architecture review flagged the versioned-profile insert as the leading SQL hypothesis but did not prove it. It also found that the current code/deployment split and unverified production encryption configuration undermine confidence even where the repository contains intended controls.

### Verification performed in this audit

- Railway status and service configuration read-only; variable names only. No Railway values were retrieved or changed.
- Production HTTP/runtime logs around 08:00–08:50 UTC on 23 September 2026; no request bodies, transcripts, or credentials used as evidence.
- Frontend test suite: **74 passed, 0 failed**. TypeScript typecheck: **passed**.
- Python is available in the repository's `.venv` as Python 3.12.14 (the executable is not on the global shell `PATH`). Follow-up verification ran the focused assistant publish, profile-versioning, and company-membership tests: **11 passed**. Pytest emitted a cache-write permission warning for `.pytest_cache`; it did not affect test results.
- No live browser cookie inspection, Google OAuth completion, production database query, or cross-company production test was performed. `.neon` metadata points at the isolated `codex-roadmap-migration-test` branch; that is not evidence about the Railway database target.

### Required next-engineer order of work

1. Reproduce and fix the assistant draft/publish failure on an isolated migrated database; identify the exact SQL; make legacy and versioned writes atomic; add DB-backed tests.
2. Run production configuration preflight against Railway using names/boolean validation only; verify each value's presence, service scope, and cross-service consistency without printing secret values. Confirm broker KMS provider and workload identity; confirm database role and branch.
3. Read-only inspect the Railway Neon branch: current database/branch identity, applied migration ledger, tenant table/policy inventory, forced-RLS flags, role flags, and required grants. Stop if branch identity or access role is unclear.
4. Reconcile the frontend/API/worker/broker revisions into a reviewed release; document exact commit SHAs and rollback as one release unit.
5. Define explicit persisted onboarding milestones; support return-to-dashboard only after the correct milestone, while keeping incomplete setup recoverable. Test first signup, interrupted onboarding, assistant publish failure/retry, logout/login, reload, and two isolated accounts.
6. Verify Auth cookie flags and same-origin CSRF behavior in production; test account A cannot read/write account B's profile, assistant versions, Google email/tokens, or sessions.
7. Confirm Google sign-in and Calendar OAuth separately, including Calendar email display and real availability/list/book/cancel consented flows. Never collect Google passwords.
8. Profile API latency and run the full acceptance suite against an isolated migrated branch before production rollout; do not infer live readiness from local unit tests.

## Prior audit history

## Current findings and disposition

The findings below were captured against an earlier baseline. They are not all
current defects. Use the re-audit and this disposition table as the current
status; the historical baseline is retained below for traceability.

| Original finding | Current code status | Remaining evidence/gap |
| --- | --- | --- |
| Caller-controlled tenant identity | Core APIs now use verified Neon Auth context and signed internal claims; browser/tool identity arguments are removed from active paths. | Complete cross-company tests on the migrated isolated schema and test two real accounts. |
| Direct database access paths could bypass branch/target consistency checks | Fixed locally: application/broker pool access, migration DDL, runtime-role provisioning, and read-only schema inventory now require explicit branch configuration and reject a `NEON_BRANCH`/`.neon` mismatch before opening a connection. Protected write operations still require explicit `--allow-production`; local/test app processes cannot open protected branches. | Mocked branch-safety tests pass. This compares local branch declarations, not the remote endpoint identity; verify the DSN belongs to the named branch. Production must still use the dedicated `NOSUPERUSER NOBYPASSRLS` role, and RLS acceptance must run only on the isolated migrated branch. |
| Unsafe raw onboarding prompt authority | Versioned capability compiler and canonical policy are implemented; company instructions are bounded subordinate context. | Authenticated end-to-end publish/dispatch/tool-denial acceptance remains open. |
| Tenant-unsafe/plaintext Google OAuth | PKCE, one-time tenant-bound state, encrypted token storage, metadata-only status, and credential-broker operations are implemented in code. | Production KMS/IAM boundary and live OAuth/calendar acceptance are not verified; existing account must reconnect after migration 008. |
| Company timezone and configured hours were not applied consistently to Calendar results | LiveKit token issuance now binds a validated timezone into signed dispatch metadata; the worker and backend verify it, so timezone changes do not alter an active session. Calendar list/availability use local-day bounds converted to UTC; availability uses the exact published profile's weekday hours and closed-day settings; naive booking timestamps use the same session timezone. Profiles without configured hours retain the 09:00–17:00 fallback. Nonexistent DST spring-forward slots are skipped. Backend and worker requirements include `tzdata`. | Focused tests cover cross-language signed claim parity/tampering, profile snapshot → backend tool → broker propagation, Mauritius UTC bounds, configured/closed days, DST, booking conversion, and validation. Verify against a connected Google account on an isolated migrated branch. |
| Credentials published in Notion | The Resources / Environment page was visible in the signed-in Notion workspace and explicitly says “visible to anyone with the link”; it contains credential-like Neon API/database, LiveKit, and Google values. | Treat the values as compromised: revoke/rotate them, remove them from the page, and restrict the page's sharing. The assistant did not use these values. |
| Missing authenticated LiveKit company context | Signed context includes verified subject/company and profile snapshot; dispatch/session binding and single active voice path are implemented. | Active-conversation latency and real browser acceptance remain open. |
| Global calendar-only policy | Replaced by a capability registry/compiler for currently implemented receptionist, FAQ, and Calendar capabilities. | Lead qualification and 3CX transfer remain unavailable; onboarding must not present them as active. |
| Company-scope turn gate failed open on unknown requests | Fixed in the local worker: company FAQ/receptionist turns now require a match against published FAQ content or a configured company fact; greetings/calendar intent retain their existing paths. Unknown and mixed-scope requests redirect before Gemini response generation. | Focused worker/backend guardrail tests pass (22); full agent suite passes (22). Matching is intentionally conservative and must be validated against realistic company FAQs in browser/voice acceptance. No additional model call was introduced. |
| Controller retained arbitrary tenant-binding fields | Fixed locally: the 3CX controller now copies an explicit allowlist of verified company/profile/routing/policy fields rather than spreading the full binding object, so accidental credential fields are not retained in its public binding. Secret-like-extra and empty-DID regressions pass. | The runtime must continue to receive only the required minimum tenant metadata; credentials belong to the authenticated PBX client/provider adapter and must never be added to the tenant binding. |
| User rather than company ownership | Companies and memberships are the tenant boundary; v1 provisions one owner. | Membership invitation/role administration is future work, not part of v1. |
| Incomplete 3CX media path | Credential setup/probing now uses separate Service Principal client ID and Route Point DN fields; SSRF defenses, tenant-scoped event/call-claim primitives, pinned-SDK adapter, PCM resampler, bidirectional media bridge, exact LiveKit dispatch verifier, lease handling, reconnect reconciliation, required per-company disconnect/allowlisted-transfer policy, validated tenant timezone propagation, and a broker-lease composition root exist as local code. | Migration `022` and the setup contract require isolated-branch verification. The composition root still depends on injected broker transport, Neon claim adapter, LiveKit dispatcher, authenticated PBX client, and fallback adapter; no real PBX or non-production acceptance has passed. The controller validates and passes the selected action/target to an injected fallback adapter, but that adapter is not composed with stored settings or an authenticated PBX session. |

## Historical critical findings (baseline)

### 1. Tenant identity is caller-controlled

Several APIs accept `user_id` from query strings or request bodies. Gemini tool schemas also expose identity fields, and malformed IDs can fall back to a shared default account.

Required update:

- Create a company/tenant boundary.
- Derive identity only from verified Neon Auth sessions or signed internal service claims.
- Remove `user_id` from browser and Gemini tool contracts.
- Reject missing or mismatched identity; never use a fallback account.
- Enforce ownership in both application code and database RLS.

### 2. Raw onboarding prompts can weaken the platform policy

The current stored `system_prompt` can be placed into the agent instruction with unsafe precedence. Company fields may also be interpolated as if they were trusted instructions.

Required update:

- Replace raw prompt authority with a versioned policy compiler.
- Separate immutable platform security rules from company instructions.
- Treat company instructions, Calendar data, caller speech, and tool results as untrusted data.
- Allow onboarding to customize business behavior, but not identity, secrets, tools, confirmations, retention, or security rules.

### 3. Google OAuth is not tenant-safe

Current OAuth state contains an unsigned user ID, callback failures can fall back to the shared account, credentials are stored in plaintext, and status/disconnect accept arbitrary user IDs.

Required update:

- Bind OAuth to the active Neon session.
- Use PKCE, one-time state, secure cookies, and exact callback origins.
- Verify and store the connected Google subject and email.
- Encrypt credentials using managed-KMS envelope encryption.
- Return connection metadata only; never return tokens.

### 4. LiveKit lacks authenticated company context

LiveKit dispatches and worker configuration can use defaults while model tools accept user identity. This can load the wrong company configuration or invoke the wrong Google account.

Required update:

- Bind token, room, dispatch, worker job, profile version, integration, and session to one company.
- Inject tenant identity server-side.
- Create one immutable configuration snapshot per session.
- Reject duplicate or mismatched jobs.

### 5. A global calendar-only policy cannot represent company assistants

The calendar policy is currently a global four-tool boundary. It cannot safely support receptionist, FAQ, qualification, or 3CX workflows.

Required update:

- Use a centrally maintained capability registry.
- Let onboarding enable approved capabilities.
- Compile the exact tool inventory server-side.
- Enforce the compiled policy again in FastAPI; model instructions are never authorization.

### 6. The tenant key should be a company ID

Credentials, phone routing, profiles, and sessions should belong to a company rather than whichever user created them.

Required update:

- Add `companies` and `company_memberships`.
- Enforce one owner per company in v1.
- Keep the schema ready for future team members and roles.

### 7. The 3CX media path is not yet decision-complete

Running a 3CX-direct agent and a LiveKit agent simultaneously could recreate the duplicate-voice problem.

Required update:

- Complete a 3CX media-plane spike first.
- Choose one controlled path: 3CX → adapter/SIP ingress → LiveKit → one Gemini agent.
- Add atomic call claiming, event idempotency, reconnect leases, and terminal cleanup.

The v20 authentication flow is now pinned to the official Service Principal
contract: exchange `appId`/`appSecret` at `/connect/token`, then use the
short-lived Bearer token for Call Control and WebSocket operations. A raw API
key header is not an acceptable substitute. The implementation has a server-
side token-flow probe and security tests, but a real PBX is still required to
verify the media and call lifecycle.

## Re-audit — 22 September 2026

An independent systems-design review compared the implementation with the
roadmap. Findings below distinguish code defects fixed in this pass from open
architecture and rollout work.

### Fixed in this pass

- OAuth PKCE state writes and one-time consumption now set the tenant RLS
  context inside a transaction. Consumption is additionally constrained to
  the company ID from the verified signed state.
- Google OAuth initiation ensures the authenticated user's company row exists
  before saving state, including first-time Calendar connections.
- The 3CX `/connect/token` request now uses the documented
  `application/x-www-form-urlencoded` fields (`client_id`, `client_secret`,
  and `grant_type=client_credentials`) instead of multipart form data and an
  undocumented scope.
- 3CX HTTP probes now pin TCP to a validated globally routable address while
  keeping TLS certificate verification bound to the original PBX hostname;
  environment proxies and redirects remain disabled.
- 3CX probe DNS work, streamed response sizes, and broker concurrency are now
  bounded; late OS resolver work retains its slot until completion.
- 3CX fallback policy is required in the controller tenant binding;
  transfer destinations must be in that tenant's allowlist. Startup, media,
  shutdown, and lease-loss fallback requests carry the validated choice.
  Fake-PBX isolation coverage proves two companies receive distinct fallback
  policies; the full connector suite passes 50/50 on Node 24.19.0. This is
  controller-contract evidence only, not live PBX acceptance.
- New regression tests cover OAuth RLS scoping, first-time company setup, and
  the 3CX token request contract and DNS pinning; the newer probe resource-limit
  tests have since been run with the project virtualenv (see the implementation
  status log); no live PBX or production database was contacted.

### Remaining code and architecture gaps

1. **Membership ownership:** signed internal context now carries the verified
   Neon Auth subject, and company provisioning writes/checks that subject
   against the derived company. Cross-company membership conflicts fail
   closed; legacy company-ID-as-user placeholders are removed only within
   their own tenant. Before enabling multiple users per company, implement
   explicit membership administration/invitations and authorization for each
   role; v1 remains one authenticated owner per company.
2. **Credential broker boundary:** a separately launched FastAPI broker now
   performs Google Calendar/OAuth and 3CX setup operations; the general API
   receives provider results/metadata only. Broker requests use timestamped
   HMAC signatures with a tenant-scoped one-time nonce ledger (`017`), and the
   KMS policy references a dedicated broker role. Production separation is
   not yet proven: provision distinct AWS workload identities, HTTPS/internal
   network policy, and the broker-only KMS role; apply migrations `016`–`022`
   to the isolated branch and verify audit logs plus end-to-end credential
   non-disclosure before rollout.
3. **Capability activation:** persisted onboarding and settings now grant the
   implemented receptionist, company FAQ, and Google Calendar capabilities.
   The compiler derives their policy from shared canonical templates, the
   worker's company context is snapshot-bound, and backend tool execution
   checks the published snapshot's exact tool grants. Lead qualification and
   3CX call transfer remain unavailable; do not expose them as active until
   their behavior and enforcement exist. Add authenticated end-to-end tests
   proving each capability grant and denial across publish, dispatch, worker,
   and backend execution before production rollout.
4. **3CX call path:** migration `016` and repository primitives provide a
   tenant-scoped idempotent event inbox, atomic call claim, opaque room name,
   lease renewal, and compare-and-set state transitions. Local code also
   contains the pinned-SDK event adapter (including fresh-state reconnect
   reconciliation), bounded PCM conversion, a bidirectional media bridge, and
   an exact LiveKit dispatch/job/participant verifier. These pieces are still
   not wired into a running connector with broker-issued tenant credentials,
   the Neon claim repository, verified DID resolution, and the LiveKit
   dispatcher. The company can choose disconnect or an allowlisted transfer
   destination, and the controller validates that policy before passing it to
   its injected fallback callback. A runnable connector still needs an explicit
   broker-hosted-vs-scoped-lease secret boundary, durable tenant binding and
   repository integration, authenticated PBX call-control execution, and real
   PBX acceptance.
5. **RLS behavioral coverage:** the test now includes rollback-only row
   fixtures for all 21 tenant tables and checks that company A can read its
   representative row while company B cannot; a local test confirms fixture
   coverage, and catalog assertions inspect each policy's `USING` and
   `WITH CHECK` tenant predicates. The live database test remains unexecuted:
   the current `NEON_BRANCH` is `production`, and must not be used for this
   test. Run the transaction-rollback test on the isolated migrated branch
   under the dedicated non-bypass role after migrations `016`–`022` before sign-off.

### Production and external acceptance gates

- Production Neon remains unmigrated until AWS KMS/workload identity, the
  `NOSUPERUSER NOBYPASSRLS` application role, Neon Auth/trusted origins,
  production secrets, and explicit migration approval are ready.
- Reconnect existing Google accounts after migration `008` removes plaintext
  token columns; verify the connected account email and Calendar operations.
- Obtain a non-production 3CX v20 PBX and complete the documented call/media
  acceptance tests before enabling any 3CX traffic.
- Session IDs supplied for a LiveKit session are signed only after the Next.js
  BFF independently verifies the Neon Auth cookie. Continue ensuring that
  client-selected session IDs cannot be used to claim or read another user's
  persisted session.

## Required policy precedence

```text
Immutable platform security kernel
        ↓
Provider and integration restrictions
        ↓
Published company capability grants
        ↓
Company instructions and structured business information
        ↓
Signed session configuration snapshot
        ↓
Caller speech, Calendar data, and tool results
```

## Required systems structures

- Company and membership model.
- Capability registry.
- Server-side policy compiler.
- Draft, validate, test, publish, supersede, and rollback lifecycle.
- Immutable session configuration snapshots.
- Integration broker for Google and 3CX credential decryption.
- Integration state machines.
- Security audit stream with redacted records.
- Explicit data classification and retention rules.
- Tenant-scoped call/session state machine.

## QA acceptance tests

- User A cannot access Company B by changing IDs, rooms, sessions, integrations, events, or tool arguments.
- Onboarding can enable approved capabilities but cannot add arbitrary tools or remove confirmations.
- Prompt injections in company fields, greetings, Calendar content, caller speech, and tool results remain inert.
- Published profiles are versioned and active sessions retain their original snapshot.
- Credentials never appear in browser state, responses, logs, traces, errors, database plaintext, or model context.
- Malformed 3CX credential requests do not echo submitted secrets in validation responses; production database diagnostics reveal no role/version details.
- Two companies receive separate LiveKit rooms, agents, Google accounts, and 3CX connections.
- Repeated LiveKit and 3CX events create one session and one agent.
- Unsupported capabilities fail closed.
- The shared default UUID and dummy data are removed.
