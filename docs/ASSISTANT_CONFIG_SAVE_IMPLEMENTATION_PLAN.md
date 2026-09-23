# Assistant Configuration Save Failure — Implementation Plan

**Status:** Planning only. No application code, database, or deployment changes were made for this plan.

## Objective

Make saving assistant configuration reliable and tenant-safe, establish exactly which database statement causes the observed PostgreSQL `AmbiguousParameterError`, and ensure a failed save cannot leave the legacy settings row and versioned agent profile disagreeing.

This plan is based on a systems-design review and an independent senior-developer review. Both reviewers agree the versioned-profile insert is a plausible source of the parameter-inference failure, but the failing SQL statement has not yet been proven.

## Evidence and current understanding

### Confirmed from the application and available incident evidence

- Production logs around 2026-09-23 show `GET /assistant-config` returning 200 while repeated `POST /assistant-config` requests return 500 with `AmbiguousParameterError`.
- The user-facing “Assistant configuration service is unavailable” is a generic error response. It hides the precise database failure and does not prove that no write occurred.
- The POST handler validates the signed tenant context and compiles the policy, then calls `save_assistant_config(...)` and `save_agent_profile_version(...)` sequentially.
- Those persistence helpers currently use separate database transactions/connections. The legacy settings upsert can therefore commit even if version creation fails.
- The versioned-profile insert reuses `$3` as lifecycle state and in a `CASE` expression. It is a reasonable first query to test for ambiguous parameter inference, not a confirmed root cause.
- Existing profile-version and route tests mock database behavior. They do not run the disputed statement on PostgreSQL or prove transaction atomicity.
- Tenant context is established through the authenticated session and transaction-local `app.company_id`; migrations define forced tenant RLS. The actual deployed migration state and runtime database role still need verification.

### Unverified / prerequisites

- The exact failing SQL statement and SQLSTATE are not established.
- The linked Neon project could not be accessed during the review. The database branch, applied migrations, and production runtime role have not been verified.
- Do not reproduce against production. Restore Neon project access or provide a dedicated isolated development/test branch before database integration work begins.

## Target behavior and design invariants

1. **Tenant authority comes from authentication.** The company/tenant identifier is derived from the verified session context, never trusted from an arbitrary client-supplied company ID.
2. **A save is one atomic unit.** The legacy `assistant_configs` representation and the versioned profile changes commit together on one acquired connection and transaction. If any write fails, neither representation changes.
3. **RLS applies to every write.** Set tenant context transaction-locally on the same connection that performs all persistence operations. Tests must use the intended non-superuser, non-`BYPASSRLS` runtime role.
4. **Version allocation remains serialized per company.** Preserve the existing company-scoped advisory transaction lock and uniqueness constraints.
5. **Drafts do not change runtime behavior.** Draft saves may update the editor-visible draft, but must not supersede or alter the active published profile. Publishing advances the active profile atomically.
6. **Published history remains auditable.** Do not rewrite prior versions to simulate rollback; rollback should publish a new version based on a prior configuration.
7. **Failure is observable without exposing data.** Record a request/correlation ID, persistence stage or query label, exception class, and safe SQLSTATE/constraint metadata. Never log raw prompts, configuration payloads, credentials, or SQL parameter values. Keep the public response contract stable and do not return SQL details.
8. **Retry behavior is explicit.** Confirm whether the existing API/client can retry a save. If retries can create duplicate versions, define a company-scoped idempotency key and payload-hash behavior. Inspect existing idempotency storage before adding a table; do not reuse a tool-call idempotency mechanism unless its semantics and retention are suitable.

Before implementation, document which representation is authoritative for editor reads, runtime reads, and compatibility. Current behavior appears to combine legacy settings with the latest profile for configuration reads, while runtime behavior depends on the published profile. Preserve intended compatibility, but make the relationship explicit and test it.

## Ordered implementation workflow

### 1. Establish an isolated PostgreSQL test target

- Restore Neon access and identify the intended development/test project and branch. If none exists, create a dedicated branch from the appropriate safe baseline after confirming whether production data may be inherited; prefer synthetic data or a schema-only branch when data sensitivity is unclear.
- Verify the branch is not production, record its branch identity, and confirm the required migrations are applied.
- Verify the test runtime role is not a superuser and has no `BYPASSRLS` privilege.
- Keep local environment files and production connection strings untouched. Never point the test fixture at production.

**Gate:** no database reproduction until the isolated target and role have been verified.

### 2. Reproduce and identify the exact failure

- Use the same asyncpg/PostgreSQL versions and connection configuration as the API.
- Execute the suspected versioned-profile insert for both `draft` and `published` states inside a transaction that is rolled back.
- If it succeeds, isolate the legacy upsert and surrounding statements one at a time until the exact failing statement is identified.
- Capture the statement label, exception class, and SQLSTATE in test output. Use synthetic tenant/configuration values; do not emit the configuration payload.
- Add a focused regression that fails against the current behavior before applying the SQL change.

**Gate:** do not label a query or parameter as the root cause until this reproduction proves it.

### 3. Define persistence/read semantics

- Confirm the canonical profile lifecycle and the compatibility role of `assistant_configs`.
- Specify how draft save, publish, reload, and runtime profile selection interact.
- Preserve the API response schema, current lifecycle meanings, per-company version numbering, and published-profile uniqueness.

### 4. Apply the smallest evidence-based SQL correction

- If the profile insert is confirmed, explicitly type the ambiguous parameter or compute the publication timestamp in application code—whichever the reproducer shows is correct and clearest.
- Do not add a schema migration unless the reproduced issue requires one.
- Keep draft/published timestamp semantics and database constraints intact.

### 5. Make the save transactional

- Introduce a repository operation that acquires one connection and opens one transaction for the legacy upsert, version allocation, superseding the prior published version when applicable, and new profile insertion.
- Establish transaction-local tenant context on that exact connection.
- Retain advisory locking around version allocation.
- Refactor lower-level helpers so they can accept the caller’s connection/transaction rather than opening nested independent transactions.
- Keep company provisioning (`ensure_company`) separate unless a demonstrated invariant requires including it in the same transaction.

### 6. Specify and enforce retry safety

- Check current client retry behavior and persistence schema first.
- If retries may produce extra versions, implement an idempotency key scoped to the authenticated company, with a payload hash: same key and same payload returns the original save result; same key with different payload is rejected.
- Persist the idempotency result atomically with the save. Add a migration only if existing storage cannot safely support this contract.

### 7. Improve safe failure handling

- Keep the user-facing error generic and response-compatible.
- Add stage-specific structured logs and correlation IDs; sanitize error metadata and ensure no SQL parameter values/configuration text are logged.
- Ensure clients cannot present a failed request as a successful save; verify current UI error states and reload behavior.

### 8. Validate and release gradually

- Run unit, route, PostgreSQL integration, and tenant-isolation tests before a non-production deployment.
- Deploy to a non-production environment using the isolated database branch. Smoke-test save, reload, publish, runtime selection, and failure rollback.
- Verify production migration and runtime-role state before production release. Coordinate the API rollout and monitor save failure counts by safe exception metadata.
- If behavior regresses, redeploy the previous API revision. Inspect any historical partial legacy/profile writes separately; do not silently rewrite or auto-reconcile user data.

## Required test matrix

- **Real PostgreSQL query regression:** exact failing statement tested for draft and published states using the deployed asyncpg configuration.
- **Atomicity:** force profile insertion to fail after the legacy write has begun; assert neither representation changed. Also test failures at other transaction stages as relevant.
- **Successful draft:** both representations reflect the saved draft; the active published profile remains unchanged.
- **Successful publish:** both representations agree and exactly one profile remains published.
- **Read/runtime semantics:** configuration reload returns the intended draft/latest view; runtime continues to select only a published profile.
- **Concurrency:** concurrent saves for one company allocate distinct sequential versions; distinct companies remain isolated.
- **Tenant isolation:** with forced RLS and the real restricted runtime role, tenant A cannot read or mutate tenant B’s settings, profiles, or idempotency records.
- **Retry semantics:** repeated identical operation key and payload does not create a duplicate version; key reuse with a different payload fails safely.
- **API/UI errors:** validation remains a 422; persistence failures stay generic, do not leak details, and are visibly not reported as saved.
- **Safe observability:** expected stage/correlation metadata appears while prompts, profile content, credentials, and SQL parameter values do not.

Mock-based unit tests remain useful for request mapping and error translation, but they are not substitutes for PostgreSQL integration tests for the observed parameter-inference error, RLS, transaction rollback, or concurrency behavior.

## Acceptance criteria

- The exact failing SQL is proven by a reproducible PostgreSQL test and its correction is covered by regression tests.
- A successful save updates the intended compatibility and versioned representations in one transaction.
- A failure leaves both representations unchanged.
- Drafts cannot affect runtime behavior; publish and rollback preserve a single active version and audit history.
- Retries cannot silently create duplicate versions if retry paths exist.
- Forced tenant RLS is exercised using the intended restricted runtime role, with cross-tenant tests passing.
- User-facing contracts remain stable; logs contain no configuration or secret content.
- Non-production smoke tests pass before any production release.

## Reviewer notes

- **Systems design review (Carver):** emphasized source-of-truth/read semantics, atomic transaction boundaries, tenant RLS on the same connection, draft/published lifecycle invariants, idempotent retries, and verified runtime-role checks.
- **Senior developer review (Wegener):** emphasized proving the exact SQL statement first, making the smallest parameter-typing fix, moving both writes into one transaction, preserving advisory locking, and adding real PostgreSQL rollback/RLS/concurrency tests.
- **Reconciled recommendation:** follow the shared order—isolated reproduction first, then evidence-based query correction and atomic persistence. Treat idempotency as a required design decision and implement it if save retries can create duplicate versions; inspect existing storage before adding schema.

## Scope boundary

This is an implementation plan, not authorization to change code, Neon, Railway, production data, or deployment configuration. Begin implementation only when the user selects this numbered item and the isolated database prerequisite is available.
