-- Tenant-isolated Google Calendar read mirror. The mirror is advisory for fast
-- reads only; provider writes and pre-write availability validation remain live.

CREATE TABLE IF NOT EXISTS calendar_sync_states (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    calendar_id TEXT NOT NULL DEFAULT 'primary',
    sync_token TEXT,
    last_synced_at TIMESTAMPTZ,
    sync_status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (sync_status IN ('pending', 'syncing', 'ready', 'needs_full_sync', 'failed')),
    last_error_code VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, calendar_id)
);

CREATE TABLE IF NOT EXISTS calendar_event_mirror (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    calendar_id TEXT NOT NULL DEFAULT 'primary',
    event_id TEXT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'confirmed',
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    event_payload JSONB NOT NULL,
    provider_updated_at TIMESTAMPTZ,
    mirrored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, calendar_id, event_id),
    CONSTRAINT calendar_event_mirror_valid_range CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_mirror_company_range
    ON calendar_event_mirror (company_id, calendar_id, start_time, end_time)
    WHERE status <> 'cancelled';

DROP TRIGGER IF EXISTS trg_calendar_sync_states_updated_at ON calendar_sync_states;
CREATE TRIGGER trg_calendar_sync_states_updated_at
    BEFORE UPDATE ON calendar_sync_states
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

ALTER TABLE calendar_sync_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_event_mirror ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_sync_states_company_access ON calendar_sync_states;
CREATE POLICY calendar_sync_states_company_access ON calendar_sync_states
    USING (company_id = current_company_id())
    WITH CHECK (company_id = current_company_id());

DROP POLICY IF EXISTS calendar_event_mirror_company_access ON calendar_event_mirror;
CREATE POLICY calendar_event_mirror_company_access ON calendar_event_mirror
    USING (company_id = current_company_id())
    WITH CHECK (company_id = current_company_id());

ALTER TABLE calendar_sync_states FORCE ROW LEVEL SECURITY;
ALTER TABLE calendar_event_mirror FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voice_bot_runtime_app') THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_sync_states TO voice_bot_runtime_app';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON calendar_event_mirror TO voice_bot_runtime_app';
    END IF;
END $$;
