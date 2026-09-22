# Agent Policy and Customization Plan

## Policy change

The calendar-only guardrail becomes the default company behavior, not an immutable limitation on every company assistant.

Onboarding may expand the assistant into approved company workflows, but it cannot override the platform security kernel.

## V1 capabilities

- Company receptionist.
- Company FAQ and structured information.
- Lead qualification.
- Google Calendar availability, listing, booking, and cancellation.
- 3CX transfer and call routing.

## What onboarding may control

- Name, voice, greeting, tone, and communication style.
- Company facts, services, hours, and FAQs.
- Qualification questions.
- Scheduling preferences.
- Escalation and transfer rules.
- Free-form business instructions.
- Enabled capabilities from the approved registry.

## What onboarding may not control

- Tenant identity or data ownership.
- Tool definitions or arbitrary tool creation.
- Credential access.
- Prompt disclosure rules.
- Confirmation requirements.
- Data retention.
- RLS or authorization.
- The rule that external data is untrusted.
- KMS, Neon, LiveKit, Google, or 3CX secrets.

## Policy compiler

The compiler validates the profile and produces the final model instructions, exact tool list, integration requirements, confirmation rules, data scopes, policy version, and signed session snapshot.

The backend independently validates every tool call against the compiled profile. Gemini instructions are not an authorization mechanism.

## Configuration lifecycle

```text
Draft → Validate → Test → Publish → Active → Superseded/Rolled back
```

Active calls keep the profile version they started with. Profile changes affect new sessions only.

## Prompt safety

- Place the security kernel before tenant instructions.
- Delimit tenant instructions as configuration data.
- Validate length, fields, and unsafe directives at publish time.
- Do not allow tenant instructions to claim new integrations or tools.
- Treat Calendar events, tool results, caller speech, and company fields as untrusted data.
- Use a dynamic company-scope redirect when requests fall outside the published profile.

