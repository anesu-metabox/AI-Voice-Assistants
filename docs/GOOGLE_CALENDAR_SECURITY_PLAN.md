# Google Calendar Security Plan

## Authorization

- Use authorization-code OAuth with PKCE.
- Bind initiation and callback to the active Neon session.
- Use one-time state, secure cookies, exact callback origins, and replay protection.
- Never trust a user ID encoded in OAuth state.
- Verify Google subject identity and display the connected email.

## Credential storage

- Store one Calendar integration per company in v1.
- Encrypt access and refresh tokens with per-integration envelope encryption.
- Use managed KMS with separate Google encryption context.
- Restrict decryption to the integration broker.
- Never return tokens, ciphertext, wrapped keys, or raw provider responses.

## User experience

Show:

- Connected/disconnected state.
- Google account email.
- Granted scopes.
- Connection time.
- Reconnect-required state.

Replacing an account requires explicit confirmation and atomically replaces only that company’s integration.

## Tool restrictions

Only these Calendar capabilities are available:

- Availability.
- List events.
- Book event.
- Cancel event with explicit confirmation.

Google remains the source of truth. There is no local Calendar fallback or synthetic event response.

