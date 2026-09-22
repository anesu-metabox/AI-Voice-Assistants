-- Multi-tenant company configuration, published agent profiles, integrations,
-- and tenant-bound voice sessions. Neon Auth owns identities in neon_auth.

CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_memberships (
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'owner'
        CHECK (role IN ('owner', 'admin', 'member')),
    status VARCHAR(32) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'invited', 'disabled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (company_id, user_id),
    UNIQUE (user_id)
);

CREATE TABLE IF NOT EXISTS agent_profile_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    lifecycle_state VARCHAR(32) NOT NULL DEFAULT 'draft'
        CHECK (lifecycle_state IN ('draft', 'validated', 'tested', 'published', 'superseded', 'rolled_back')),
    profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    compiled_policy JSONB,
    policy_version VARCHAR(128),
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    UNIQUE (company_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_profile_published
    ON agent_profile_versions (company_id)
    WHERE lifecycle_state = 'published';

CREATE TABLE IF NOT EXISTS google_integrations (
    company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    google_subject VARCHAR(255) NOT NULL,
    google_email VARCHAR(320) NOT NULL,
    access_token_ciphertext TEXT NOT NULL,
    refresh_token_ciphertext TEXT,
    encryption_envelope JSONB NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ NOT NULL,
    state VARCHAR(32) NOT NULL DEFAULT 'active'
        CHECK (state IN ('testing', 'active', 'degraded', 'reconnect_required', 'disabled')),
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS threecx_integrations (
    company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    connection_name VARCHAR(255) NOT NULL,
    pbx_hostname VARCHAR(255) NOT NULL,
    route_point_dn VARCHAR(128) NOT NULL,
    api_key_ciphertext TEXT NOT NULL,
    encryption_envelope JSONB NOT NULL,
    dids JSONB NOT NULL DEFAULT '[]'::jsonb,
    transfer_destinations JSONB NOT NULL DEFAULT '[]'::jsonb,
    state VARCHAR(32) NOT NULL DEFAULT 'testing'
        CHECK (state IN ('testing', 'active', 'degraded', 'disabled')),
    credential_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_checked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voice_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    session_id VARCHAR(128) NOT NULL,
    profile_version INTEGER,
    livekit_room VARCHAR(255),
    livekit_dispatch_id VARCHAR(255),
    threecx_call_id VARCHAR(255),
    state VARCHAR(32) NOT NULL DEFAULT 'created'
        CHECK (state IN ('created', 'connecting', 'active', 'disconnected', 'failed', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (company_id, session_id),
    UNIQUE (livekit_room)
);

CREATE INDEX IF NOT EXISTS idx_company_memberships_user
    ON company_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_company_state
    ON voice_sessions (company_id, state, last_seen_at);

-- Runtime roles must not bypass these policies. The service sets the current
-- company inside a transaction before querying tenant-owned rows.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_profile_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE threecx_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.company_id', true), '')::uuid
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'company_owner_access' AND tablename = 'companies') THEN
        CREATE POLICY company_owner_access ON companies
            USING (id = current_company_id())
            WITH CHECK (id = current_company_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'company_member_access' AND tablename = 'company_memberships') THEN
        CREATE POLICY company_member_access ON company_memberships
            USING (company_id = current_company_id())
            WITH CHECK (company_id = current_company_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'profile_company_access' AND tablename = 'agent_profile_versions') THEN
        CREATE POLICY profile_company_access ON agent_profile_versions
            USING (company_id = current_company_id())
            WITH CHECK (company_id = current_company_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'google_company_access' AND tablename = 'google_integrations') THEN
        CREATE POLICY google_company_access ON google_integrations
            USING (company_id = current_company_id())
            WITH CHECK (company_id = current_company_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'threecx_company_access' AND tablename = 'threecx_integrations') THEN
        CREATE POLICY threecx_company_access ON threecx_integrations
            USING (company_id = current_company_id())
            WITH CHECK (company_id = current_company_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'session_company_access' AND tablename = 'voice_sessions') THEN
        CREATE POLICY session_company_access ON voice_sessions
            USING (company_id = current_company_id())
            WITH CHECK (company_id = current_company_id());
    END IF;
END $$;
