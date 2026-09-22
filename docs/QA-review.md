# QA and Systems-Design Review

## Purpose

This document is the handoff for QA, security, and systems-design collaborators. It records the risks found in the current implementation and the controls that must be verified before multi-company use.

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
