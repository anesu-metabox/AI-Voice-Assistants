# Secure Per-Company 3CX Integration Plan

## Goal

Allow each company to enter and connect its own 3CX v20 details without exposing credentials to other tenants, frontend code, logs, models, or unauthorized services.

## Setup interface

Fields:

- Connection name.
- Public HTTPS PBX URL.
- 3CX Service Principal client ID (`appId`).
- Programmable Extension / Route Point DN (a separate value from the client ID).
- 3CX client secret/API key (write-only).
- Inbound DID numbers.
- Approved transfer destinations.

Client secrets are write-only. Existing secrets are never prefilled, returned,
or partially displayed. The non-secret client ID may be returned to the
authenticated company owner for editing; it is never used as the Route Point DN.

## Secure submission

1. Browser submits over HTTPS to an authenticated Next.js endpoint.
2. Same-origin CSRF and a Neon Auth session created within the last ten
   minutes are verified for test, save, and disconnect. Older sessions must
   sign in again; missing or malformed authentication timestamps fail closed.
3. The request is validated and rate-limited.
4. FastAPI tests the connection server-side without logging secrets.
5. Successful credentials are encrypted and stored atomically.
6. The response contains safe metadata and connection health only.

## KMS encryption

- Generate an AES-256-GCM data key per integration.
- Bind encryption context to company, integration, provider, field, and schema version.
- Wrap data keys with a managed non-exportable KMS master key.
- Restrict decrypt permission to the integration broker.
- Rotate KMS keys by rewrapping data keys.
- Revoke old connector sessions after key rotation.

## SSRF controls

- HTTPS FQDNs only in v1.
- Port 443 by default.
- Reject private, loopback, link-local, metadata, multicast, and reserved addresses.
- Validate DNS results and prevent rebinding.
- Do not follow redirects.
- Require normal TLS validation.
- Bound each DNS lookup (2 seconds) and cap outstanding resolver work at four
  per process; if DNS worker capacity is saturated, reject within 250 ms.
  Bound HTTP timeouts and streamed response bodies (64 KiB token response;
  1 MiB Call Control response). The credential broker separately caps active
  3CX probes at four per process and fails quickly with a generic `503` when
  saturated; deployment replica count therefore sets the aggregate ceiling.
- Sanitize provider errors.

## Runtime isolation

- Maintain one integration, credential context, client, subscription, and call state machine per company.
- Resolve tenant from integration and DID mapping, never caller-controlled identity.
- Atomically claim calls and prevent duplicate agents.
- Use one controlled path from 3CX through the approved adapter/SIP ingress into LiveKit and Gemini.
- Disconnect and rotation terminate old sessions.
- Do not store recordings or transcripts by default.

## Rollout

1. Validate one non-production 3CX v20 PBX with the required 8SC+ AI license
   and Call Control API permission.
2. Configure the programmable extension/Route Point and route the pilot DID to
   that DN. Confirm this app-owned route point—not an ordinary monitored
   extension—is where audio flows; 3CX only exposes participant audio for the
   app's own route point. See the [official API guide](https://www.3cx.com/docs/call-control-api/),
   [endpoint specification](https://www.3cx.com/docs/call-control-api-endpoints/),
   and [official SDK reference](https://github.com/3cx/call-control-sdk-ts).
3. Verify Call Control permissions, codecs, transfers, and the audio path.
4. Prove one call creates one LiveKit room and one Gemini agent.
5. Test two independent companies.
6. Add outbound calls only after inbound isolation is proven.
