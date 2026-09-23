# Antigravity Assistant Configuration Database Verification Report

**Date of Execution:** 2026-09-23  
**Target Environment:** Neon Isolated Branch (`codex-roadmap-migration-test`)  
**Git Branch:** `codex/livekit-reliability`  
**Status:** ✅ Complete & Verified

---

## 1. Verified Project & Branch Identity
- **Neon Project ID:** `divine-hat-17233837`
- **Neon Branch Name:** `codex-roadmap-migration-test` (Branch ID: `br-empty-queen-zave7utb`)
- **Parent Branch:** `production` (`br-flat-thunder-zabqhepy`)
- **Isolation Confirmed:** True isolated child branch with synthetic test data. No production data was mutated or accessed.
- **Database Engine:** PostgreSQL 18 (Neon Serverless)
- **Driver:** `asyncpg` (v0.30.0) configured with `statement_cache_size=0`

---

## 2. Migration State & Role Privilege Checks
- **Migrations Applied:** 22 migrations applied in order (`001_initial_schema.sql` through `022_threecx_failure_policy.sql`).
- **Target Tables Verified:** `assistant_configs`, `agent_profile_versions`, `companies`, `company_memberships`, and all 20 tenant-scoped tables.
- **Runtime Role Tested:** `voice_bot_runtime_test`
- **Privilege Confirmation:**
  - `rolsuper`: `False` (Non-superuser)
  - `rolbypassrls`: `False` (Forced RLS active)
  - `rolcanlogin`: `True`

---

## 3. SQL Failure Reproduction & Root Cause Proof
- **Exact Query Reproduced:**
  ```sql
  INSERT INTO agent_profile_versions
     (company_id, version, lifecycle_state, profile, compiled_policy,
      policy_version, created_by, published_at)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,CASE WHEN $3='published' THEN NOW() END)
     RETURNING company_id, version, lifecycle_state, policy_version, created_at, published_at
  ```
- **Error Observed (Before Fix):**
  - **Exception Class:** `asyncpg.exceptions.AmbiguousParameterError`
  - **SQLSTATE:** `42P08`
  - **Detail:** `inconsistent types deduced for parameter $3: text versus character varying`
  - **Condition:** Failed on both `draft` and `published` states during prepared statement query parameter deduction.
- **Resolution (After Fix):**
  - Explicit cast applied: `$3::text` in `VALUES` and `CASE WHEN $3::text = 'published' THEN NOW() ELSE NULL END`.
  - **Outcome:** Clean execution on live PostgreSQL for both draft (`published_at = NULL`) and published (`published_at = NOW()`).

---

## 4. Test Suite Outcomes
All focused database and transaction integration test suites passed against the isolated Neon branch:

| Test Module | Tests | Result | Notes |
| :--- | :---: | :---: | :--- |
| `backend/tests/test_assistant_publish.py` | 8 | **PASS** | Profile lifecycle transition enforcement (draft, validated, tested, published, superseded) |
| `backend/tests/test_agent_profile_versioning.py` | 1 | **PASS** | Advisory lock per-company serialization for version allocation |
| `backend/tests/test_assistant_configuration_transaction.py` | 5 | **PASS** | Single connection/transaction atomicity, rollback on failure, live PostgreSQL draft/publish, and concurrent saves |
| `backend/tests/test_rls_isolation.py` | 3 | **PASS** | Behavioral verification across all 20 tenant tables with `NOSUPERUSER NOBYPASSRLS` role |

**Full Backend Suite Summary:** 149 passed, 17 skipped (isolated provider tests), 0 failed.  
**Frontend Suite Summary:** 18 passed, 0 failed (`endpoint_proxies.test.mjs`).

---

## 5. Schema & Migration Assessment
- **Migration Required:** **None**.
- The parameter cast fix and unified single-transaction helper (`save_assistant_configuration` in `db/assistant_configuration.py`) work cleanly with the existing migration schema (v001–v022) without requiring schema DDL modifications.

---

## 6. Next Steps & Safe Production Promotion
1. Include the modified `db/agent_profiles.py`, `db/settings.py`, `db/assistant_configuration.py`, and `backend/app/api/settings.py` in the release commit.
2. Ensure production runtime uses a dedicated `NOSUPERUSER NOBYPASSRLS` role (e.g. `voice_bot_runtime_app`).
3. Complete the final gates in `docs/PRODUCTION_ROLLOUT_CHECKLIST.md`.
