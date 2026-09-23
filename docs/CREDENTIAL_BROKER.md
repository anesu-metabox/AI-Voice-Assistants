# Credential broker boundary

## Current implementation

The general FastAPI process now sends typed Google Calendar, Google OAuth
completion/disconnect, and 3CX test/save operations to the separately launched
`backend.credential_broker.main:app` process. The broker owns the modules that
decrypt or encrypt stored integration credentials and calls provider APIs. It
returns event/connection metadata only; it does not return OAuth access/refresh
tokens, Google bearer tokens, or 3CX API keys.

Backend-to-broker requests use an HMAC over method, exact path, timestamp,
nonce, and SHA-256 request-body digest. The broker limits clock skew to 30
seconds and consumes a tenant-scoped one-time nonce in migration `017`; replay
protection fails closed if its database ledger is unavailable. All requests
must carry a valid company UUID in the signed body. In production the client
refuses non-HTTPS broker URLs. Local development binds the broker to loopback
and `scripts/dev.ps1` supplies an ephemeral shared secret if one is not already
injected.

The general API also applies shared tenant-scoped limits to 3CX setup actions:
five connection tests and three credential saves per 15-minute window. Migration
`018` stores only one counter/window row per company and action under forced RLS;
budget exhaustion returns `429` with `Retry-After`. If Neon is unavailable,
the setup action fails closed before contacting the PBX.
The same-origin Next.js proxy additionally requires the verified Neon Auth
session to have been created in the previous ten minutes for 3CX test, save,
and disconnect. It never forwards that freshness timestamp as a browser claim;
it obtains the value from the Auth session response and fails closed when the
timestamp is missing, malformed, in the future, or too old.

Credential secrets use tenant-bound AES-GCM envelope encryption. The general
API no longer calls envelope encryption or token-decrypting Calendar functions.
Google OAuth status uses a
metadata-only database query. The broker's OAuth completion operation exchanges
the one-time authorization code, verifies Google identity, encrypts/persists
tokens, and returns only email/scope/expiry metadata.

## Required production topology

```text
Browser -> Next.js -> general FastAPI -> private HTTPS/HMAC -> credential broker
                                      \\-> tenant DB (NOBYPASSRLS role)
credential broker -> tenant DB + Railway-injected encryption key
credential broker -> Google APIs and configured 3CX PBX
```

Only the private broker workload receives `CREDENTIAL_ENCRYPTION_KEY` and its
optional previous-key pair during rotation. The current key is 32 random bytes
encoded as URL-safe base64 and is stored as a Railway service secret. Set
`CREDENTIAL_ENCRYPTION_KEY_VERSION` (default `1`). The general API receives the
broker URL and a unique shared HMAC secret; Next.js, browser, LiveKit worker,
and 3CX PBX do not. Railway project administrators with service-variable
access are trusted with the key; Railway secret storage is not an independent
KMS boundary. Configure network policy so only the general API can reach
the broker's internal listener and the broker can reach Google plus the
company-approved PBX destinations. The shared secret must be held in the
deployment secret manager and rotated through a coordinated rollout.

For local development, `backend/credential_broker/.env` is the dedicated
broker-secret file. The broker imports only its explicit allowlist from that
file, falling back to the root development `.env` for compatibility; it never
copies the migration DSN or role password into its process. Dotenv secrets are
not loaded when `APP_ENV` is production or `NEON_BRANCH` is `production`,
`main`, or `primary`. Production secrets must be injected into the owning
workload. The Next.js launcher refuses to start when `frontend/.env.local`
contains database, provider, broker-HMAC, or encryption-key credentials. The general
backend Settings object intentionally does not retain `DATABASE_URL_UNPOOLED`;
that direct migration connection is only for controlled migration/provisioning
jobs.

Run `scripts/check-config.ps1 -Production` for the general API and
`scripts/check-config.ps1 -Production -CredentialBroker` in the broker's
environment. The latter reads broker-only Google/encryption settings from the
broker-specific environment and does not require LiveKit worker credentials.

## Remaining acceptance work

- Apply migrations `016`–`022` to the isolated Neon branch and run the
  expanded tenant-RLS/replay-ledger integration test with the dedicated
  non-bypass database role. Migration `022` also requires each 3CX integration
  to carry an explicit disconnect or allowlisted-transfer failure policy.
- Verify Railway injects the encryption key only into the private broker and
  use the documented overlap procedure for key rotation. Before switching from
  any prior key provider, confirm no stored envelope depends on that provider;
  this repository has not verified production database contents.
- Deploy the broker on a private HTTPS endpoint; verify TLS identity, inbound
  firewall rules, backend authentication, replay rejection, timestamp expiry,
  and fail-closed behavior while the broker or nonce store is unavailable.
- Confirm backend, Next.js, LiveKit, logs, tracing, and error reports never
  receive or serialize decrypted credentials. Run end-to-end Google
  connect/refresh/calendar/disconnect flows and the 3CX write-only flow against
  non-production integrations.
- Move 3CX operational WebSocket/call-control traffic into the broker/adapter
  boundary before enabling phone capabilities. The current 3CX broker endpoints
  cover setup testing and credential persistence only.
