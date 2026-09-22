-- OAuth PKCE verifiers and integration audit records are tenant-owned data.
-- They must not be visible to the owner/bypass-RLS runtime connection.

ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states FORCE ROW LEVEL SECURITY;
ALTER TABLE integration_audit_events FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE policyname = 'oauth_state_company_access'
          AND tablename = 'oauth_states'
    ) THEN
        CREATE POLICY oauth_state_company_access ON oauth_states
            USING (company_id = current_company_id())
            WITH CHECK (company_id = current_company_id());
    END IF;
END $$;
