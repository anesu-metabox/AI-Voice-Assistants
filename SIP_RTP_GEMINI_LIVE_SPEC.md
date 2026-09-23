# Direct SIP RTP to Google Gemini Live Specification

> **Document Version:** 1.0.0  
> **Status:** Draft / Technical Discussion Baseline  
> **Scope:** Architecture & Protocol Specification for Direct Telephony (SIP/RTP) Audio Integration with Gemini 2.0 Multimodal Live API

---

## 1. Executive Summary

This document details the architectural requirements, protocol conversions, media pipelines, and technical trade-offs for connecting **SIP / RTP Telephony streams (e.g. 3CX PBX, Asterisk, Twilio SIP)** directly to **Google Gemini Multimodal Live API**.

---

## 2. Protocol & Media Stream Mismatch

Google Gemini Live API does not expose a native SIP endpoint or RTP listener. Connecting a SIP/RTP phone call to Gemini Live requires bridging two fundamental transport paradigms:

| Metric / Layer | SIP / RTP Telephony (3CX / PBX) | Google Gemini Live API |
| :--- | :--- | :--- |
| **Signaling Protocol** | SIP (UDP/TCP/TLS on port 5060/5061) | WebSocket (`wss://`) / WebRTC BidiStream |
| **Media Transport** | RTP (Real-time Transport Protocol over UDP) | WebSocket Binary Packets / WebRTC DataChannel |
| **Audio Codecs** | G.711u / G.711a (8kHz), G.722 (16kHz), Opus | Raw PCM16 (16kHz or 24kHz, 16-bit mono, Little-Endian) |
| **Packetization** | 20ms RTP audio chunks | Real-time binary PCM audio chunks |
| **Bi-directional Stream** | Asynchronous RTP Inbound / Outbound Sockets | Full-Duplex WebSocket Audio Framing |

---

## 3. Architectural Implementation Patterns

To route SIP RTP audio directly into Gemini Live, we have two primary architectural options:

```
+---------------------------------------------------------------------------------------------------+
| PATTERN A: LiveKit SIP Gateway (Recommended / Production Baseline)                                 |
|                                                                                                   |
|  [ 3CX PBX ]  --(SIP/RTP: G.711)--> [ LiveKit SIP Gateway ] --(WebRTC Opus)--> [ LiveKit Room ]  |
|                                                                                      │            |
|                                                                         Python Agent │ (PCM16)    |
|                                                                                      ▼            |
|                                                                        [ Gemini Live API ]        |
+---------------------------------------------------------------------------------------------------+

+---------------------------------------------------------------------------------------------------+
| PATTERN B: Dedicated Lightweight SIP/RTP-to-WebSocket Proxy (Custom Direct Gateway)                |
|                                                                                                   |
|  [ 3CX PBX ]  --(SIP/RTP: G.711)--> [ Custom Media Gateway ]  --(WebSocket PCM16)--> [ Gemini ]  |
|                                         (FFmpeg / PyAV / RTP Engine)                              |
+---------------------------------------------------------------------------------------------------+
```

### Pattern A: LiveKit SIP Gateway (Current Architecture Baseline)
- **Mechanism**: 3CX routes SIP INVITE & RTP audio to LiveKit SIP Gateway (`livekit-sip`). LiveKit converts SIP media to WebRTC and attaches the Python AI Agent (`agent/agent.py`), which communicates with Gemini Live.
- **Pros**:
  - Out-of-the-box VAD (Voice Activity Detection), interruption handling, and echo cancellation.
  - Built-in session state, tool call handling (FastAPI), and web/phone session parity.
  - Native SIP REFER support for human agent call transfers.
- **Latency Overhead**: ~150ms - 250ms total media processing latency.

### Pattern B: Custom Dedicated SIP/RTP WebSocket Proxy
- **Mechanism**: A lightweight C++/Node.js/Python microservice receives RTP packets directly over UDP, decodes G.711 to PCM16, resamples 8kHz -> 16kHz/24kHz, and pipes the raw PCM stream over WebSocket directly to `generativelanguage.googleapis.com`.
- **Pros**:
  - Lowest possible network latency (<100ms transport overhead).
  - Eliminates SFU / WebRTC media server overhead if only telephony is required.
- **Cons**:
  - Requires manual implementation of RTP jitter buffers, packet loss concealment, VAD, and interruption muting.
  - Harder to integrate real-time web visualizers or dual-engine fallbacks.

---

## 4. Audio Transcoding & Resampling Pipeline

For direct RTP to Gemini Live audio bridging, the media conversion pipeline operates as follows:

```
[Inbound SIP RTP Packet] (G.711u / 8kHz / 20ms)
       │
       ▼
[G.711 Decoder] -> Converts u-law / a-law bytes to linear 16-bit PCM (8kHz)
       │
       ▼
[Audio Resampler] -> Upsamples PCM 8kHz to PCM 16kHz / 24kHz (Linear Interpolation / Speex Resampler)
       │
       ▼
[WebSocket Encoder] -> Formats as base64 or raw binary PCM16 frame for Gemini Live BidiStream
       │
       ▼
[Gemini Live API] -> Model processes audio & streams back PCM16 24kHz output
       │
       ▼
[Downsampler & G.711 Encoder] -> Downsamples 24kHz -> 8kHz G.711u
       │
       ▼
[Outbound SIP RTP Packet] -> Transmitted back to 3CX PBX over UDP
```

---

## 5. Key Clarification & Decision Topics for Technical Review

When reviewing this implementation with the team, consider these core points:

1. **Latency vs. Feature Richness**:
   - Do we prioritize **ultra-low latency** (Custom RTP Proxy, Pattern B) or **full agent capabilities & tool integrations** (LiveKit SIP Gateway, Pattern A)?
2. **Call Transfer (SIP REFER)**:
   - When Gemini Live needs to transfer a customer to a human agent, how will 3CX be notified? (LiveKit SIP REFER vs. 3CX REST API trigger).
3. **DTMF Tone Handling (Touch-tone Keys)**:
   - Does the bot need to detect keypad presses (e.g. "Press 1 for Sales")? SIP RTP uses RFC 2833 / INFO requests for DTMF, which must be converted to text events for Gemini.
4. **VAD & Interruption Protocol**:
   - How should the system handle caller interruptions over SIP? (When caller speaks over bot audio, outbound RTP buffer must be flushed immediately).
5. **Caller Authentication & Identity**:
   - How is caller ID (`ANI`) passed into Gemini Live's initial system instructions?

---

## 6. Document Location & Cross References
- System Architecture: [ARCHITECTURE.md](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/ARCHITECTURE.md)
- Agent Runner: [agent/agent.py](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/agent/agent.py)
- FastAPI Tools Backend: [backend/app/main.py](file:///c:/Dev/Active%20Projects/METABOX%20RESOURCES/VOICE%20BOT/backend/app/main.py)
