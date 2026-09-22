# 3CX Call-Control and LiveKit Media Adapter Specification

Status: partial implementation; not a deployed or PBX-validated adapter.

This specification turns Phase 6 of the [implementation roadmap](IMPLEMENTATION_ROADMAP.md)
into a concrete build and acceptance boundary. It supplements, but does not
replace, the [3CX API spike](3CX_API_SPIKE.md) and
[secure integration plan](3CX_SECURE_INTEGRATION_PLAN.md).

## Product invariant

An inbound call routed to a company's configured 3CX Programmable Extension
must create at most one durable call claim, one opaque LiveKit room, and one
Gemini LiveKit agent session bound to that company's verified profile. The
browser and Gemini agent never receive 3CX credentials. 3CX audio is bridged
as media only; it must not initiate a second model/voice path.

## Target topology

```text
3CX v20 Route Point
  ├─ Call Control WebSocket events ─> isolated connector process
  └─ PCM 8 kHz / signed 16-bit / mono
          <─> per-call bounded audio bridge <─> LiveKit room participant
                                               └─> exactly one Gemini agent

Connector control plane:
  broker-issued tenant binding -> validated PBX connection
  tenant-local DID validation -> atomic event/call claim -> signed dispatch
  call lifecycle -> transfer/drop -> release claim and media resources
```

`connector/threecx-tenant-runtime.mjs` is the single-tenant composition
boundary. It requires an already-authenticated PBX client, an already-verified
tenant binding, and injected persistence, dispatch, media, and fallback
adapters. It single-flights connection startup, registers SDK listeners before
connecting, supplies the controller/session and PBX participant resolver to
the media factory, and drains calls before disconnecting. Failed cleanup keeps
the runtime in a retryable `draining` state. It deliberately does not load
environment credentials, decrypt integration secrets, query tenants, or create
the injected adapters; those remain the security-reviewed workload entrypoint's
responsibility regardless of which approved credential-hosting model is
selected. The controller copies only an explicit allowlist of verified tenant
metadata; arbitrary binding fields, including accidental credentials, are not
retained on the public controller object.

The connector is a separately deployed, private workload. Do not put the 3CX
SDK, API keys, PBX WebSocket, or media bridge in Next.js or the browser. Do not
let the LiveKit agent decrypt the PBX API key. The current credential broker
is the only component allowed to decrypt integration secrets; the preferred
deployment is for it to own/host the connector worker boundary or to grant a
dedicated connector workload a narrowly scoped, authenticated secret lease.
Never return decrypted secrets through a general FastAPI endpoint.

## Event-to-session flow

1. The connector receives an event only from its authenticated 3CX SDK
   connection. Events and all PBX-provided fields are untrusted input.
2. It accepts media-capable `participantConnected` events for the application's
   own Route Point only. Extension-monitor events must never be used to start an
   audio session: they have no exposed media stream.
3. The PBX client is created for one integration under a broker-issued,
   authenticated tenant binding. It validates/canonicalizes the configured DID
   against that integration's allowlist. Company identity comes from the
   client/work lease, never from event fields; do not perform broad
   cross-company integration scans from a runtime database role.
4. It calls the existing atomic `claim_threecx_call` operation with the
   tenant-bound company, PBX call ID, event ID, configured DID, and direction.
   Duplicate events, calls already claimed, unconfigured DIDs, expired leases,
   and inactive integrations do not dispatch an agent.
5. For a newly claimed call it creates the LiveKit room participant and one
   agent dispatch. The dispatch metadata must be signed with the same
   session-context mechanism as browser-created sessions and include a fresh
   session ID, verified Neon Auth subject, company ID, active profile version,
   and issuer/audience/expiry/service role. The PBX call ID is not a room name
   or user-controlled session identity.
6. The connector advances `claimed -> connecting -> active` with the claim
   token and compare-and-set state transitions. It stores only the dispatch ID
   permitted by the existing schema. Failure transitions to `failed` and
   closes the room/agent where possible; retries may recover the same claim but
   may not create a second agent.
7. On PBX hang-up, LiveKit disconnect, transfer, lease loss, or connector
   shutdown, the connector cancels stream tasks, closes readers/writers,
   disconnects its LiveKit participant, stops the agent session, records a
   terminal transition, and releases in-memory state. Cleanup must be
   idempotent.

## Media contract

- 3CX SDK boundary: PCM, 8,000 samples/second, signed 16-bit little-endian,
  mono. Confirm the actual installed SDK's Buffer framing and write
  backpressure behavior before implementation; the public SDK README describes
  this format but does not establish all deployment-specific timing behavior.
- LiveKit boundary: raw PCM frames with an explicit sample rate/channel count;
  published audio uses an `AudioSource` and local audio track. The bridge must
  explicitly resample and frame the 3CX stream; LiveKit will not resample an
  arbitrary raw PBX Buffer automatically.
- First implementation target: 20 ms frames (160 samples / 320 bytes at 8 kHz)
  on the PBX side. Use bounded queues and a documented maximum queue duration.
  On overflow, discard stale audio and emit a redacted metric; never allow an
  unbounded queue or silently increase call latency.
- Preserve sample ordering and signedness, handle arbitrary Buffer boundaries,
  odd trailing bytes, stream close/error, cancellation, and partial frames.
- Inbound: PBX PCM -> frame assembler -> tested resampler -> LiveKit audio
  source -> agent input track.
- Outbound: agent track subscription -> LiveKit audio stream -> tested
  downsampler/frame assembler -> PBX audio writer. Barge-in must clear queued
  outbound PBX audio before forwarding new speech.
- Do not publish the agent's voice into a second room or dispatch another
  Gemini agent. Do not persist audio or transcripts by default.

LiveKit's official server-side media documentation describes raw-track
subscription and `AudioSource` publishing, and explicitly places responsibility
for chunking/resampling on the application when supplying raw audio. The official
3CX TypeScript SDK describes Route Point-only PCM streaming and transfer/drop
operations. See the primary sources in [3CX API Spike](3CX_API_SPIKE.md).

## Security and tenant isolation requirements

- Connector process identity is distinct from browser, API, and migration
  identities. It uses no Neon owner/superuser/BYPASSRLS role.
- A PBX event is already associated with the authenticated PBX connection.
  Keep that connection bound to exactly one company and validate the called DID
  only against that tenant's configured DID allowlist. Do not infer company
  identity from caller/called-number fields or query all tenants to find a DID.
  If a future shared ingress genuinely needs a global DID directory, it requires
  a narrowly scoped resolver, restricted grants, enumeration-abuse controls,
  and dedicated cross-tenant tests; do not disable RLS or give the connector
  broad tenant reads.
- Any internal broker/connector API authenticates workload identity, binds
  request body and path, includes timestamp/nonce replay protection, and
  authorizes each operation against the integration's company. A shared HMAC
  alone is not tenant authorization.
- Secret retrieval (if the broker does not host the connector) is an explicit,
  short-lived lease scoped to one integration and connector identity. It is
  never cached beyond the connection's need, returned to the general API, or
  included in diagnostics, exception text, traces, or model input.
- Connector validates PBX URL, TLS, DNS pinning/rebinding, redirects, ports,
  and connection timeout using the same hardened rules as the current probe.
- Call event payloads, caller IDs, and any attached PBX data remain untrusted
  and are not model instructions. Never log raw event payloads, phone numbers,
  audio, transcripts, API key, bearer token, or signed session metadata.
- Limit calls per integration, reconnect rates, queue memory, stream duration,
  internal token lifetime, and concurrent dispatches. Emit only redacted
  company/session correlation IDs and reason codes.

## Failure and recovery behavior

| Failure | Required behavior |
| --- | --- |
| WebSocket disconnect | Bounded reconnect with backoff; do not replay-dispatch an active call; reconcile current PBX call state before resuming media. |
| Duplicate or reordered event | Inbox dedupe and call claim make it a no-op; invalid transitions are rejected. |
| DID missing/ambiguous | Do not dispatch; record a redacted rejection reason and route/terminate per explicit PBX operator configuration. |
| Token, room, or dispatch failure | Fail closed; clean created resources; no success state and no second agent fallback. |
| Media reader/writer error | Stop that call's audio bridge and execute the tenant's persisted, explicitly approved transfer/disconnect behavior; transfer destinations must match that tenant's allowlist. Do not silently leave a live caller connected to silence. |
| Lease expires / connector dies | A recovery worker may take over only after proving the old lease expired and reconciling PBX and LiveKit state; it must not create a parallel active agent. |
| KMS/broker unavailable | Do not connect using stale plaintext or weaken encryption; mark integration unhealthy and reject new calls. |

## Build order and tests

1. **SDK contract spike:** pin the official SDK version; build a local fake PBX
   implementing auth, WebSocket lifecycle, Route Point participant events,
   audio Buffer fragmentation, writer backpressure, transfer/drop, and reconnect.
2. **Pure media library:** deterministic framing/resampling tests for 8 kHz
   input, target LiveKit rate, reverse conversion, drift, clipping, malformed
   data, bounded buffering, and cancellation. Include short WAV fixtures and
   compare output duration/sample counts; no PBX needed for this stage.
3. **Trusted tenant/call control:** define DID lookup and connector service
   authentication, map verified integration to company/profile/auth subject,
   then test duplicate, concurrent, cross-tenant, expired-lease, and recovery
   cases against an isolated migrated Neon branch using the non-BYPASSRLS role.
4. **Single-agent dispatch:** dispatch metadata verification, exact profile
   snapshot binding, agent/room idempotency, and cleanup tests with a local
   LiveKit server or deterministic API fake.
5. **Media integration:** one-way inbound, one-way outbound, full duplex,
   barge-in, silence, jitter, transfer, hang-up, agent disconnect, PBX
   reconnect, and two simultaneous calls.
6. **PBX acceptance:** non-production 3CX v20 PBX, 8SC+ AI license, Route Point
   DID, credentials, network access, and operator-approved transfer targets.
   Test two isolated companies before enabling production traffic.

Each stage is a release gate. The current repository has the setup/call-claim
foundation plus a vendor-neutral `ThreeCxCallController` core. The core accepts
already-normalized events only, binds every claim/dispatch to one verified
tenant and profile version, rejects non-Route-Point/unconfigured-DID events,
requires a durable claim before dispatch, and coordinates cleanup/state
transitions through injected workload adapters. A LiveKit media bridge now
publishes framed/resampled PBX caller audio and relays only audio from an
injected dispatch-bound verified agent participant back to the PBX. It applies
a bounded 200 ms default audio queue, clears overflowing PBX playback, exposes
barge-in queue clearing, and requires the owner to provide a safe call-failure
handler. The controller renews the durable call claim serially while active and,
on confirmed lease loss, stops media/agent resources before invoking the
required tenant-configured fallback. Before opening media, the new verified
startup helper reads the exact LiveKit dispatch and accepts audio only from its
single running job's server-reported identity with LiveKit's `AGENT` kind.
Deterministic tests exercise
duplicates, single dispatch, profile binding, failure cleanup, and the media
bridge's trust/cleanup/overflow boundaries. The repository also pins
the official 3CX Call Control SDK and LiveKit Node media SDK, includes a
fail-closed 3CX SDK lifecycle-event adapter, a bounded PCM16 frame resampler,
and a fake-PBX lifecycle test that composes event handling, durable claim,
single dispatch, media attachment, duplicate delivery, and hang-up cleanup.
The event adapter deliberately
requires an externally verified inbound-DID resolver because SDK participant
payloads do not guarantee a direction field or a populated called-DID field.
The resampler converts framed 8 kHz mono PCM16LE into LiveKit-rate frames and
flushes the filter tail. The bridge is not yet wired to the broker, dispatcher,
or live PBX connection.

The controller now invokes its injected tenant PBX-fallback callback after
cleaning up an initial dispatch/media startup failure and exposes a
session-bound `handleMediaFailure` method for active bridge failures. Active
failure reasons are a static allowlist; state transitions are serialized with
hang-up and lease renewal. It first records the call as `ending`, requires
resource cleanup, and only records terminal `failed` after the fallback
callback confirms success. Failed cleanup or fallback remains recoverable for
later hang-up/shutdown reconciliation. The verified media startup helper binds
bridge failures to the correct controller/session and optionally reports only
redacted reason/outcome metadata. Every fallback callback receives the
verified company/integration/call/session binding and the per-company
`failureAction`; a transfer request carries a destination only after the
controller validates it against that tenant's transfer allowlist. The callback
itself remains an injected adapter: no deployed composition root currently
loads this binding from the credential broker or executes the action through
an authenticated 3CX call-control session.

This remains partial Phase 6 work. It is not connected to the credential
broker, Neon repository, signed LiveKit dispatcher, or live duplex audio
session. Focused SDK-adapter tests cover fresh-state reconnect reconciliation,
fail-closed recovery, and concurrent two-company binding/DID isolation with
fakes. They do not establish Neon RLS isolation, authenticated PBX lifecycle,
real media backpressure, or transfer/fallback acceptance, and no real PBX
acceptance has passed. The SDK requires Node.js >=24. Although the default
shell selects Node.js 22, the connector suite and SDK/native-package loading
have been verified with the bundled Node.js 24.19.0 runtime; the deployed
connector must also use Node.js 24 or later.
Do not represent Phase 6 as complete until every gate above passes.

## Open operator decisions / prerequisites

- Provide a non-production 3CX v20 PBX with Route Point and required license.
- Confirm whether the credential broker will host connectors or issue
  short-lived secrets to a separately isolated connector workload.
- Define explicit behavior for unconfigured DIDs and emergency/human handoff.
  Bridge failures are now configured per company as disconnect or transfer to
  an allowlisted destination; the connector still needs to execute that policy
  through the authenticated PBX session.
- Define how the broker issues and revokes a tenant-bound connector work lease;
  lease delivery must not become a general-purpose credential-decryption API.
- Confirm whether outbound calling is in scope (initial implementation should
  be inbound only). Each company's allowed transfer destinations are configured
  in its integration settings and validated by the backend, broker, database
  constraint, and controller contract.
- Provision isolated Neon branch access and prove all needed migrations and
  unique-DID ownership constraints under a dedicated `NOBYPASSRLS` runtime role.
