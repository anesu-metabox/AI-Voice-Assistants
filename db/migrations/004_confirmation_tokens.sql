-- Single-use, user-bound confirmation tokens for destructive actions.
CREATE TABLE IF NOT EXISTS confirmation_tokens (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL,
    tool_name VARCHAR(64) NOT NULL,
    event_id VARCHAR(128) NOT NULL,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_confirmation_tokens_lookup
    ON confirmation_tokens (user_id, tool_name, event_id, expires_at)
    WHERE consumed_at IS NULL;
