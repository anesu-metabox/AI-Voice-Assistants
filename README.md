# AI VOICE BOT — Project Repository & Documentation Hub

> **Project Mission:** Build a low-latency (<450ms), production-grade AI Voice Assistant capable of conversational fluency, real-world task execution (calendars, CRM, contacts, emails, documents), and resilient background task persistence.

---

## Project Overview
- **Project Name:** AI VOICE BOT
- **Status:** [Active] — Sprint 1 (Architecture, Tool Pipeline & Audio Baseline)
- **Target MVP Launch:** October 2026
- **Team Size:** 3 Engineers
- **Notion Command Center:** [AI VOICE BOT on Notion](https://app.notion.com/p/645a127ab3014cbdad1245aeeed7222c)

---

## Team Ownership & Roster

| Member | Role | Core Responsibility |
| :--- | :--- | :--- |
| **Anesu Mupesa** | **Lead Architect & Systems Orchestrator** | System architecture, execution loop, state ledger, safety/permissions, code review. |
| **Collaborator 1** | **Backend & Integrations Lead** | FastAPI service, tool registry, external API connectors (Google Calendar, CRM), async worker queue. |
| **Collaborator 2** | **Voice Engine & Frontend UX Lead** | WebRTC audio streaming, client UI, microphone capture/VAD, live audio visualizer, interruption handling. |

---

## Repository Documentation Index

All core technical documentation and project tracking files are maintained directly in this repository and synchronized with Notion:

- [**ROADMAP_AND_PROGRESS.md**](./ROADMAP_AND_PROGRESS.md) — Master sprint plan, deliverable milestones, SLAs, and active risk registers.
- [**TEAM_DELIVERABLES.md**](./TEAM_DELIVERABLES.md) — Detailed task breakdowns, due dates, and acceptance criteria for Anesu, Collaborator 1, and Collaborator 2.
- [**ARCHITECTURE.md**](./ARCHITECTURE.md) — End-to-end system design, LiveKit + Gemini Live audio pipeline, dual-speed execution paths, and database schema.
- [**DECISION_LOG_ADR.md**](./DECISION_LOG_ADR.md) — Architectural Decision Records (ADR-001 through ADR-008).
- [**MEETING_NOTES.md**](./MEETING_NOTES.md) — Kickoff discovery notes, weekly sync logs, and action item tracking.
- [**RESOURCES_AND_API_CATALOG.md**](./RESOURCES_AND_API_CATALOG.md) — Tool JSONSchemas, external SDK documentation, and developer resources.
- [**.env.example**](./.env.example) — Configuration and environment variables template.

---

## High-Level Architecture

```
[ Client Mic / Browser ] 
         ▲ (WebRTC / PCM16 Audio Stream <150ms)
         ▼
[ Realtime Voice Layer: LiveKit Agents + Google Gemini Live (Gemini 2.0 Flash) ]
         ▲ (Tool Invocation JSON)
         ▼
[ FastAPI Backend Runtime ]
   ├── Fast Lane (<500ms): Direct Python API Calls (Google Calendar, CRM)
   └── Persistent Lane (>2s): Asynchronous Worker Queue (Trigger.dev / Asyncio)
         │
         ▼
[ PostgreSQL Database (Neon) ] -> Task State, Audit Logs & Idempotency Locks
```

---

## Target System Acceptance Criteria (SLAs)

1. **Conversational Turnaround Latency:** Audio-to-audio latency under **450ms** median.
2. **Instant Interruption Cut-Off:** User speech interrupts bot playback locally within **<20ms** via client VAD and sends server cancellation.
3. **Verified Execution Authority:** The voice bot never hallucinates task success; spoken confirmations are strictly conditioned on verified `200 OK` tool outputs.
4. **Resilience & Idempotency:** All state-modifying actions require client-generated UUID idempotency keys to eliminate duplicate operations on network drops.

