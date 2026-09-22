-- LiveKit session/dispatch idempotency ledger.
-- A browser retry must never create a second agent dispatch for the same session.
CREATE TABLE IF NOT EXISTS livekit_sessions (
    user_id VARCHAR(128) NOT NULL,
    session_id VARCHAR(128) NOT NULL,
    room_name VARCHAR(255) NOT NULL,
    dispatch_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, session_id),
    UNIQUE (room_name)
);

CREATE INDEX IF NOT EXISTS idx_livekit_sessions_last_seen
    ON livekit_sessions (last_seen_at);
