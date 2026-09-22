-- Bind each idempotent LiveKit session to the exact published profile used
-- when its dispatch was created. Existing rows remain valid until reconnect.
ALTER TABLE livekit_sessions
    ADD COLUMN IF NOT EXISTS profile_version INTEGER;

CREATE INDEX IF NOT EXISTS idx_livekit_sessions_company_profile
    ON livekit_sessions (user_id, profile_version);
