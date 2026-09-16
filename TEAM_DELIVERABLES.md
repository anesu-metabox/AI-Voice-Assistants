# Team Deliverables & Individual Workspaces

> **Overview:** Individual milestone assignments, deadlines, and acceptance criteria for each engineer building the **AI VOICE BOT**.

---

## 1. Anesu Mupesa — Lead Architect & Systems Orchestrator
**Core Focus:** System architecture, agent orchestration loop, durable state ledger, security/permission guardrails, and architectural integrity.

| Deliverable ID | Deliverable Description | Target Due Date | Status | Verification & Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **ANE-01** | System Architecture Spec & ADR Documentation | 2026-09-18 | [In Progress] | Completed architecture blueprint and 8 ADRs (including ADR-007 and ADR-008) published in Notion and repo `ARCHITECTURE.md`. |
| **ANE-02** | PostgreSQL Schema & Idempotency Locking Engine | 2026-09-23 | [Pending] | Neon Postgres database provisioned; migration scripts for `tasks` and `idempotency_records` committed. |
| **ANE-03** | Permission Interceptor & Confirmation Protocol | 2026-10-02 | [Pending] | Middleware that intercepts high-impact tool calls, pauses execution, and prompts user confirmation. |
| **ANE-04** | Dual-Speed Task Orchestration Engine | 2026-10-08 | [Pending] | End-to-end test verifying that fast tools return <500ms and slow tools seamlessly hand off to worker queue. |
| **ANE-05** | 100-Scenario Quality & Latency Benchmark | 2026-10-18 | [Pending] | Automated test suite measuring median response latency (<450ms) and zero false confirmations across 100 runs. |

---

## 2. Collaborator 1 — Backend & Integrations Lead
**Core Focus:** FastAPI backend development, external tool integrations, direct execution speed, background worker queues, and external API error handling.

| Deliverable ID | Deliverable Description | Target Due Date | Status | Verification & Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **COL1-01** | FastAPI Service & Dynamic Tool Dispatcher | 2026-09-21 | [In Progress] | FastAPI app running with `/tools/execute` endpoint, Pydantic argument validation, and structured JSON output. |
| **COL1-02** | Google Calendar & Contact Direct Tools | 2026-09-27 | [Pending] | Working Python functions for `search_contacts`, `get_calendar_availability`, and `create_calendar_event` with unit tests passing. |
| **COL1-03** | Asynchronous Background Worker Service | 2026-10-04 | [Pending] | Background worker capable of picking up queued tasks from PostgreSQL and updating `status: 'completed'`. |
| **COL1-04** | Task Status & Explicit Cancellation API | 2026-10-09 | [Pending] | Endpoints `/tasks/{id}/status` and `/tasks/{id}/cancel` allowing the voice bot to check status or halt pending jobs. |
| **COL1-05** | Multi-Source Document & Briefing Worker | 2026-10-15 | [Pending] | Background job that queries documents/CRM, compiles a briefing document, and returns a verified storage URL. |

---

## 3. Collaborator 2 — Real-Time Voice & Frontend UX Lead
**Core Focus:** Audio streaming pipelines, WebRTC / WebSockets, client-side Voice Activity Detection (VAD), interruption responsiveness, and interactive web interface.

| Deliverable ID | Deliverable Description | Target Due Date | Status | Verification & Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **COL2-01** | Realtime Voice Streaming Spike (LiveKit + Gemini Live) | 2026-09-20 | [In Progress] | Working agent runner connecting to LiveKit Cloud using `livekit-plugins-google` and Gemini 2.0 Flash, streaming audio bidirectionally. |
| **COL2-02** | Client-Side VAD & Instant Playback Mute | 2026-09-25 | [Pending] | Interruption test: User speaking immediately silences the bot's speaker playback in under 50ms. |
| **COL2-03** | Next.js Interactive Dashboard & Audio Visualizer | 2026-10-02 | [Pending] | Clean UI with push-to-talk / hands-free mode, dynamic audio visualizer ring, and connection status pill. |
| **COL2-04** | Live Transcript & Task Status Card Deck | 2026-10-08 | [Pending] | Streamed speech-to-text appears in real-time alongside cards displaying active task executions. |
| **COL2-05** | Audio Jitter & Latency Optimization Polish | 2026-10-16 | [Pending] | Measured audio turnaround latency under 450ms without packet drops, clicks, or robotic distortion. |

---

## Team Working Agreements & Definition of Done (DoD)
1. **Pull Request Protocol:** Every PR must be reviewed by at least one other team member. Architecture-altering PRs require Anesu's approval.
2. **Verified Execution Rule:** No tool PR is merged without automated unit tests asserting both success (`200 OK`) and graceful error handling.
3. **Latency Accountability:** Any feature adding more than 100ms to conversational turnaround time must be flagged in the weekly sync.
4. **Zero Duplication Guarantee:** Any tool that modifies external state (creating bookings, sending emails) must accept and enforce an idempotency key.

