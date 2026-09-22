# LiveKit Reliability and Tenant Isolation Plan

## Session identity

- Generate a client session ID for every browser session.
- Derive a unique room from the authenticated company and session.
- Store dispatch state by company/session.
- Reuse dispatches for repeated token requests.
- Add single-flight protection to frontend connection startup.

## Authenticated context

Every token and dispatch must bind:

- Company ID.
- User ID.
- Session ID.
- Profile version.
- LiveKit room and dispatch IDs.
- Optional integration ID.

The worker must load configuration from verified job context, never from model-supplied user IDs or fallback defaults.

## Frontend lifecycle

- Failed token or room connections remain failed.
- Disable duplicate starts while connecting.
- Clean tracks, listeners, timers, subscriptions, and audio contexts on stop or error.
- Expose autoplay-blocked state with a retry action.
- Use structured transcript data-channel events as the only UI transcript source.
- Disable or consume native transcription events to prevent duplicate messages.
- Remove synthetic greetings.

## Backend/worker reliability

- Prewarm imports and HTTP/SSL resources.
- Close per-session clients in guaranteed cleanup paths.
- Preserve the four Calendar tools and compiled company capabilities.
- Monitor event-loop scheduling delay only during active conversations; report
  stalls at or above 100 ms with session correlation and duration, never raw
  transcript content. Unit tests must use a deliberate blocking positive
  control and verify the threshold is detected.
- Log lifecycle decisions without raw transcript text.

## Acceptance tests

- Rapid connect creates one token request, one room, and one agent.
- Failed connections are visible and recoverable.
- Two simultaneous companies get separate rooms and profiles.
- Transcript events render once.
- Reconnect and stop leave no listeners or tracks.
- Profile changes do not alter active sessions.
