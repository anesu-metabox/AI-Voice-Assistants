# Architectural Decision Records (ADR) & Decisions Log

> **Purpose:** Record all major technical, architectural, and tooling decisions made for **AI VOICE BOT**, including context, options considered, trade-offs, and final decisions for engineering and upper management reference.

---

## ADR Summary Index

| ADR ID | Title | Date | Decision Status | Owner |
| :--- | :--- | :--- | :--- | :--- |
| **ADR-001** | Real-Time Voice Streaming vs Chained Pipeline (STT -> LLM -> TTS) | 2026-09-14 | [Superseded by ADR-008] | Anesu Mupesa |
| **ADR-002** | Direct Backend Code vs n8n for Interactive Task Execution | 2026-09-14 | [Accepted] | Full Team |
| **ADR-003** | Dual-Speed Execution Architecture (Fast Lane vs Async Background) | 2026-09-14 | [Accepted] | Anesu Mupesa |
| **ADR-004** | PostgreSQL Durable Task State & Idempotency Keys | 2026-09-14 | [Accepted] | Collaborator 1 |
| **ADR-005** | Immediate Client-Side Muting on Voice Interruption | 2026-09-14 | [Accepted] | Collaborator 2 |
| **ADR-006** | Single-Session Realtime API vs Decoupled GPT-Live Architecture | 2026-09-16 | [Superseded by ADR-008] | Anesu Mupesa |
| **ADR-007** | Evaluation of Modular Stack (Deepgram + LLM + Cartesia) | 2026-09-16 | [Retained as Production Fallback] | Full Team |
| **ADR-008** | Selection of Google Gemini Live (via LiveKit Agents) as Baseline Voice Engine | 2026-09-16 | [Accepted - Active Strategic Baseline] | Full Team |
| **ADR-009** | Sacred Main Branch, Sole Gatekeeper Governance & Protected Workflow | 2026-09-17 | [Accepted] | Anesu Mupesa |

---

### ADR-001: Real-Time Voice Streaming vs Chained Pipeline (STT -> LLM -> TTS)
- **Status:** Superseded by ADR-008.

---

### ADR-002: Direct Backend Code vs n8n for Interactive Task Execution
- **Context:** Evaluated n8n for executing tools. Webhooks and workflow queues add 500ms - 2000ms per turn.
- **Decision:** Use direct Python/FastAPI async endpoints for all conversational tools. Reserve n8n only for asynchronous batch automations.
- **Consequences:** Instant execution (<400ms), typed code with unit tests, avoiding heavy runtime overhead.

---

### ADR-003: Dual-Speed Execution Architecture (Fast Lane vs Async Background)
- **Context:** Voice calls cannot remain open indefinitely waiting on multi-step jobs.
- **Decision:** Split into Fast Lane (<500ms, inline speech) and Background Lane (>2s, async job + immediate voice task ID acknowledgement).
- **Consequences:** Voice session never freezes; persistent tasks survive call disconnects.

---

### ADR-004: PostgreSQL Durable Task State & Idempotency Keys
- **Context:** Dropped connections during tool calls must not trigger duplicate bookings or lost progress.
- **Decision:** Enforce client-generated UUID idempotency keys on every external write and store all state in PostgreSQL.
- **Consequences:** Zero duplicate actions, full auditability.

---

### ADR-005: Immediate Client-Side Muting on Voice Interruption
- **Context:** Waiting for server-side VAD to cut audio causes 250-500ms of bot talking over the user.
- **Decision:** Implement client-side AudioWorklet VAD that mutes speaker locally within <20ms while notifying server.
- **Consequences:** No conversational overlap; crisp, natural turn-taking.

---

### ADR-006: Single-Session Realtime API vs Decoupled GPT-Live Architecture
- **Status:** Superseded by ADR-008.

---

### ADR-007: Evaluation of Modular Stack (Deepgram + LLM + Cartesia)
- **Status:** Retained as Production Fallback. While economically sound (~$1.80/hour), assembling three separate vendors and tuning external Silero VAD introduces unnecessary setup overhead for Sprint 1. Retained as our documented failover stack if custom voice cloning or enterprise carrier concurrency demands it.

---

### ADR-008: Selection of Google Gemini Live (via LiveKit Agents) as Baseline Voice Engine

- **Date:** 2026-09-16  
- **Status:** [Accepted - Active Strategic Baseline]  
- **Decision Owners:** Anesu Mupesa (Lead Architect), Collaborator 1, Collaborator 2  
- **Scope:** Core Voice Engine, Model Sourcing, WebRTC Integration

#### 1. Business Context & Problem Statement
The team evaluated three viable technical paths for building the **AI VOICE BOT**:
1. **OpenAI Realtime API:** Native speech-to-speech, high naturalness, but prohibitive operational pricing ($10.80 - $15.00 / hour).
2. **Modular Stack (Deepgram + GPT-4o-mini + Cartesia):** Very low cost ($1.68 - $2.10 / hour), but requires managing 3 vendor accounts, 3 API keys, multi-chunk pipeline coordination, and manual VAD calibration.
3. **Google Gemini Live (Multimodal Live API / Gemini 2.0 Flash) on LiveKit:** Native speech-to-speech streaming model with sub-400ms latency, aggressive low pricing ($1.20 - $2.20 / hour), and single-vendor integration via `livekit-plugins-google`.

#### 2. Comparative Decision Matrix

| Evaluation Criteria | OpenAI Realtime API | Modular Stack (Deepgram + Cartesia) | Google Gemini Live (Chosen) |
| :--- | :--- | :--- | :--- |
| **Setup Complexity** | Low (1 Vendor, 1 Key) | Moderate-High (3 Vendors, 3 Keys, VAD Tuning) | **Lowest (1 Vendor, 1 Key, <25 lines of code)** |
| **Cost Per Hour of Talk Time** | $10.80 - $15.00 / hr | $1.68 - $2.10 / hr | **$1.20 - $2.20 / hr (85% cheaper than OpenAI)** |
| **Audio Pipeline Latency** | 350ms - 500ms | 450ms - 600ms | **300ms - 450ms (Native Gemini 2.0 Flash)** |
| **Speech-to-Speech Nuance** | High (native waveform understanding) | Moderate (text-only LLM context) | **High (native waveform understanding & tone)** |
| **Turn-Taking Configuration** | Built-in | Requires manual Silero VAD tuning | **Built-in (model determines speech end naturally)** |
| **LiveKit Integration** | Official plugin | Official plugins | **Official plugin (`livekit-plugins-google`)** |
| **Vision / Multimodal Ready** | No | No | **Yes (supports live camera/screen sharing)** |

#### 3. Core Justification for Executive Management
1. **Fastest Time-to-Market:** Collaborator 2 can deploy a working prototype in an afternoon because Gemini Live requires zero VAD calibration and only one API dependency.
2. **Superior Financial Health:** Operates at the same aggressive price point as the modular stack (~$1.50/hour) while avoiding OpenAI Realtime's $12/hour price penalty.
3. **Conversational Realism:** Unlike modular pipelines where speech is flattened to text, Gemini Live hears inflections, pauses, and emotional nuances directly from user audio.

#### 4. Identified Operational Risks & Mitigations
- **Risk 1 (Quota & Concurrency Limits):** Standard Google AI Studio keys enforce strict limits on concurrent active WebSockets.  
  *Mitigation:* Develop Sprint 1 and 2 on Google AI Studio; migrate API routing to Google Cloud Platform (Vertex AI) with enterprise billing before launching multi-user production trials.
- **Risk 2 (Fixed Voice Catalog):** Gemini Live only offers 5 preset voices (Aoede, Charon, Fenrir, Kore, Puck). Custom voice cloning is not currently supported.  
  *Mitigation:* Because LiveKit is our abstraction layer, our backend tools and client WebRTC application are completely provider-agnostic. If corporate requirements later mandate custom voice cloning, we can drop in the ADR-007 modular stack (Cartesia Sonic) with minimal code changes.

#### 5. Final Technical Policy
- **Primary Voice Engine:** Google Gemini 2.0 Flash via `livekit-plugins-google`.
- **Media & Transport:** LiveKit Agents WebRTC server.
- **Tool Dispatcher & Security:** FastAPI service.
- **State & Idempotency:** PostgreSQL.
- **Documented Fallback:** Modular LiveKit Stack (Deepgram Nova-2 + Cartesia Sonic).

---

### ADR-009: Sacred Main Branch, Sole Gatekeeper Governance & Protected Workflow
- **Date:** 2026-09-17
- **Status:** [Accepted]
- **Owner:** Anesu Mupesa (Lead Architect & Systems Orchestrator)
- **Scope:** Source Control, Release Management, Git Branching Strategy, CI/CD

#### 1. Context & Problem Statement
With multiple engineers and autonomous agents committing code across WebRTC media transports, FastAPI endpoints, and database migrations, unrestricted pushes to `main` introduce severe operational risks:
1. Accidental broken builds or unverified tool contracts deployed to production.
2. Inadvertent credential or sensitive configuration leakage.
3. Uncoordinated feature merges creating regression bugs during client demos.

#### 2. Decision
1. **Sacred Main Trunk:** The `main` branch is designated as sacred. Direct pushes to `main` are strictly prohibited.
2. **Sole Gatekeeper:** Only **Anesu Mupesa (`anesu-metabox`)** is authorized to push or merge pull requests into `main`.
3. **Integration Trunk (`develop`):** A persistent `develop` branch is established as the staging and simulation environment where all daily work merges.
4. **Feature Branching:** All team members (Anesu, Collaborator 1, Collaborator 2) and AI coding assistants must work in short-lived feature branches (`feat/...`, `fix/...`) branched off `develop`.
5. **Automated CI Quality Gate:** Automated CI workflows (`.github/workflows/ci.yml`) run on every PR. Passing all tests (Python syntax, TypeScript typecheck, DDL validation) is an absolute prerequisite for merging into `develop` or promoting to `main` ("No Green, No Merge").
6. **Promotion Protocol:** Anesu promotes releases from `develop` to `main` via formal release PRs after end-to-end verification.

#### 3. Consequences
- **Positive:** Zero unverified code enters the production baseline. Full auditability and release stability.
- **Trade-off:** Requires a minor branch switching discipline for collaborators, mitigated by automated CI and standardized branch naming.
