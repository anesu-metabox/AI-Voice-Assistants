# Multi-Tenant Platform Plan

## Goal

Turn the demo into a tenant-isolated assistant platform where every company owns its configuration, integrations, sessions, and agent behavior.

## Product model

- One Neon Auth owner represents one company in v1.
- A stable `company_id` is the tenant key.
- The schema supports future company members, invitations, and roles.
- Company onboarding controls the assistant’s business behavior.
- Google Calendar and 3CX are company-owned integrations.
- No company may see another company’s data, credentials, sessions, rooms, or calls.

## Data boundaries

Store only identity, configuration, integration metadata, and operational session state. Do not store Calendar events, call audio, raw transcripts, CRM records, or unrestricted business data in the application database.

Application-owned records:

- `companies`
- `company_memberships`
- `company_profiles`
- `user_preferences`
- `agent_profile_versions`
- `google_integrations`
- `threecx_integrations`
- `voice_sessions`

Neon Auth owns users and login sessions in `neon_auth`.

## Core security rules

- Identity comes only from verified Neon Auth sessions or signed internal service credentials.
- Browser and model requests cannot choose the company or user.
- Every tenant table has ownership checks and RLS.
- Every LiveKit room, 3CX call, and Google request carries verified company context.
- Credentials are write-only through the UI and decrypted only by the integration broker.
- All unknown capabilities and unavailable integrations fail closed.
- Logs contain correlation IDs and decisions, never secrets or raw user content.

## Onboarding flow

1. Create or sign into a Neon Auth account.
2. Create the company and owner membership.
3. Capture structured company profile and timezone.
4. Configure assistant personality, greeting, operating instructions, business hours, qualification questions, and escalation rules.
5. Enable approved capabilities.
6. Connect Google Calendar and display the connected Google email.
7. Configure 3CX when required.
8. Validate and test the draft profile.
9. Publish an immutable profile version.
10. Allow new sessions to use the published configuration.

## Migration and rollout

- Create a Neon restore point/branch before schema changes.
- Remove fictional records and the shared default UUID.
- Migrate legitimate settings into company-owned records.
- Run cross-tenant authorization tests before enabling production traffic.
- Roll out authentication and tenant identity before enabling configurable capabilities.
- Roll out capability compilation before enabling 3CX.
