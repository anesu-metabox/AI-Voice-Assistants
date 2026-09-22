# Implementation Roadmap

This roadmap consolidates the plans in this directory into executable phases. Every phase has a completion gate; the project is not considered complete until all gates pass.

## Current execution status — 22 September 2026

The roadmap is **in progress**, not rollout-ready. Phases 1 and most code work
in Phases 2–5 have implementation and local test evidence, but their live
tenant, OAuth, RLS, and browser acceptance gates are still open. Phase 6 now
has local SDK-event, PCM resampling, bidirectional LiveKit media-bridge,
lease-renewal, and fake-PBX lifecycle foundations, but those adapters are not
connected to broker credentials, durable Neon/LiveKit dispatch, or a real PBX.
An injected single-tenant runtime composition boundary now wires the PBX
client, verified tenant binding, event adapter, controller, and media factory;
it still requires a deployment entrypoint and concrete trusted service adapters.
The call controller now requires the tenant's persisted 3CX disconnect/transfer
choice and passes only a validated allowlisted target to its fallback adapter;
the adapter is still not composed with broker-issued settings or a live PBX.
Phases 7–8 and production deployment remain incomplete. See
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)
for the detailed evidence and [PRODUCTION_ROLLOUT_CHECKLIST.md](PRODUCTION_ROLLOUT_CHECKLIST.md)
for operator-owned prerequisites.

The current checkout is on `codex/livekit-reliability`, with the rollback
branch `codex/pre-elihu-merge-233f3ee` present locally. The workspace
`.env` selects `NEON_BRANCH=production`; local startup now refuses that
branch. The Neon MCP connection currently lists a different Neon project and
the local CLI cannot read its credential profile, so no external branch
assumptions or writes are being made from this session.

## Phase 0 — Baseline, branch, and safety

Reference: [QA-review.md](QA-review.md), [MULTITENANT_PLATFORM_PLAN.md](MULTITENANT_PLATFORM_PLAN.md)

Tasks:

- Create a new implementation branch and preserve the current rollback branch.
- Capture the current frontend, backend, agent, database, and environment baseline.
- Create a Neon restore point/branch before schema work.
- Inventory and remove known dummy data, default UUIDs, mock stores, and fallback records.
- Define redaction rules for logs, traces, errors, analytics, and session replay.

Completion gate:

- Rollback point is documented.
- Baseline tests/build commands are recorded.
- No implementation path depends on the shared default user.

## Phase 1 — Next.js foundation

Reference: [NEXTJS_MIGRATION_PLAN.md](NEXTJS_MIGRATION_PLAN.md)

Tasks:

- Complete the Vite-to-Next.js App Router migration.
- Make the dashboard the active `/` surface.
- Preserve dormant voice components and compatibility handlers.
- Restore Next API proxies and Google OAuth rewrites.
- Keep server-only backend configuration behind `BACKEND_URL`.

Completion gate:

- `npm --prefix frontend run typecheck` passes.
- `npm --prefix frontend run test` passes.
- `npm --prefix frontend run build` passes.
- Dashboard, onboarding, settings, sandbox, and existing API paths render correctly.

## Phase 2 — Neon Auth and tenant data model

Reference: [NEON_AUTH_AND_DATA_MODEL_PLAN.md](NEON_AUTH_AND_DATA_MODEL_PLAN.md)

Tasks:

- Enable Neon Auth with email/password and Google application sign-in.
- Add companies and company memberships with one owner enforced in v1.
- Add company profiles, user preferences, agent profile versions, and tenant-bound voice sessions.
- Add ownership constraints, RLS, repository-level ownership checks, and separate runtime/migration roles.
- Replace every hard-coded or caller-supplied identity with verified session identity.
- Add short-lived internal service credentials for Next.js, FastAPI, LiveKit, and integration services.

Completion gate:

- Unauthenticated requests receive `401`.
- Cross-company reads and writes receive `403` or an empty authorized result.
- Modified IDs, rooms, sessions, and request bodies cannot cross tenants.
- Two test users can complete onboarding independently.

## Phase 3 — Real onboarding and agent configuration

Reference: [AGENT_POLICY_CUSTOMIZATION_PLAN.md](AGENT_POLICY_CUSTOMIZATION_PLAN.md)

Tasks:

- Replace all placeholder onboarding fields with controlled, persisted forms.
- Add structured company facts, timezone, hours, FAQs, qualification questions, greeting, tone, and escalation rules.
- Include and persist `Indian/Mauritius` as an IANA timezone.
- Add the capability registry for receptionist, company FAQ, lead qualification, Google Calendar, and 3CX transfer.
- Replace raw prompt authority with the server-side policy compiler.
- Implement draft, validate, test, publish, active, supersede, and rollback states.
- Sign and snapshot the published configuration for every new voice session.

Completion gate:

- Onboarding can change company behavior and enabled approved capabilities.
- Onboarding cannot add arbitrary tools, remove confirmations, expose secrets, or weaken tenant security.
- Active sessions remain on their original profile version after a publish.
- Prompt-injection tests against company fields and instructions pass.

## Phase 4 — Google Calendar security and integration

Reference: [GOOGLE_CALENDAR_SECURITY_PLAN.md](GOOGLE_CALENDAR_SECURITY_PLAN.md)

Tasks:

- Implement session-bound OAuth with PKCE, one-time state, secure cookies, and exact callback validation.
- Add one Google Calendar integration per company.
- Encrypt credentials with managed-KMS envelope encryption through the integration broker.
- Show connected Google account email, scopes, connection time, and reconnect state.
- Remove plaintext OAuth storage, arbitrary `user_id` query parameters, and local Calendar fallbacks.
- Expose only availability, list, book, and confirmed cancellation.

Completion gate:

- OAuth replay, tampering, cross-session, and callback-error tests fail closed.
- Tokens never appear in frontend state, API responses, logs, or model context.
- Calendar operations use only the authenticated company’s Google account.
- Two companies cannot see or modify each other’s events.

## Phase 5 — LiveKit reliability and session isolation

Reference: [LIVEKIT_RELIABILITY_PLAN.md](LIVEKIT_RELIABILITY_PLAN.md)

Tasks:

- Use client-generated session IDs and unique tenant-bound rooms.
- Make token and dispatch creation idempotent.
- Add frontend single-flight connection protection.
- Remove failed-connection fallback states and synthetic greetings.
- Clean all tracks, listeners, timers, subscriptions, and audio contexts.
- Use structured data-channel transcripts as the only UI transcript source.
- Prewarm worker dependencies, close clients reliably, and monitor event-loop stalls.
- Bind rooms and jobs to company, user, profile version, and session.

Completion gate:

- Rapid connect creates one request, one room, and one agent.
- Failed token/room connections remain visibly failed.
- Reconnect, stop, and autoplay retry work without leaks.
- Native transcription events do not duplicate UI messages or generate warnings.
- Event-loop blocking over 100 ms fails active-conversation tests.

## Phase 6 — Secure per-company 3CX integration

Reference: [3CX_SECURE_INTEGRATION_PLAN.md](3CX_SECURE_INTEGRATION_PLAN.md),
[3CX_API_SPIKE.md](3CX_API_SPIKE.md),
[3CX_ADAPTER_IMPLEMENTATION_SPEC.md](3CX_ADAPTER_IMPLEMENTATION_SPEC.md)

Tasks:

- Complete a non-production 3CX v20 media and Call Control spike.
- Add the authenticated 3CX setup interface.
- Collect and persist the Service Principal client ID separately from the
  Programmable Extension / Route Point DN; keep the client secret write-only.
- Make API-key entry write-only and require recent reauthentication for changes.
- Validate PBX URLs against HTTPS, TLS, SSRF, DNS rebinding, redirect, port, and timeout rules.
- Store credentials using per-integration managed-KMS envelope encryption.
- Add connection test, health states, rotation, disconnect, and redacted audit events.
- Implement one controlled 3CX → adapter/SIP ingress → LiveKit → Gemini path.
- Add DID mapping, atomic call claiming, duplicate-call prevention, transfer, hang-up, reconnect, and cleanup.
- Require each company to choose an explicit bridge-failure action; transfer targets must be selected from that company's allowlist.

Completion gate:

- Credentials never return to the browser and never appear in logs or diagnostics.
- KMS permissions prevent ordinary services from decrypting credentials.
- Private-address, metadata-service, DNS-rebinding, redirect, and invalid-TLS tests pass.
- Two company PBXs produce separate calls, rooms, agents, profiles, and integrations.
- A 3CX call cannot start both a direct assistant and a LiveKit assistant.

## Phase 7 — Remove legacy/demo surfaces

Tasks:

- Remove Acme, Marcus, Ava, fake calls, fake metrics, fake phone numbers, fake transcripts, and mock task data.
- Apply migration `020_clear_legacy_demo_profile_values.sql` on an isolated migrated branch to clear only the exact historical Acme/Ava/Charlie/sample-returns profile defaults; audit remaining tenant data before broader cleanup.
- Retire local Calendar event storage and legacy assistant configuration tables after migration validation.
- Remove fallback success responses and default-user behavior.
- Hide or label unfinished capabilities instead of presenting simulated production data.

Completion gate:

- A new account starts with empty real state.
- No production code path references the shared default UUID.
- All displayed records originate from authenticated tenant data or a connected provider.

## Phase 8 — Full verification and rollout

Tasks:

- Run frontend typecheck, tests, lint, and production build.
- Run backend unit, integration, RLS, OAuth, policy, KMS, SSRF, and tenant-isolation tests.
- Run agent tool and prompt-injection tests.
- Run LiveKit browser tests with interruptions, reconnects, autoplay restrictions, and two tabs.
- Run Google Calendar tests for listing, availability, booking, cancellation, reconnect, and account replacement.
- Run 3CX tests with duplicate events, reconnects, transfers, failures, and two companies.
- Verify logs contain decisions and correlation IDs but no raw transcripts or secrets.
- Restart frontend, backend, LiveKit worker, and connectors using production-like configuration.
- Perform manual browser and voice acceptance checks.

Completion gate:

- All phase gates pass.
- Security review signs off on tenant isolation and credential handling.
- Rollback procedure is tested.
- Only then merge the implementation branch.

## Cross-phase ownership

- Systems/security collaborator: Phases 0, 2, 3, 4, 6, and 8.
- Frontend collaborator: Phases 1, 3, 4, 5, and 8.
- Backend/data collaborator: Phases 0, 2, 4, 6, and 7.
- LiveKit/agent collaborator: Phases 3, 5, 6, and 8.
- QA collaborator: every phase gate, with primary ownership of Phase 8.
