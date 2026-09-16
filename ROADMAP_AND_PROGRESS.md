# Master Project Progress Report & Roadmap

> **Status:** [Active] - On Track  
> **Current Cycle:** Sprint 1 - System Core & Pipeline Design  
> **Project Lead:** Anesu Mupesa  
> **Last Updated:** 16 September 2026  

---

## Executive Summary & Current Health

The **AI VOICE BOT** initiative is currently in **Sprint 1 (Architecture, Tool Pipeline & Audio Baseline)**. The foundational architecture has been finalized following comparative system design reviews:
- Audio streaming uses **Google Gemini Live (Gemini 2.0 Flash) on LiveKit Agents (`livekit-plugins-google`)** as the approved strategic baseline (ADR-008), delivering sub-400ms turnaround at ~$1.50/hour talk time.
- The **Modular LiveKit Stack (Deepgram Nova-2 + Cartesia Sonic)** is retained as our documented production fallback (ADR-007).
- Tool execution is divided into a **Fast Path** (direct Python/FastAPI calls for sub-second lookups) and a **Persistent Background Path** (asynchronous worker queue for tasks taking >2s).
- All actions are guarded by backend state persistence and idempotency keys in PostgreSQL to guarantee zero duplicate actions on network drops.

---

## High-Level Roadmap & Milestones

```
+-------------------------------------------------------------------------------+
|  Sprint 1 (Sep 14 - Sep 21) : Architecture, Audio Spike & Tool Harness       |
|  Sprint 2 (Sep 22 - Sep 29) : Direct Tool Integrations (Calendar & CRM)      |
|  Sprint 3 (Sep 30 - Oct 07) : Background Task Worker & State Persistence      |
|  Sprint 4 (Oct 08 - Oct 15) : WebRTC Frontend Interface & Interruption UX    |
|  Sprint 5 (Oct 16 - Oct 23) : End-to-End Latency Benchmark & Hardening        |
+-------------------------------------------------------------------------------+
```

---

## Master Deliverables Status Table

| ID | Deliverable Item | Primary Owner | Target Due Date | Status | Acceptance Criteria / Verification |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DEL-01** | System Architecture & Tool Contract Spec | Anesu Mupesa | Sep 18, 2026 | [In Progress] | Completed 8 ADRs (including ADR-007 and ADR-008), data flow diagrams, and schema definitions published in repo and Notion. |
| **DEL-02** | Realtime Voice Audio Spike (LiveKit + Gemini Live) | Collaborator 2 | Sep 20, 2026 | [In Progress] | Two-way audio stream established over WebRTC via `livekit-plugins-google` with <400ms turnaround. |
| **DEL-03** | FastAPI Core Service & Tool Registry | Collaborator 1 | Sep 21, 2026 | [In Progress] | Tool dispatcher that validates arguments, executes dummy tools, and returns structured JSON. |
| **DEL-04** | State Ledger & PostgreSQL Schema Design | Anesu Mupesa | Sep 23, 2026 | [Pending] | PostgreSQL tables for tasks, executions, user preferences, and idempotency locks. |
| **DEL-05** | Google Calendar & Contact Direct APIs | Collaborator 1 | Sep 27, 2026 | [Pending] | Authenticated OAuth tool functions: `search_contacts`, `get_slots`, `book_event` with unit tests. |
| **DEL-06** | Audio Interruption & Echo Cancellation UX | Collaborator 2 | Sep 29, 2026 | [Pending] | User speaking immediately halts assistant audio playback within 200ms; speech buffer resets. |
| **DEL-07** | Background Asynchronous Worker Service | Collaborator 1 | Oct 04, 2026 | [Pending] | Long-running tasks execute detached from live voice session; status pollable via `get_task_status`. |
| **DEL-08** | Client Web Application & Audio Visualizer | Collaborator 2 | Oct 09, 2026 | [Pending] | Clean Next.js/React frontend with mic controls, live waveform, transcript stream, and task cards. |
| **DEL-09** | End-to-End Security, OAuth & Permissions | Anesu Mupesa | Oct 12, 2026 | [Pending] | Scoped access tokens, approval prompts for high-impact actions (e.g. sending emails, deleting events). |
| **DEL-10** | 100-Scenario Stress Test & Latency Audit | Full Team | Oct 18, 2026 | [Pending] | 100 realistic voice calls tested across noise, accents, interruptions, and network drops. |

---

## Active Risks & Mitigation Strategies

| Risk Description | Severity | Impact | Mitigation Plan |
| :--- | :--- | :--- | :--- |
| **Latency Creep from External APIs** | High | Slow external tools (e.g. Google Calendar API taking 1.2s) degrade conversational naturalness. | Cache availability slots; provide instant filler utterances ("Checking your calendar now...") while tool awaits. |
| **Stale Audio Playback upon Interruption** | High | Bot continues speaking old response after user interrupted with a new instruction. | Server sends an explicit cancellation event; client immediately mutes playback buffer and flushes queue. |
| **Duplicate Tool Execution on Reconnect** | High | If network drops while booking a meeting, retry might create two meetings. | Enforce client-generated UUID idempotency keys on every write tool call. |
| **Google AI Studio WebSocket Concurrency & Quotas** | Medium | Standard developer keys enforce rate limits on concurrent active WebSockets during load testing. | Develop Sprint 1 and 2 on Google AI Studio keys; migrate routing to Google Cloud Platform (Vertex AI) with enterprise billing prior to multi-user staging. |

