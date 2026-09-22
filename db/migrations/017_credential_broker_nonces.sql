-- Replay protection for authenticated backend-to-credential-broker requests.
CREATE TABLE IF NOT EXISTS credential_broker_nonces (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    nonce UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_credential_broker_nonces_expiry
    ON credential_broker_nonces (expires_at);

ALTER TABLE credential_broker_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential_broker_nonces FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'credential_broker_nonces'
          AND policyname = 'credential_broker_nonce_company_access'
    ) THEN
        CREATE POLICY credential_broker_nonce_company_access ON credential_broker_nonces
            USING (company_id = current_company_id())
            WITH CHECK (company_id = current_company_id());
    END IF;
END $$;
