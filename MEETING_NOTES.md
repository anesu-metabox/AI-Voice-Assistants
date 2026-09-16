# Meeting Notes & Weekly Team Syncs

> **Cadence:** Weekly Sprint Planning (Mondays 10:00 AM) & Mid-Week Standup (Wednesdays 2:00 PM)  
> **Location:** Google Meet / Discord Voice  
> **Team:** Anesu Mupesa, Collaborator 1, Collaborator 2

---

## Meeting Log Index
- [2026-09-14 - Project Kickoff & Architecture Discovery Review](#2026-09-14---project-kickoff--architecture-discovery-review)
- [2026-09-16 - Mid-Week Architecture Strategy & Engine Selection Sync](#2026-09-16---mid-week-architecture-strategy--engine-selection-sync)
- [Weekly Sprint Sync Template](#weekly-sprint-sync-template)

---

## 2026-09-14 - Project Kickoff & Architecture Discovery Review
**Attendees:** Anesu Mupesa (Lead Architect), Collaborator 1 (Backend Lead), Collaborator 2 (Voice & Frontend Lead)  
**Objective:** Align on project vision, review architectural research (Codex discovery notes), establish team ownership, and finalize Sprint 1 scope.

### Key Takeaways & Discussion Notes:
1. **Scope Definition:**
	- The bot is not a generic casual chatbot; it is an **executive task assistant** that interacts with calendars, emails, CRM, and files.
	- The system must prioritize **speed and verified actions**. A spoken confirmation must never precede actual backend verification.
2. **Architecture Evaluation (Codex Research Findings):**
	- *Audio Pipeline:* Chained STT-LLM-TTS is rejected due to excessive turn latency (>2s). We are going with native real-time streaming (OpenAI Realtime API / LiveKit Agents).
	- *Tool Execution:* Direct Python backend tools chosen for interactive actions (calendar, contacts) to maintain <500ms speed. n8n is excluded from the hot conversational loop.
	- *Persistence:* Tasks that take longer than 2 seconds are handed off to an asynchronous worker queue, backed by PostgreSQL.
3. **Role Assignments:**
	- **Anesu:** End-to-end architecture, state ledger schema, security & permissions, system integration.
	- **Collaborator 1:** FastAPI service, tool registry, Google Calendar/CRM API integrations, background worker.
	- **Collaborator 2:** Audio streaming client, WebRTC setup, local VAD, interruption handling, Next.js UI.

### Kickoff Action Items:
| Action Item | Assignee | Due Date | Status |
| :--- | :--- | :--- | :--- |
| Complete technical spec and ADR documentation | Anesu Mupesa | 2026-09-18 | [In Progress] |
| Stand up FastAPI backend skeleton with dummy tool endpoints | Collaborator 1 | 2026-09-20 | [In Progress] |
| Create WebRTC microphone capture test harness with visualizer | Collaborator 2 | 2026-09-20 | [In Progress] |
| Provision Neon PostgreSQL database and run initial schema migrations | Anesu Mupesa | 2026-09-22 | [Pending] |

---

## 2026-09-16 - Mid-Week Architecture Strategy & Engine Selection Sync
**Attendees:** Anesu Mupesa (Lead Architect), Collaborator 1 (Backend Lead), Collaborator 2 (Voice & Frontend Lead)  
**Objective:** Evaluate voice streaming engine options (OpenAI Realtime API vs Modular Deepgram Stack vs Google Gemini Live), clarify Speech-to-Text vs native Speech-to-Speech trade-offs, formalize ADR-007 and ADR-008, and align Sprint 1 technical priorities.

### Key Discussion Notes & Architectural Consensus:
1. **OpenAI Realtime API Discarded as Baseline (ADR-006 Superseded):**
	- Audio streaming costs of $10.80 to $15.00 per hour make scaling commercial conversational sessions financially impractical.
2. **Modular Stack Evaluated as Production Fallback (ADR-007 Accepted):**
	- Evaluated LiveKit + Deepgram Nova-2 (STT) + GPT-4o-mini (LLM) + Cartesia Sonic (TTS).
	- While unit costs are attractive (~$1.80/hr), managing 3 external vendor accounts, multi-chunk synchronization, and manual Silero VAD calibration adds setup complexity. Retained as our official production fallback.
3. **Google Gemini Live Selected as Strategic Baseline (ADR-008 Accepted):**
	- LiveKit Agents with `livekit-plugins-google` and Gemini 2.0 Flash Multimodal Live API.
	- Delivers single-vendor integration (1 API key), sub-400ms turnaround, built-in turn-taking, native waveform emotion/nuance comprehension, and highly aggressive pricing ($1.20 - $2.20/hr).
4. **Technical Clarification: Deepgram vs. Gemini Live:**
	- Deepgram is also real-time, but is an STT engine only (ears). Gemini Live is a unified multimodal model (ears, brain, and vocal cords).
	- Native Speech-to-Speech eliminates two network hops and two serialization steps, cutting latency by ~200-300ms.
	- Deepgram remains superior where strict text-only guardrails or custom voice cloning (Cartesia/ElevenLabs) are mandated.
5. **Operational Risk Management:**
	- Google AI Studio WebSocket rate limits will be used for Sprint 1 and 2 prototyping; migration to GCP Vertex AI enterprise quotas is scheduled prior to multi-user staging.

### Updated Action Items:
| Action Item | Assignee | Due Date | Status |
| :--- | :--- | :--- | :--- |
| Publish ADR-007 and ADR-008 with complete management justification | Anesu Mupesa | 2026-09-16 | [Accepted] |
| Pivot voice streaming spike to LiveKit Agents with livekit-plugins-google | Collaborator 2 | 2026-09-20 | [In Progress] |
| Implement FastAPI tool dispatcher and integrate Pydantic schemas with LiveKit | Collaborator 1 | 2026-09-21 | [In Progress] |
| Provision Neon PostgreSQL database and execute state ledger migrations | Anesu Mupesa | 2026-09-22 | [Pending] |

---

## Weekly Sprint Sync Template
Use this format for every subsequent team meeting:
```markdown
### Date: YYYY-MM-DD
**Attendees:** [List]
**Sprint:** [Sprint Number & Goal]

#### 1. What was completed since last sync?
- [Item 1] (Owner)
- [Item 2] (Owner)

#### 2. What is currently in progress?
- [Item 1] (Owner)

#### 3. Any blockers or dependencies?
- [Blocker description and who needs to resolve it]

#### 4. Decisions & Notes
- [Key decision or consensus reached]

#### 5. Action Items
| Action Item | Assignee | Due Date | Status |
|---|---|---|---|
| ... | ... | ... | ... |
```
