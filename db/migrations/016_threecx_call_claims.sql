-- Durable tenant-scoped call claims and event deduplication for the future
-- 3CX adapter. Provider payloads, caller numbers, credentials, and transcripts
-- are deliberately not stored in the event inbox.

CREATE TABLE IF NOT EXISTS threecx_call_sessions (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    pbx_call_id VARCHAR(255) NOT NULL,
    did VARCHAR(64) NOT NULL,
    direction VARCHAR(16) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    state VARCHAR(24) NOT NULL DEFAULT 'claimed'
        CHECK (state IN ('claimed', 'connecting', 'active', 'transferring', 'transferred', 'ending', 'ended', 'failed')),
    claim_token UUID NOT NULL,
    lease_expires_at TIMESTAMPTZ NOT NULL,
    livekit_room VARCHAR(255) NOT NULL,
    livekit_dispatch_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    PRIMARY KEY (company_id, pbx_call_id),
    UNIQUE (livekit_room)
);

CREATE INDEX IF NOT EXISTS idx_threecx_call_sessions_company_state
    ON threecx_call_sessions (company_id, state, lease_expires_at);

CREATE TABLE IF NOT EXISTS threecx_event_inbox (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    event_id VARCHAR(255) NOT NULL,
    pbx_call_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(96) NOT NULL,
    outcome VARCHAR(24) NOT NULL DEFAULT 'received'
        CHECK (outcome IN ('received', 'processed', 'duplicate', 'rejected', 'failed')),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    PRIMARY KEY (company_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_threecx_event_inbox_call
    ON threecx_event_inbox (company_id, pbx_call_id, received_at DESC);

ALTER TABLE threecx_call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE threecx_call_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE threecx_event_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE threecx_event_inbox FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'threecx_call_sessions'
          AND policyname = 'threecx_call_company_access'
    ) THEN
        CREATE POLICY threecx_call_company_access ON threecx_call_sessions
            USING (company_id = current_company_id())
            WITH CHECK (company_id = current_company_id());
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'threecx_event_inbox'
          AND policyname = 'threecx_event_company_access'
    ) THEN
        CREATE POLICY threecx_event_company_access ON threecx_event_inbox
            USING (company_id = current_company_id())
            WITH CHECK (company_id = current_company_id());
    END IF;
END $$;
