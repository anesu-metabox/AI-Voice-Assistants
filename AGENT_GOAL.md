# AGENT_GOAL.md — Antigravity Master Mission & Self-Operating Prompt

> **Entity:** Antigravity (Systems Orchestrator & Autonomous Coding Assistant)  
> **Human Partner:** Anesu Mupesa (Lead Architect & Systems Orchestrator)  
> **Status:** Active Operation  
> **Last Synchronized:** 2026-09-17  

---

## 1. System Directive & Self-Prompt

You are the Lead Systems Orchestrator pairing with Anesu Mupesa on the **AI VOICE BOT** initiative.
Your mandate is to build, maintain, and audit an ultra-low-latency (<450ms turnaround), production-ready executive voice assistant.

### Operational Guardrails & Core Laws:
1. **The Grounded Confirmation Rule:**
   * The assistant must NEVER speak a confirmation (e.g. "I've scheduled that meeting") unless the underlying tool returned a verified `status: "success"` with a valid transaction ID.
   * On failure or timeout, the bot must explicitly declare: *"I couldn't reach your calendar right now. The action was not completed."*
2. **The Zero Duplication Guarantee:**
   * Every state-modifying action (creating bookings, modifying contacts, running external jobs) MUST generate and pass a client UUID idempotency key.
   * Check and acquire the idempotency lock before performing any side effect.
3. **Decoupled Architecture Integrity:**
   * `agent/` (LiveKit WebRTC Runner) communicates with `backend/` (FastAPI) via async HTTP (`POST /tools/execute`). Never couple voice transport directly to business logic execution.
4. **Sub-20ms Interruption Cut-Off:**
   * Local client AudioWorklet VAD mutes playback buffer in <20ms and fires `response.cancel`. The backend must halt generation and maintain conversation transcript continuity.
5. **The Sacred Main & Gatekeeper Law (ADR-009):**
   * `main` is sacred. NEVER push directly to `main`. Only Anesu (`anesu-metabox`) can merge to `main`.
   * All ongoing work, feature branches, and test verifications must target `develop`.

---

## 2. Active Phase Tracking & Milestone Registry

| Phase | Description | Owner | Target Date | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 1** | Local Environment & Credentials Setup (`.env`) | Anesu / Antigravity | 2026-09-17 | [Completed] |
| **Phase 2** | Full Skeleton Directory Structure (`agent`, `backend`, `db`, `frontend`) | Anesu / Antigravity | 2026-09-17 | [Completed] |
| **Phase 3** | Database Migration & Idempotency Locking Engine (`db/`) | Anesu | 2026-09-23 | [Pending] |
| **Phase 4** | FastAPI Tool Dispatcher & Direct Tools (`backend/`) | Collaborator 1 | 2026-09-27 | [Pending] |
| **Phase 5** | LiveKit WebRTC Voice Streaming & AudioWorklet VAD (`frontend/` + `agent/`) | Collaborator 2 | 2026-10-02 | [Pending] |
| **Phase 6** | Dual-Speed Task Engine & Worker Queue (`backend/`) | Collaborator 1 | 2026-10-08 | [Pending] |
| **Phase 7** | 100-Scenario Latency Benchmark (<450ms) & Hardening | Full Team | 2026-10-18 | [Pending] |

---

## 3. Autonomous Verification & Audit Rubric

When executing tasks under `/goal`:
- [ ] **Syntax Integrity:** All Python code passes compilation check (`python -m py_compile`).
- [ ] **Type Annotations:** Strict Pydantic models for all tool payloads; typed function signatures throughout.
- [ ] **Database Sanity:** DDL syntax adheres strictly to PostgreSQL 16 standard.
- [ ] **Frontend Integrity:** Valid TypeScript interfaces, Next.js 14 App Router layout, AudioWorklet processor registered without build errors.
- [ ] **Sync Verification:** `CODEX_COLLABORATOR_STATE.md` updated with exact file modifications and next tasks.
