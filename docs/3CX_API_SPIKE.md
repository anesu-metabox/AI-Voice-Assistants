# 3CX v20 API Spike Findings

## Verified integration surface

The current official 3CX v20 documentation describes an externally hosted
Programmable Extension using the Call Control API. Set up a Service Principal
with a client ID and a separately configured Route Point DN, enable Call
Control API access, assign the intended DID to that route point, and retain
the one-time client secret/API key as its secret. Exchange
`client_id`, `client_secret`, and `grant_type=client_credentials` as
`application/x-www-form-urlencoded` at `/connect/token`; use the returned
Bearer token for the Call Control REST and `/callcontrol/ws` APIs. The current
3CX docs state Call Control requires an 8SC+ AI license. See the [3CX Call
Control setup and API guide](https://www.3cx.com/docs/call-control-api/) and
[endpoint specification](https://www.3cx.com/docs/call-control-api-endpoints/).

Important media boundary: audio streaming is supported for participants on the
application's own Programmable Extension/Route Point. A monitored user's
extension participants support call-control operations but do not expose their
media stream to the external application. Therefore the production DID must
route to the company's configured Route Point; monitoring an ordinary
extension is not a substitute. The [official 3CX Call Control SDK reference](https://github.com/3cx/call-control-sdk-ts) documents the Route Point versus
extension participant distinction and the PCM 8 kHz, signed 16-bit mono audio
contract.

The documented audio stream is PCM 16-bit, 8 kHz, mono. That is not the same
media contract as the browser LiveKit session, so the system needs a dedicated
3CX adapter/media bridge. The adapter must resample and packetize audio at the
boundary and must never start a second Gemini/LiveKit agent for a claimed call.

## Required implementation boundary

```text
3CX PBX
  -> Call Control WebSocket + HTTP adapter
  -> tenant-scoped call state machine / atomic call claim
  -> PCM adapter and LiveKit ingress
  -> exactly one Gemini LiveKit agent
```

The adapter owns reconnects, event deduplication, call claiming, DID-to-company
resolution, transfer, voicemail, hang-up, and cleanup. It must use the existing
credential broker; the browser and the LiveKit agent must never receive the raw
3CX API key.

## Implemented foundation (not a live adapter)

Migration `016` adds tenant-forced-RLS call-session and event-inbox tables.
`db/threecx.py` provides an atomic per-company event dedupe/call claim,
configured-DID and active-integration checks, opaque deterministic room names,
lease renewal, and compare-and-set call-state transitions. The call claim is
not yet connected to PBX events or LiveKit dispatch. Unit tests cover idempotent
claims, transition guards, and runtime-role table grants; database concurrency
and cross-tenant behavior must be verified on the isolated migrated branch.
Migration `018` adds shared forced-RLS budgets for 3CX connection tests
(5/company/15 minutes) and credential saves (3/company/15 minutes); API requests
over the limit receive `429` plus a retry delay before the broker probes the PBX.

## Prerequisites before live adapter and media implementation

- A non-production 3CX v20 PBX with Call Control access and the required 8SC+
  AI license.
- A Service Principal client ID, a separate Route Point DN, client secret/API
  key, DID, and explicit minimal
  extension permissions.
- A test call path and confirmation of the PBX FQDN, TLS certificate, and
  network reachability from the connector host.
- Confirmation of the Service Principal token exchange and Call Control
  authorization behavior against the customer's 3CX build; do not substitute
  an API-key header for the documented OAuth client-credentials exchange.
- A codec/audio fixture covering inbound, outbound, interruption, transfer,
  hang-up, reconnect, and duplicate event cases.

## Acceptance gates

1. One inbound call creates exactly one durable claim, one room, and one Gemini
   agent.
2. A duplicate WebSocket event cannot create another claim or agent.
3. Two companies cannot resolve or operate each other’s DID, PBX, room, or call.
4. Audio round-trip, barge-in, transfer, hang-up, and reconnect pass on the
   test PBX.
5. API keys are write-only, encrypted through the configured KMS provider, and
   absent from logs, traces, tool arguments, and model context.

## Source references

- 3CX Call Control API: https://www.3cx.com/docs/call-control-api/
- 3CX Call Control API endpoints: https://www.3cx.com/docs/call-control-api-endpoints/
- 3CX Programmable Extensions: https://www.3cx.com/docs/programmable-extensions/
- Official examples: https://github.com/3cx/agentic-call-control
