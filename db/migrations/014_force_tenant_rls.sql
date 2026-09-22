-- Table owners bypass ordinary RLS in PostgreSQL. The runtime connection must
-- remain tenant-bound even when the deployment uses the database owner role
-- during the migration window, so force RLS on every tenant-owned table.

ALTER TABLE companies FORCE ROW LEVEL SECURITY;
ALTER TABLE company_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_profile_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE google_integrations FORCE ROW LEVEL SECURITY;
ALTER TABLE threecx_integrations FORCE ROW LEVEL SECURITY;
ALTER TABLE voice_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE company_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE assistant_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE user_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records FORCE ROW LEVEL SECURITY;
ALTER TABLE confirmation_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE calendar_events FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE livekit_sessions FORCE ROW LEVEL SECURITY;
