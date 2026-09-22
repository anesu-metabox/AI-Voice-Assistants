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

The AWS KMS key policy now names a dedicated `CredentialBrokerRoleArn` instead
of a general backend role. The general API no longer calls envelope encryption
or the token-decrypting Calendar functions. Google OAuth status uses a
metadata-only database query. The broker's OAuth completion operation exchanges
the one-time authorization code, verifies Google identity, encrypts/persists
tokens, and returns only email/scope/expiry metadata.

## Required production topology

```text
Browser -> Next.js -> general FastAPI -> private HTTPS/HMAC -> credential broker
                                      \\-> tenant DB (NOBYPASSRLS role)
credential broker -> tenant DB + workload identity with KMS GenerateDataKey/Decrypt
credential broker -> Google APIs and configured 3CX PBX
```

Only the broker workload receives `CREDENTIAL_KMS_KEY_ID`, AWS workload
identity, and KMS cryptographic permissions. The general API receives the
broker URL and a unique shared HMAC secret; Next.js, browser, LiveKit worker,
and 3CX PBX do not. Configure network policy so only the general API can reach
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
contains database, provider, broker-HMAC, or KMS credentials. The general
backend Settings object intentionally does not retain `DATABASE_URL_UNPOOLED`;
that direct migration connection is only for controlled migration/provisioning
jobs.

Run `scripts/check-config.ps1 -Production` for the general API and
`scripts/check-config.ps1 -Production -CredentialBroker` in the broker's
environment. The latter reads broker-only Google/KMS settings from the
broker-specific environment and does not require LiveKit worker credentials.

## Remaining acceptance work

- Apply migrations `016`–`022` to the isolated Neon branch and run the
  expanded tenant-RLS/replay-ledger integration test with the dedicated
  non-bypass database role. Migration `022` also requires each 3CX integration
  to carry an explicit disconnect or allowlisted-transfer failure policy.
- Provision separate general-API and broker workload identities; validate the
  CloudFormation role trust and confirm CloudTrail shows KMS use only by the
  broker. Remove all KMS permissions from other runtime roles.
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
