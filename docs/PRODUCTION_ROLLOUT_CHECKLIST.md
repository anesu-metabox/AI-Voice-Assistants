# Production Rollout Checklist

This checklist is the final deployment gate for the roadmap. Local and isolated
Neon verification do not substitute for these production checks.

## 1. Freeze and recoverability

- [ ] Confirm the deployment commit and rollback branch:
  `codex/pre-elihu-merge-233f3ee`.
- [ ] Create a Neon restore point/branch from the production branch immediately
  before migration.
- [ ] Export only schema/row-count inventory; never export OAuth plaintext or
  credential values into logs or artifacts.
- [ ] Verify `scripts/inspect_schema.py` reports the expected pre-migration
  production state.

## 2. Secrets and service identity

- [ ] Configure an AWS symmetric KMS key and workload identity, then set
  `CREDENTIAL_KEY_PROVIDER=aws-kms`, `CREDENTIAL_KMS_KEY_ID`, and
  `AWS_REGION` **on the credential-broker workload only**; production must fail
  closed otherwise. Only the broker's distinct IAM role may call
  `kms:GenerateDataKey` and `kms:Decrypt`, constrained by the documented
  non-sensitive encryption-context keys. The general FastAPI role must have no
  KMS permission and must receive only the broker URL/HMAC secret. Use the
  reviewed [CloudFormation template and setup guide](AWS_KMS_SETUP.md); do not
  provision static AWS access keys for the application.
- [ ] Keep Neon credentials separate too: provision a dedicated
  `NOSUPERUSER NOBYPASSRLS` database login for normal API/broker traffic; keep
  the privileged migration/owner login out of service environments. Run the
  provisioning script with an explicit `DATABASE_URL_UNPOOLED` and
  `NEON_BRANCH` using an administrative connection only after testing on the
  isolated branch. It refuses pooler endpoints and production/main/primary
  unless the operator explicitly passes `--allow-production`.
- [ ] Verify the service `DATABASE_URL` username matches `RUNTIME_DB_ROLE`;
  the production preflight enforces this and rejects `DATABASE_URL_UNPOOLED`
  or `RUNTIME_DB_PASSWORD` in service configuration. Never run application
  traffic as `neondb_owner` or another role with `rolbypassrls=true`.
- [ ] Configure the same high-entropy
  `LIVEKIT_SESSION_CONTEXT_SECRET` in Next.js, FastAPI, and the LiveKit worker.
- [ ] Configure `GOOGLE_OAUTH_STATE_SECRET`, Neon Auth server settings, and
  trusted production origins.
- [ ] Rotate/revoke credentials previously exposed in local development files
  and in the link-public Notion Resources / Environment page. Remove secret
  values from that page and restrict sharing; rotate the Neon API/database,
  LiveKit, and Google API credentials recorded there before any production use.
- [ ] Confirm logs, traces, analytics, and error reporting redact OAuth tokens,
  3CX secrets, bearer tokens, transcript text, and request bodies.
- [ ] Run `powershell -File scripts/check-config.ps1 -Production`; resolve every
  reported key before deploying any service.
- [ ] Run `powershell -File scripts/check-config.ps1 -Production -CredentialBroker`
  against the broker's isolated deployment environment and verify that the
  Google OAuth client secret and KMS configuration are absent from the general
  API environment.

## 3. Database migration sequence

1. Apply migrations `006` through `007` and verify table/index creation.
2. Apply `008` only after confirming all existing Google accounts can reconnect;
   it removes legacy plaintext OAuth columns.
3. Apply `009` through `022` in order. Migration `015` brings OAuth PKCE
   state and audit events under RLS; `016` adds forced-RLS 3CX call claims
   and event deduplication, `017` adds broker nonce replay protection, and
   `018` adds tenant-scoped distributed rate limits for 3CX setup probes and
   credential saves; `019` indexes recent call-history reads; `020` clears
   only exact historical demo defaults; `021` adds the separate 3CX Service
   Principal client ID; `022` requires a tenant-approved 3CX failure action
   and degrades active integrations until they are reconfigured.
4. Run the schema inventory and verify all roadmap tables, encrypted OAuth
   columns, profile-version binding, and RLS policies exist.
5. Provision the non-bypass-RLS runtime role. Then verify unauthenticated
   requests return `401` and cross-company access is denied with two controlled
   test accounts.
6. Reconnect every existing Google account and verify the connected account
   email and calendar actions.

The migration runner intentionally refuses production unless the operator
passes `--allow-production`. That flag requires explicit deployment approval.
It also requires an explicit `NEON_BRANCH` and rejects pooled Neon endpoints,
so an unidentified or transaction-pooled target cannot be migrated accidentally.

## 4. Application rollout

- [ ] Deploy backend, Next.js, LiveKit worker, and connector processes from the
  same commit.
- [ ] Confirm the browser-direct Gemini path remains disabled.
- [ ] Confirm only the four calendar tools are exposed to the voice agent.
- [ ] Verify onboarding creates a tenant-bound draft and publish creates an
  immutable profile version.
- [ ] Verify a new LiveKit session records the published profile version and
  cannot be changed by a later publish.
- [ ] Verify duplicate token requests reuse one room/dispatch.

## 5. 3CX gate

- [ ] Obtain a non-production 3CX v20 Update 10+ PBX with Call Control access,
  Service Principal, route point, API key, DID, and minimal permissions.
- [ ] Validate `/connect/token`, Bearer `/callcontrol`, Call Control WebSocket,
  participant audio stream, transfer, voicemail, hang-up, and reconnect.
- [ ] Prove one inbound call creates one claim, one room, and one Gemini agent.
- [ ] Prove duplicate events, reconnects, two DIDs, and two companies remain
  isolated.
- [ ] Do not enable production 3CX traffic until the acceptance gates in
  `3CX_API_SPIKE.md` pass.

## 6. Final evidence

- [ ] Frontend typecheck, tests, lint, and build pass.
- [ ] Backend tests pass against the migrated isolated schema and production
  smoke tests pass after migration.
- [ ] Agent policy, signed context, tool allowlist, OAuth, RLS, KMS, SSRF, and
  tenant-isolation tests pass.
- [ ] Browser voice acceptance passes for greeting, calendar actions, rejected
  off-topic requests, autoplay retry, reconnect, and stop/cleanup.
- [ ] LiveKit logs show no duplicate agent and no active-conversation event-loop
  stall over 100 ms.
- [ ] Rollback is rehearsed against the restore point before enabling traffic.
