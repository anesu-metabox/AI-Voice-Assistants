# Neon Auth and Data Model Plan

## Authentication

- Enable Neon Auth in `neon.ts`.
- Support email/password and Google application sign-in.
- Keep Google application sign-in separate from Google Calendar authorization.
- Protect dashboard, onboarding, integrations, sandbox, LiveKit, and tools.
- Keep only landing and authentication pages public.
- Use secure HttpOnly cookies and recent-authentication checks for sensitive integration changes.

## Tenant model

Use a company boundary even though v1 has one owner:

```text
neon_auth.user
        ↓
company_memberships
        ↓
companies
        ↓
profiles, preferences, integrations, sessions
```

V1 constraints:

- One owner membership per company.
- A user may not access a company without an active membership.
- Future roles must be added through memberships, not by trusting frontend flags.

## Tables

### `companies`

Stable company ID, display name, status, created timestamp, and lifecycle state.

### `company_memberships`

Company ID, Neon user ID, role, status, created timestamp, and unique membership constraint.

### `company_profiles`

Company name, website, phone, support email, business hours, and IANA timezone. Include `Indian/Mauritius` as a supported option.

### `user_preferences`

UI preferences, notifications, onboarding state, and user-level settings.

### `agent_profile_versions`

Draft/published status, assistant preferences, company instructions, enabled capabilities, structured business rules, version number, creator, and timestamps.

### `voice_sessions`

Company ID, profile version, session ID, LiveKit room/dispatch IDs, optional 3CX call ID, state, and lifecycle timestamps. Do not store transcripts or audio.

## Database authorization

- Use a non-bypass application role.
- Enable RLS on every company-owned table.
- Apply explicit ownership predicates in repository functions as a second layer.
- Keep migration/admin roles separate from runtime roles.
- Test direct cross-tenant queries and malformed IDs.

## Service identity

Next.js verifies browser sessions and issues short-lived internal credentials. FastAPI, LiveKit, and integration services validate issuer, audience, expiry, company ID, user ID, session ID, and permitted service role.

