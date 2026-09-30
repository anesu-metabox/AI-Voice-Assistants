# Project: Expo React Native Mobile Frontend Integration with Railway FastAPI Backend & LiveKit Voice Bot Agent

## Architecture
The system integrates an Expo React Native mobile application (`mobile/`) with a Railway-hosted FastAPI backend (`backend/`) and a LiveKit Voice Bot Agent (`agent/`):
- **Mobile Client**: Expo SDK 57 + React Native 0.86 with `@livekit/react-native` and `@livekit/react-native-webrtc`. Uses native `AudioSession` for VoIP mode audio routing and speakerphone activation.
- **Backend API**: The authenticated Next.js `GET /api/livekit/token` route verifies the login session and proxies to Railway FastAPI. FastAPI mints LiveKit JWTs with `room_join`, `can_publish`, `can_subscribe`, and `can_publish_data` grants. The trusted `X-Verified-Session-Context` HMAC is server-to-server only.
- **LiveKit Agent**: `calendar-assistant` runs in the dispatched LiveKit Cloud room `sandbox-{session_id}` and exchanges agent audio plus DataChannel messages (`transcript`, `task_update`, `response.cancel`).
- **Data Flow**:
  1. User opens Voice Assistant on Mobile -> Mobile requests a token from the authenticated Next.js `/api/livekit/token` proxy.
  2. Mobile connects to LiveKit Cloud via WebRTC `Room`.
  3. Mobile activates native `AudioSession` in VoIP mode with speakerphone.
  4. Audio from mobile microphone is published as WebRTC Opus track.
  5. Agent audio plays through the native LiveKit subscribed-audio path.
  6. When the user presses Interrupt while the agent is talking, mobile sends `{ type: "response.cancel" }` over the reliable WebRTC DataChannel.
  7. On call end, mobile unpublishes tracks, disconnects room, and deactivates `AudioSession` to cleanly release hardware microphone.

## Code Layout
- `mobile/package.json` — Dependencies and scripts for Expo mobile application.
- `mobile/app.json` — Expo configuration including Android/iOS permissions and `@livekit/react-native` config plugin.
- `mobile/app/_layout.tsx` — Root layout initializing `registerGlobals()`.
- `mobile/src/types/voiceBot.ts` — TypeScript types for voice bot sessions, tokens, connection states, and events.
- `mobile/src/services/livekitApi.ts` — Token API service calling the authenticated Next.js `/api/livekit/token` proxy.
- `mobile/src/hooks/useVoiceBot.ts` — Voice bot hook managing the LiveKit Room, native AudioSession, audio routing, speaking state, and interruption.
- `mobile/src/components/VoiceAssistant.tsx` — Modular voice assistant UI with state indicators, visualizer, and call controls.
- `mobile/src/screens/LiveCallModal.tsx` — Existing `/live-call` route host for the Voice Assistant.
- `mobile/tests/` — Unit and integration tests for mobile voice bot services and hooks.
- `backend/app/api/settings.py` — FastAPI token endpoint (`GET /api/livekit/token`).
- `agent/agent.py` — LiveKit Voice Bot Agent (`calendar-assistant`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Native WebRTC Dependencies | Add `@livekit/react-native`, `@livekit/react-native-webrtc`, and Expo plugins to `mobile/package.json` | M1 | R1, Survey Mobile |
| 2 | Expo Config Plugins & Permissions | Configure `app.json` with `@livekit/react-native-expo-plugin`, Android permissions (`RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, `BLUETOOTH`), and iOS permissions (`NSMicrophoneUsageDescription`, `UIBackgroundModes: ["audio"]`) | M1 | R1, Survey Mobile |
| 3 | Native WebRTC Globals Registration | Call `registerGlobals()` at mobile app entry point (`mobile/app/_layout.tsx`) | M1 | R1, Survey Mobile |
| 4 | Voice Bot TypeScript Types | Declare types in `src/types/voiceBot.ts` for tokens, connection states, audio levels, transcripts, and DataChannel packets | M2 | R2, Survey Mobile |
| 5 | Token API Service (`livekitApi.ts`) | Call the authenticated Next.js proxy, keep HMAC signing server-side, validate the response, and map `ws_url` -> `wsUrl` | M2 | R2, Survey Backend |
| 6 | Native VoIP AudioSession Management | Configure LiveKit's communication preset, route audio with `selectAudioOutput(...)`, and release mic hardware on teardown | M2 | R1, R2, Survey Mobile & Agent |
| 7 | Bi-directional Voice State Machine (`useVoiceBot.ts`) | Implement `src/hooks/useVoiceBot.ts` managing Room lifecycle, participant tracks, audio level telemetry, and error recovery | M2 | R2, Survey Mobile |
| 8 | Agent Audio & PAC Filler Playback | Handle `TrackSubscribed` events for agent audio and latency fillers, playing through native speaker | M2 | R2, Survey Agent |
| 9 | Sub-20ms Interruption Protocol | Dispatch `{ type: "response.cancel" }` over DataChannel strictly when `isBotSpeaking === true` | M2 | R2, Survey Agent |
| 10 | Voice Assistant UI Component (`VoiceAssistant.tsx`) | Implement `src/components/VoiceAssistant.tsx` with connection status pills, animated voice activity orb, and transcript stream | M3 | R3, Survey Mobile |
| 11 | Call Controls & Hardware Toggles | Add interactive controls for microphone mute/unmute, speakerphone toggle, and call disconnect | M3 | R3, Survey Mobile |
| 12 | Voice Route Integration | Wire `VoiceAssistant` into the existing `/live-call` modal route and remove the browser-only prototype hook | M3 | R3, Survey Mobile |
| 13 | Mobile Unit & Integration Tests | Comprehensive test suite in `mobile/tests/` for `livekitApi.ts`, state machine transitions, and AudioSession lifecycle | M4 | E2E Testing Track |
| 14 | E2E Mobile-Backend-Agent Verification | Verify end-to-end token acquisition, WebRTC room connection, VoIP audio session routing, and agent voice exchange | M4 | Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Native LiveKit WebRTC Setup & Expo Plugins | Features 1, 2, 3 (`package.json`, `app.json`, `_layout.tsx`) | none | DONE |
| M2 | Token API Service & Voice Bot State Machine | Features 4, 5, 6, 7, 8, 9 (`types/`, `services/livekitApi.ts`, `hooks/useVoiceBot.ts`) | M1 | DONE |
| M3 | Voice Assistant UI & Route Integration | Features 10, 11, 12 (`components/VoiceAssistant.tsx`, `screens/LiveCallModal.tsx`) | M2 | DONE |
| M4 | Testing & Integration Verification | Automated tests and config/type verification pass; physical-device acoustic/E2E run remains | M3 | DEVICE TEST PENDING |

## Interface Contracts
### Mobile Client ↔ authenticated Next.js proxy (`GET /api/livekit/token`)
- **URL**: `${EXPO_PUBLIC_APP_URL}/api/livekit/token`
- **Method**: `GET`
- **Query Parameters**:
  - `session_id` (optional string, 8–128 chars): Unique session ID.
  - `participant_name` (optional string): Display name for the user (default: `"Mobile User"`).
  - `profile_version` (optional int): Target assistant profile version.
- **Credentials**: authenticated session cookie (`credentials: "include"`). The proxy creates `X-Verified-Session-Context` for its server-to-server FastAPI request.
- **Response**:
  ```json
  {
    "token": "eyJhbGciOi...",
    "ws_url": "wss://ai-voice-assistant-vu6rr406.livekit.cloud",
    "room": "sandbox-...",
    "identity": "user-...",
    "session_id": "..."
  }
  ```

### Mobile Client ↔ LiveKit Cloud & Voice Bot Agent
- **WebRTC Connection**: `Room.connect(wsUrl, token)`
- **Audio Session**:
  - `AudioSession.startAudioSession()` activating VoIP mode (`AVAudioSessionModeVoiceChat` on iOS, `MODE_IN_COMMUNICATION` on Android).
  - `AudioSession.selectAudioOutput("speaker" | "force_speaker")` routing playback to loudspeaker.
  - `AudioSession.stopAudioSession()` on disconnect/unmount.
- **DataChannel Protocol**:
  - Outgoing Interruption: `{ "type": "response.cancel" }` sent over reliable DataChannel only when `isBotSpeaking === true`.
  - Incoming Transcripts: `{ "type": "transcript", "role": "assistant" | "user", "text": string, "is_final": boolean, "timestamp": number }`.
  - Incoming Tasks: `{ "type": "task_update", "task": { ... } }`.
