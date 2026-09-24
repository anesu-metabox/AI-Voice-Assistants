# Project: AI Voice Bot Naturalness Upgrade

## Architecture
- **Session Context Decoupling**: Isolated `agent/session_context.py` for HMAC session verification unblocking `backend/tests/test_auth_context.py` from native LiveKit binary dependency conflicts.
- **Latency Masking & Tool Fillers (R1)**: Pre-Buffered Acoustic Cache (PAC) and concurrent `LatencyMaskingWatchdog` (280ms threshold) in `agent/latency_masking.py`, triggered via LiveKit `RunContext` injection on `@llm.function_tool` methods in `agent/agent.py`. Ensures Time-to-Filler < 400ms and zero unmasked dead air > 500ms while preserving Grounded Confirmation Law.
- **Dual-Stage Acoustic & Semantic VAD (R2)**: Client-side AudioWorklet (`frontend/public/worklets/vad-processor.js`) configured with 225 hangover frames (~600ms pause tolerance); server-side `RealtimeModel` configured with `AutomaticActivityDetection(silence_duration_ms=600)` and dynamic endpointing in `AgentSession`.
- **Backchannel Immunity (R3)**: 320ms Tentative Barge-In Window in `frontend/src/hooks/useClientVAD.ts` suppressing gain muting and suppressing `{ type: "response.cancel" }` for brief utterances ("mhm", "yeah"), paired with server-side interruption thresholds (`min_duration=0.35`, `min_words=2`).
- **Human Speech Dynamics & Conversational Style (R4)**: Updated canonical policy in `frontend/src/lib/assistantPolicy.json` mandating colloquial contractions, authentic cadence, contextual fillers, and polite redirection; deterministic `clean_spoken_text()` in `agent/agent.py` stripping markdown formatting.
- **Testing Layer**: Unit tests in `frontend/tests/audio_pipeline.test.mjs`, agent tests in `agent/tests/test_naturalness_upgrade.py`, and full backend test suite in `backend/tests/`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Session Context Decoupling | Extract `VerifiedSessionContext` and `load_verified_session_context` to `agent/session_context.py` to fix `test_auth_context.py` | M1 | Survey Findings |
| 2 | Pre-Buffered Acoustic Cache (PAC) | Pre-generate 24kHz 16-bit PCM AudioFrames for contextual tool fillers in `agent/latency_masking.py` | M2 | ORIGINAL_REQUEST §R1 |
| 3 | Tool Latency Masking Watchdog | 280ms concurrent watchdog emitting acoustic fillers on slow tool execution with playout bridging | M2 | ORIGINAL_REQUEST §R1 |
| 4 | RunContext Auto-Injection | Declare `ctx: RunContext` on all 4 calendar tools in `agent/agent.py` without modifying LLM schema | M2 | ORIGINAL_REQUEST §R1 |
| 5 | Grounded Confirmation Lexical Guard | Enforce strict in-progress dwell semantics in fillers, prohibiting outcome words | M2 | ORIGINAL_REQUEST §R1, §AC6 |
| 6 | 600ms Mid-Sentence Pause Tolerance (Client) | Set `silenceHangoverFrames = 225` and `speechOnsetFrames = 4` in `frontend/public/worklets/vad-processor.js` | M3 | ORIGINAL_REQUEST §R2 |
| 7 | Dual-Stage Semantic VAD & Endpointing (Server) | Configure `silence_duration_ms=600` on `RealtimeModel` and `min_delay=0.6` on `AgentSession` in `agent/agent.py` | M3 | ORIGINAL_REQUEST §R2 |
| 8 | Client 320ms Tentative Barge-In Window | Suppress gain muting and cancel signals for user utterances under 320ms in `frontend/src/hooks/useClientVAD.ts` | M3 | ORIGINAL_REQUEST §R3 |
| 9 | Server Backchannel Interruption Thresholds | Configure `min_duration=0.35`, `min_words=2` in `AgentSession.turn_handling.interruption` | M3 | ORIGINAL_REQUEST §R3 |
| 10 | Conversational Persona & Contractions Policy | Update `frontend/src/lib/assistantPolicy.json` with contractions, authentic cadence, and contextual fillers | M4 | ORIGINAL_REQUEST §R4 |
| 11 | Spoken Markdown Sanitizer | Implement deterministic `clean_spoken_text()` in `agent/agent.py` to strip all markdown from spoken turns and transcripts | M4 | ORIGINAL_REQUEST §R4 |
| 12 | Frontend Audio Pipeline Tests | Add unit tests in `frontend/tests/audio_pipeline.test.mjs` for 600ms hangover and 320ms backchannel immunity | M5 | ORIGINAL_REQUEST §AC3, §AC4 |
| 13 | Agent Naturalness & Latency Unit Tests | Add comprehensive unit tests in `agent/tests/test_naturalness_upgrade.py` for PAC, watchdog, lexical invariants, and markdown cleaner | M5 | ORIGINAL_REQUEST §AC1, §AC2, §AC5, §AC6 |
| 14 | Full Test Suite Execution & Forensic Audit | Run all backend tests, frontend tests, Python syntax check, adversarial stress testing, and forensic audit | M5 | ORIGINAL_REQUEST §AC7 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Session Context Decoupling & Test Unblock | Create `agent/session_context.py`, update imports in `agent/agent.py` and `backend/tests/test_auth_context.py` | None | PLANNED |
| M2 | Latency Masking & Tool Conversational Fillers | Implement `agent/latency_masking.py`, update `agent/agent.py` tool signatures and playout bridging | M1 | PLANNED |
| M3 | Dual-Stage VAD & Backchannel Immunity | Update `frontend/public/worklets/vad-processor.js`, `frontend/src/hooks/useClientVAD.ts`, and `agent/agent.py` VAD/interruption config | M1 | PLANNED |
| M4 | Human Speech Dynamics & Markdown Sanitizer | Update `frontend/src/lib/assistantPolicy.json` and add `clean_spoken_text()` to `agent/agent.py` | M1 | PLANNED |
| M5 | E2E Verification, Test Suite & Forensic Audit | Authored test suites in `frontend/tests/` and `agent/tests/`, verify all backend tests pass, review, challenge, and audit | M1, M2, M3, M4 | PLANNED |

## Interface Contracts
### `agent/latency_masking.py` ↔ `agent/agent.py`
- `LatencyMaskingWatchdog(session: AgentSession, tool_name: str, delay_ms: float = 280.0)`
  - Methods:
    - `async def __aenter__() -> LatencyMaskingWatchdog`
    - `async def __aexit__(exc_type, exc_val, exc_tb) -> None`
    - `async def wait_for_playout() -> None`: awaits active filler completion before returning
- `FILLER_DICTIONARY: Dict[str, List[str]]`: contextual filler phrases for `get_calendar_availability`, `list_events`, `book_event`, `cancel_event`.
  - Invariant: strictly forbidden from containing outcome confirmation tokens (`confirmed`, `scheduled`, `booked`, `all set`, `cancelled`).

### `agent/session_context.py` ↔ `agent/agent.py` & `backend/tests/test_auth_context.py`
- `@dataclass class VerifiedSessionContext`: holds authenticated session properties
- `load_verified_session_context(auth_token: Optional[str] = None) -> Optional[VerifiedSessionContext]`

### `clean_spoken_text(text: str) -> str`
- Deterministic regex sanitizer removing `*`, `**`, `#`, `- `, `* `, `1. `, backticks, and markdown links, replacing them with clean plain speech words.

## Code Layout
- `agent/session_context.py` — Decoupled session verification and dataclasses
- `agent/latency_masking.py` — Pre-Buffered Acoustic Cache, latency watchdog, filler dictionary, playout bridge
- `agent/agent.py` — LiveKit agent worker loop, tool context injection, VAD/interruption config, markdown cleaner
- `frontend/public/worklets/vad-processor.js` — Client AudioWorklet VAD with 600ms hangover and onset filter
- `frontend/src/hooks/useClientVAD.ts` — Client VAD hook with 320ms Tentative Barge-In Window
- `frontend/src/lib/assistantPolicy.json` — Canonical assistant policy kernel and natural speech directives
- `frontend/tests/audio_pipeline.test.mjs` — Frontend unit test suite for VAD hangover and backchannel immunity
- `agent/tests/test_naturalness_upgrade.py` — Unit tests for latency masking, lexical invariants, markdown sanitizer
