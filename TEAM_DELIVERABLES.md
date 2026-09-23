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

## 2. Elihu Joseph — Mobile App & Integrations Lead
**Core Focus:** Native mobile application (`mobile/`), React Native / Expo, LiveKit Mobile WebRTC audio streaming, mobile audio session handling, and client integration with FastAPI endpoints.

| Deliverable ID | Deliverable Description | Target Due Date | Status | Verification & Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **MOB-01** | Expo App Scaffolding & Native Audio Permissions | 2026-09-26 | [Pending] | Clean Expo project in `mobile/` with TypeScript, `app.json` permissions for mic/audio on iOS/Android. |
| **MOB-02** | LiveKit Mobile WebRTC Voice Streaming Bridge | 2026-09-30 | [Pending] | Bi-directional streaming voice loop over `@livekit/react-native` connecting to Gemini Live via LiveKit room. |
| **MOB-03** | Mobile Voice Visualizer & Audio Controls | 2026-10-05 | [Pending] | Native 60fps waveform ring, push-to-talk, hands-free toggle, and native interruption muting. |
| **MOB-04** | Streaming Transcript & Task Card Deck | 2026-10-10 | [Pending] | Touch-optimized streaming transcript feed and task cards with swipe gestures. |
| **MOB-05** | Mobile Latency Benchmark & Physical Device QA | 2026-10-15 | [Pending] | Verified sub-450ms turnaround latency tested on physical iOS and Android devices without jitter. |

---

## 3. Vayen — Frontend & UI/UX Lead
**Core Focus:** Web frontend application polish (`frontend/`), Next.js 15, Tailwind CSS design system, 60fps Canvas audio visualizer, responsive layouts, and real-time task decks.

| Deliverable ID | Deliverable Description | Target Due Date | Status | Verification & Acceptance Criteria |
| :--- | :--- | :--- | :--- | :--- |
| **WEB-01** | Architecture Audit & Component Modularization | 2026-09-26 | [Pending] | Decompose monolithic `App.tsx` into modular components under `frontend/src/components/`. |
| **WEB-02** | Executive Visual Polish & Design System | 2026-09-30 | [Pending] | Unified Tailwind palette, dark/light aesthetics, glassmorphism cards, and Framer Motion micro-interactions. |
| **WEB-03** | Canvas 60fps Audio Visualizer Ring Elevation | 2026-10-04 | [Pending] | Smooth glow transitions, reactive audio frequencies, and seamless idle-to-active visual states. |
| **WEB-04** | Responsive Layouts (Mobile, Tablet, Desktop) | 2026-10-08 | [Pending] | Crisp, touch-friendly responsive interface verified down to 375px mobile viewport. |
| **WEB-05** | Real-Time Telemetry & CI Verification | 2026-10-12 | [Pending] | Clean `npm run typecheck`, zero warnings, live latency display, and approved PR into `develop`. |

---

## Team Working Agreements & Definition of Done (DoD)
1. **Pull Request Protocol:** Every PR must be reviewed by at least one other team member. Architecture-altering PRs require Anesu's approval.
2. **Verified Execution Rule:** No tool PR is merged without automated unit tests asserting both success (`200 OK`) and graceful error handling.
3. **Latency Accountability:** Any feature adding more than 100ms to conversational turnaround time must be flagged in the weekly sync.
4. **Zero Duplication Guarantee:** Any tool that modifies external state (creating bookings, sending emails) must accept and enforce an idempotency key.
5. **Sacred Main & Gatekeeper Protocol (ADR-009):** Direct push to `main` is strictly forbidden. Only **Anesu (`anesu-metabox`)** is authorized to push or merge into `main`. All feature PRs merge into `develop` first.
6. **Automated CI Quality Gate:** All PRs must pass automated CI (`.github/workflows/ci.yml`) with green status checks before merging.

