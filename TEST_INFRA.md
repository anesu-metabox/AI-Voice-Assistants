# Test Infrastructure: Mobile LiveKit Voice Bot Integration

## 1. Overview & Architectural Philosophy
The Mobile LiveKit Voice Bot test infrastructure provides comprehensive, opaque-box, deterministic verification for the Expo React Native mobile application (`mobile/`) interfacing with the Railway-hosted FastAPI backend (`backend/`) and LiveKit Cloud Voice Bot Agent (`agent/`).

Following the 4-Tier testing methodology, the test suite exercises every critical layer of the integration without coupling to transient UI rendering artifacts, while maintaining strict protocol compliance against LiveKit WebRTC standards, native `AudioSession` hardware specifications, and backend security contracts.

## 2. Test Framework & Runner
- **Test Runner**: Node.js built-in test runner (`node:test`)
- **Assertion Library**: Node.js strict assertions (`node:assert/strict`)
- **Module Format**: ECMAScript Modules (`.test.mjs`)
- **Execution Target**: Native Node.js 22+ without third-party test runners (Jest, Mocha) or external compilation overhead, ensuring sub-second execution speed across the entire suite.

## 3. The 4-Tier Test Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│               TIER 4: Real-World Application Scenarios                 │
│   Conversational booking, PAC fillers, backchannel immunity, conflicts │
├────────────────────────────────────────────────────────────────────────┤
│               TIER 3: Cross-Feature Combinations                       │
│   Full call lifecycle, late agent arrival, mid-call drops, teardown    │
├────────────────────────────────────────────────────────────────────────┤
│               TIER 2: Boundary & Corner Cases                          │
│   401/409 errors, network timeouts, malformed tokens, rapid muting     │
├────────────────────────────────────────────────────────────────────────┤
│               TIER 1: Feature Coverage (>=5 tests per feature)         │
│   Token API, State Machine, AudioSession, Interruption, UI Controls    │
├────────────────────────────────────────────────────────────────────────┤
│               STATIC: Native Config & Environment Invariants           │
│   WebRTC packages, Expo plugins, iOS/Android permissions, globals      │
└────────────────────────────────────────────────────────────────────────┘
```

### Tier 1 — Feature Coverage (>=5 test cases per feature)
- **Token API Client (`livekitApi`)**:
  - Trims trailing slashes and correctly targets `${BACKEND_URL}/api/livekit/token`.
  - Serializes `session_id`, `participant_name`, and `profile_version` query parameters.
  - Injects `X-Verified-Session-Context` HMAC header and `Accept: application/json`.
  - Normalizes backend `ws_url` snake_case to `wsUrl` camelCase.
  - Auto-generates valid 8–128 character session IDs when omitted.
  - Preserves and validates custom session IDs.
- **Connection State Machine (`useVoiceBot`)**:
  - Initial state begins in `disconnected`.
  - Initiating a call transitions `disconnected` -> `connecting`.
  - Successful room connection transitions `connecting` -> `waiting_for_agent`.
  - Remote agent audio subscription transitions `waiting_for_agent` -> `connected`.
  - Temporary network loss transitions `connected` -> `reconnecting` and restores to `connected`.
  - Fatal room error transitions to `error`, and user hangup returns to `disconnected`.
- **AudioSession VoIP Mode Hardware Routing**:
  - Activates VoIP mode with `AVAudioSessionCategoryPlayAndRecord` and `AVAudioSessionModeVoiceChat`.
  - Configures loudspeaker output via `setSpeakerphoneOn(true)`.
  - Clean teardown invokes `stopAudioSession()` to release microphone hardware.
  - Prevents redundant/re-entrant audio session initializations.
  - Gracefully handles microphone hardware permission denial without crashing.
  - Dynamically routes audio when toggling speakerphone during active calls.
- **Sub-20ms DataChannel Interruption Protocol**:
  - Dispatches `{ type: "response.cancel" }` strictly when `isBotSpeaking === true`.
  - Strictly suppresses `{ type: "response.cancel" }` when `isBotSpeaking === false`.
  - Enforces sub-20ms dispatch latency from user speech onset to packet transmission.
  - Guarantees reliable delivery over WebRTC DataChannel.
  - Resets speaking state immediately (`isBotSpeaking = false`) upon cancellation.
  - Suppresses cancellation when the user microphone is muted.
- **VoiceAssistant UI & Controls**:
  - Status badge helper maps all connection states (`disconnected`, `connecting`, `waiting_for_agent`, `connected`, `reconnecting`, `error`) to semantic labels, colors, and pulsing indicators.
  - Mute toggle changes track mute state and drives local audio telemetry.
  - Muting microphone immediately zeroes out local visualizer audio energy.
  - Disconnect button stops active calls and triggers clean teardown.
  - Transcript stream parses and stores structured message entries with user/assistant role separation.
  - Error state displays actionable error banner with error codes.

### Tier 2 — Boundary & Corner Cases (>=5 test cases per feature)
- **Network Failures**:
  - DNS resolution failures (`TypeError: fetch failed`) return structured error payloads.
  - Connection timeouts abort in-flight requests cleanly.
  - WebRTC room ICE failures transition state machine to `error` and release microphone.
  - Offline device guard prevents initiating network calls when disconnected.
  - User aborting during token fetch resets state without leaking hardware sessions.
- **401 Unauthorized**:
  - Returns `AUTH_UNAUTHORIZED` structured error.
  - Sets state machine to `error` state.
  - Suppresses automatic reconnection loops to prevent token storming.
  - Extracts backend custom detail strings from error payloads.
  - Clears cached credentials and resets audio sessions.
- **409 Conflict**:
  - Returns `PROFILE_NOT_CONFIGURED` structured error when no assistant profile is published.
  - Extracts the backend requirement message (`"Publish an assistant profile before starting a voice session"`).
  - Prevents WebRTC room connection when 409 occurs.
  - Releases microphone hardware immediately on conflict.
  - Distinguishes 409 conflicts from 401 authorization or 500 server errors.
- **Malformed Token Responses**:
  - Validates presence of `token` string in response payload.
  - Validates presence of `ws_url` string in response payload.
  - Gracefully handles non-JSON / HTML responses (e.g. 502/504 reverse proxy errors).
  - Rejects empty strings (`token: ""` or `ws_url: ""`).
  - Rejects non-object bodies (arrays, numbers, strings).
- **Rapid Mute Toggling**:
  - Rapid successive toggle operations settle on the correct final state without race conditions.
  - Muting while already muted is idempotent.
  - Unmuting while already unmuted is idempotent.
  - Mute state is preserved across room disconnect and reconnection.
  - Muting immediately disables voice activity interruption dispatch.
- **Empty and Whitespace Transcripts**:
  - Discards empty string transcripts (`""`).
  - Discards whitespace-only transcripts (`"   \n\t  "`).
  - Safely ignores packets missing `text` property.
  - Safely handles non-string `text` values without crashing.
  - Trims leading and trailing whitespace from valid transcripts.
- **Reconnection After Connection Drops**:
  - Room `reconnecting` sets status to `reconnecting`.
  - Room `reconnected` restores status to `connected` when agent is present.
  - Room `reconnected` transitions to `waiting_for_agent` if agent dropped during the outage.
  - Rapid flapping connections maintain state consistency.
  - Fatal drop during reconnect transitions to `error` and shuts down `AudioSession`.

### Tier 3 — Cross-Feature Lifecycle Combinations
- **Complete Golden Happy Path**: Token acquisition -> WebRTC Room connection -> AudioSession VoIP start & speakerphone -> TrackSubscribed (bot audio) -> Active speaking telemetry -> Interruption dispatch -> Hangup -> AudioSession stop.
- **Late Agent Arrival**: Mobile connects to room before agent worker prewarms; client stays in `waiting_for_agent` until agent joins and audio track arrives, then transitions to `connected`.
- **In-Call Mute & Interruption**: Muting mic prevents user coughing from interrupting the bot; unmuting re-enables immediate sub-20ms interruption.
- **Premature Hangup**: User cancels call while token fetch or WebRTC connection is pending; session generation guards prevent late callbacks from reviving obsolete connections or locking microphone hardware.
- **Drop & Recovery with Active Interruption**: Network drop occurs during active speech; room recovers, and subsequent user interruption sends `response.cancel` over the newly reconnected DataChannel.

### Tier 4 — Real-World Application Scenarios
- **Conversational Voice Call with PAC Latency Fillers**: User requests calendar availability; tool call exceeds 280ms; Pre-Buffered Acoustic Cache (PAC) filler arrives ("Taking a quick look at your calendar...") and plays through loudspeaker; backend executes `get_calendar_availability`; agent emits `task_update` (`status: "completed"`); agent delivers final grounded response.
- **User Interruption Mid-Filler Playout**: While PAC filler is playing, user changes their mind ("Wait, make that Thursday instead"); client fires `{ type: "response.cancel" }` within 15ms; filler audio aborts; agent pivots to the new prompt.
- **Conversational Backchannel Immunity**: Dual-stage acoustic/semantic turn detector ignores short user backchannels ("uh-huh", duration <350ms, 1 word) while bot speaks; full query ("Actually, let's schedule for 3 PM") immediately cancels playback.
- **Double-Booking Conflict & Acoustic Rescheduling**: User books 2:00 PM; backend reports slot conflict; agent proposes 2:30 PM or 4:00 PM; user accepts 2:30 PM; booking completes with 200 OK.
- **Calendar Cancellation with ANE-03 Confirmation Gate**: User requests event cancellation; tool returns `confirmation_required`; assistant asks for confirmation; user confirms; soft delete executes with audit event.

### Static Configuration Verification
- Validates `mobile/package.json` dependencies: `@livekit/react-native`, `@livekit/react-native-webrtc`, `@livekit/react-native-expo-plugin`, `@config-plugins/react-native-webrtc`, and test scripts.
- Validates `mobile/app.json` plugins and permissions for Android (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `BLUETOOTH`) and iOS (`NSMicrophoneUsageDescription`, `UIBackgroundModes: ["audio"]`).
- Validates `mobile/app/_layout.tsx` top-level invocation of `registerGlobals()`.

## 4. Test Directory Layout
```
mobile/tests/
├── harness.mjs                          # Test harness: MockAudioSession, MockLiveKitRoom, LiveKitApiClient, VoiceBotStateMachine
├── static_config_verification.test.mjs  # 5 tests: package.json, app.json, permissions, plugins, layout
├── tier1_feature_coverage.test.mjs      # 30 tests: Token API, State Machine, AudioSession, Interruption, UI controls
├── tier2_boundary_corner_cases.test.mjs # 35 tests: Network, 401, 409, malformed token, rapid mute, empty transcripts, reconnect
├── tier3_cross_feature_lifecycle.test.mjs # 5 tests: Full lifecycles, late arrival, premature cancel, drop & recover
└── tier4_real_world_scenarios.test.mjs  # 5 tests: PAC fillers, filler interruption, backchannel, booking conflict, confirmation
```

## 5. Test Execution Commands

### Execute All Mobile Tests (from project root)
```powershell
node --test "mobile/tests/*.test.mjs"
```

### Execute All Mobile Tests (via npm inside mobile/)
```powershell
npm --prefix mobile test
```

### Execute Specific Tiers Individually
```powershell
# Tier 1: Feature Coverage
node --test mobile/tests/tier1_feature_coverage.test.mjs

# Tier 2: Boundary & Corner Cases
node --test mobile/tests/tier2_boundary_corner_cases.test.mjs

# Tier 3: Cross-Feature Combinations
node --test mobile/tests/tier3_cross_feature_lifecycle.test.mjs

# Tier 4: Real-World Scenarios
node --test mobile/tests/tier4_real_world_scenarios.test.mjs

# Static & Config Invariants
node --test mobile/tests/static_config_verification.test.mjs
```
