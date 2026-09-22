-- One-time, tenant-bound OAuth state with PKCE verifier.
CREATE TABLE IF NOT EXISTS oauth_states (
    nonce VARCHAR(255) PRIMARY KEY,
    company_id UUID NOT NULL,
    session_id VARCHAR(128) NOT NULL,
    code_verifier VARCHAR(128) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states (expires_at);
