-- Shared per-company throttles for expensive integration credential probes.
-- One row per company/action avoids retaining request payloads or IP addresses.
CREATE TABLE IF NOT EXISTS integration_action_limits (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    action VARCHAR(40) NOT NULL CHECK (action IN ('threecx_test', 'threecx_save')),
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, action)
);

ALTER TABLE integration_action_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_action_limits FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'integration_action_limits'
          AND policyname = 'integration_action_limits_company_access'
    ) THEN
        CREATE POLICY integration_action_limits_company_access ON integration_action_limits
            USING (company_id = current_company_id())
            WITH CHECK (company_id = current_company_id());
    END IF;
END $$;
