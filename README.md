# AI VOICE BOT — Project Repository & Documentation Hub

> **Project Mission:** Build a secure, company-configurable voice assistant with Neon Auth and tenant-isolated company data, Google Calendar integration, and a single LiveKit + Gemini voice path. 3CX call handling is planned but not yet implemented end-to-end.

---

## Project Overview
- **Project Name:** AI VOICE BOT
- **Status:** In progress — implementation and local verification underway; production rollout gates remain open.
- **Target MVP Launch:** October 2026
- **Team Size:** 3 Engineers
- **Notion Command Center:** [AI VOICE BOT on Notion](https://app.notion.com/p/645a127ab3014cbdad1245aeeed7222c)

## Local development

Start the frontend, FastAPI backend, and LiveKit voice worker together from the
repository root:

```powershell
npm run dev
```

The launcher starts Next.js, FastAPI, the credential broker, and the LiveKit
worker. It refuses to start if the root `.env` selects `NEON_BRANCH=production`,
because local testing must use an isolated Neon branch. Set the matching test
branch and its connection strings before running the stack. Open
`http://localhost:3000/`; runtime logs are written under `.runtime/`.
Use `npm run dev:frontend` only when intentionally running the UI without voice.

---

## Repository Documentation Index

- [Implementation roadmap](./docs/IMPLEMENTATION_ROADMAP.md) — phases and completion gates.
- [Implementation status](./docs/IMPLEMENTATION_STATUS.md) — current code, verification evidence, and open deployment work.
- [QA and systems-design review](./docs/QA-review.md) — findings, dispositions, and acceptance criteria.
- [Production rollout checklist](./docs/PRODUCTION_ROLLOUT_CHECKLIST.md) — gated operator procedure; production changes are not implied by local checks.
- [Neon Auth and tenant data model](./docs/NEON_AUTH_AND_DATA_MODEL_PLAN.md).
- [Agent policy customization](./docs/AGENT_POLICY_CUSTOMIZATION_PLAN.md).
- [Google Calendar security](./docs/GOOGLE_CALENDAR_SECURITY_PLAN.md).
- [Credential broker and KMS](./docs/CREDENTIAL_BROKER.md) and [AWS KMS setup](./docs/AWS_KMS_SETUP.md).
- [3CX secure integration plan](./docs/3CX_SECURE_INTEGRATION_PLAN.md), [API spike findings](./docs/3CX_API_SPIKE.md), and [adapter implementation specification](./docs/3CX_ADAPTER_IMPLEMENTATION_SPEC.md).
- [LiveKit reliability plan](./docs/LIVEKIT_RELIABILITY_PLAN.md) and [Next.js migration plan](./docs/NEXTJS_MIGRATION_PLAN.md).

---

## High-Level Architecture

```
Browser / Next.js BFF ── authenticated tenant context ── FastAPI
       │                                              ├── Neon Postgres (RLS)
       └── LiveKit WebRTC ── LiveKit Agent + Gemini   └── private credential broker
                                                          ├── Google Calendar
                                                          └── encrypted 3CX credentials
```

The browser-direct Gemini voice path is disabled. The credential broker owns
OAuth token exchange/decryption and 3CX secret operations; the general API
receives provider results and display metadata, not decrypted credentials.
The 3CX PBX event/audio adapter and call-to-LiveKit dispatch are not implemented.

---

## Acceptance criteria (not yet production-verified)

1. **Scoped authority:** Voice tools and backend authorization are derived from the published company capability grants and verified tenant context.
2. **No cross-tenant access:** Database RLS and application checks prevent one company from reading or changing another company's data.
3. **Reliable voice lifecycle:** Failed connections remain failed; reconnect, stop, autoplay recovery, transcript deduplication, and one-agent behavior are tested.
4. **Truthful actions:** The assistant reports success only after the provider confirms the calendar operation.
5. **Measured latency:** Active-conversation latency and event-loop blocking are measured before setting a production SLA; the earlier sub-450ms target is not yet demonstrated.
