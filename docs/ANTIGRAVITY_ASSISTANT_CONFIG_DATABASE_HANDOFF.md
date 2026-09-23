# Antigravity Handoff — Assistant Configuration Database Verification

**Purpose:** Complete the database-only verification that could not be performed in this workspace. The application-side implementation is present locally, but it must not be considered database-verified or production-ready until this handoff is complete.

## Current status

- The local Neon CLI is installed (`4.21.0`), but reading its credentials fails with `EPERM` for the user-level Neon credentials file. The linked Neon project/branch and connection role therefore cannot be verified here.
- Do not work around this by printing, copying, or exposing Neon credentials. Have the project owner restore the intended Neon CLI/MCP access through the approved account mechanism.
- The repository is linked in `.neon` to `codex-roadmap-migration-test`, but that link alone does not prove the branch exists, is safe, has current migrations, or uses a restricted role.
- No database writes, branch creation, or migration execution were performed by this task.
- The candidate SQL fix explicitly casts lifecycle parameter `$3` to `text` in `db/agent_profiles.py`. The exact production failing statement has not been reproduced, so this is not yet a proven root-cause fix.

## Safety prerequisites

1. Obtain authorized Neon access and verify the exact project and branch. Never assume the linked branch is non-production based only on its name.
2. Use a dedicated development/test branch. Do not run reproduction, migrations, or tests against production.
3. If choosing a branch from production would copy customer/company data, ask the project owner whether realistic data is necessary. Prefer schema-only or synthetic-data setup when sensitive rows are unnecessary; otherwise use an explicitly approved isolated normal branch. Do not make this data-sensitivity decision silently.
4. Keep the current `.env` and connection strings unchanged unless the owner explicitly asks to update a particular environment key. Use a dedicated test process environment for the test DSN.
5. Verify migrations that define `assistant_configs`, `agent_profile_versions`, their unique published-profile index, and forced tenant RLS are applied.
6. Verify the test runtime role is `NOSUPERUSER` and `NOBYPASSRLS`. Do not use an admin/superuser role to claim tenant-isolation tests pass.

## Required verification workflow

### A. Capture a safe baseline

- Record project/branch identifiers, migration versions, PostgreSQL version, asyncpg version, role name, `is_superuser`, and `rolbypassrls` in the test report. Do not include DSNs, passwords, access tokens, or company configuration values.
- Confirm the branch is isolated and that test data is synthetic.
- Check whether the application’s expected schema columns and constraints exist.

### B. Identify the actual failing SQL

- Reproduce the POST persistence sequence using the same asyncpg configuration as the application (including `statement_cache_size=0`) against the isolated branch.
- In a transaction that is always rolled back, execute the current version insert for both `draft` and `published` states, then the legacy upsert, then the surrounding sequence as necessary.
- Record only statement labels, exception class, SQLSTATE, and safe constraint metadata. Do not log raw profile/policy JSON, prompt text, SQL parameters, secrets, or complete driver exception text.
- Determine whether the cast in `db/agent_profiles.py` fixes the reproduced statement. If not, identify and correct the actual failing statement instead. Do not report the suspected version insert as root cause unless the reproduction proves it.
- Add/retain a PostgreSQL regression that fails before the correction and passes afterward.

### C. Verify the transaction and lifecycle on PostgreSQL

Use synthetic tenant IDs and ensure cleanup/rollback regardless of outcome.

- Successful draft save: both `assistant_configs` and `agent_profile_versions` reflect the intended save; the currently published row remains unchanged.
- Successful publish: legacy compatibility row and new profile agree; the previous published version becomes superseded and exactly one profile remains published.
- Forced failure after the legacy upsert: verify the transaction leaves neither a new legacy-row change nor a new profile version. Also verify a failed publish does not leave the prior version superseded.
- Confirm that the database operation uses one connection and one transaction, with `app.company_id` set transaction-locally on that connection.
- Run concurrent saves for one tenant and confirm distinct sequential versions; run separate-tenant saves and confirm no cross-tenant visibility or mutation.
- Verify same-session/API retries do not silently create duplicate versions if a client retry path exists. Current implementation does not add a new idempotency schema; report whether observed retry behavior makes that necessary before recommending a migration.

### D. Verify forced RLS with the restricted role

- Run tenant A and tenant B reads/writes through the actual restricted runtime role with transaction-local company context.
- Confirm tenant A cannot read, update, or delete tenant B’s `assistant_configs` or `agent_profile_versions` rows.
- Ensure the checks fail closed if tenant context is absent.
- Do not treat tests skipped due to `BYPASSRLS` as passing.

### E. Run the tests and report

Run the focused local tests after database access is restored:

```powershell
.\.venv\Scripts\python.exe -m pytest -q `
  backend/tests/test_assistant_publish.py `
  backend/tests/test_agent_profile_versioning.py `
  backend/tests/test_assistant_configuration_transaction.py `
  backend/tests/test_rls_isolation.py
```

The three non-database focused tests currently pass locally. `test_rls_isolation.py` uses the live database fixture, so point it only to the verified isolated branch and confirm the fixture cannot fall back to production.

Report:

- verified project/branch identity (no credentials);
- migration state and role privilege checks;
- exact failing SQL label and SQLSTATE before the fix;
- whether the candidate cast resolves the reproduced failure, or what actual change was needed;
- draft/publish/rollback/concurrency/RLS test outcomes;
- whether any migration was required (expected: none for the current transaction/cast change);
- any remaining issue and its safe next action.

## Release gate

Do not claim the save failure is resolved for production until the isolated PostgreSQL reproduction passes, forced-RLS tests pass under the restricted role, and real transaction rollback/lifecycle checks pass. Do not deploy or mutate production as part of this handoff without separate explicit authorization.
