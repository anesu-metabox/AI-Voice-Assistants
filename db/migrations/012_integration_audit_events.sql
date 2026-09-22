-- Redacted integration audit trail. Never store credentials, provider payloads,
-- URLs with secrets, transcripts, or raw request bodies in this table.
CREATE TABLE IF NOT EXISTS integration_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL,
    outcome VARCHAR(32) NOT NULL CHECK (outcome IN ('success', 'failure')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_audit_company_created
    ON integration_audit_events (company_id, created_at DESC);

ALTER TABLE integration_audit_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'integration_audit_company_access' AND tablename = 'integration_audit_events') THEN
        CREATE POLICY integration_audit_company_access ON integration_audit_events
            USING (company_id = current_company_id())
            WITH CHECK (company_id = current_company_id());
    END IF;
END $$;
