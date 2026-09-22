-- Bring the existing dashboard settings tables under the company boundary.
-- The legacy user_id column is retained for API compatibility and stores the
-- deterministic company UUID issued by the authenticated session layer.

ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS company_id UUID;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing rows use the legacy UUID column as the v1 company key. New rows
-- should provide company_id explicitly; retaining user_id avoids breaking
-- the existing calendar-preference repository during the migration window.
UPDATE user_preferences SET company_id = user_id WHERE company_id IS NULL;
ALTER TABLE user_preferences ALTER COLUMN company_id SET NOT NULL;

CREATE OR REPLACE FUNCTION sync_user_preferences_company()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.company_id = COALESCE(NEW.company_id, NEW.user_id);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_preferences_company ON user_preferences;
CREATE TRIGGER trg_user_preferences_company
    BEFORE INSERT OR UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION sync_user_preferences_company();

ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE confirmation_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE livekit_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'company_profile_company_access' AND tablename = 'company_profiles') THEN
        CREATE POLICY company_profile_company_access ON company_profiles
            USING (user_id = current_company_id())
            WITH CHECK (user_id = current_company_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'assistant_config_company_access' AND tablename = 'assistant_configs') THEN
        CREATE POLICY assistant_config_company_access ON assistant_configs
            USING (user_id = current_company_id())
            WITH CHECK (user_id = current_company_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_preferences_company_access' AND tablename = 'user_preferences') THEN
        CREATE POLICY user_preferences_company_access ON user_preferences
            USING (company_id = current_company_id())
            WITH CHECK (company_id = current_company_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tasks_company_access' AND tablename = 'tasks') THEN
        CREATE POLICY tasks_company_access ON tasks
            USING (user_id = current_company_id())
            WITH CHECK (user_id = current_company_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'idempotency_company_access' AND tablename = 'idempotency_records') THEN
        CREATE POLICY idempotency_company_access ON idempotency_records
            USING (user_id = current_company_id())
            WITH CHECK (user_id = current_company_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'confirmation_company_access' AND tablename = 'confirmation_tokens') THEN
        CREATE POLICY confirmation_company_access ON confirmation_tokens
            USING (user_id = current_company_id())
            WITH CHECK (user_id = current_company_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'calendar_events_company_access' AND tablename = 'calendar_events') THEN
        CREATE POLICY calendar_events_company_access ON calendar_events
            USING (user_id = current_company_id())
            WITH CHECK (user_id = current_company_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'oauth_company_access' AND tablename = 'oauth_tokens') THEN
        CREATE POLICY oauth_company_access ON oauth_tokens
            USING (user_id = current_company_id())
            WITH CHECK (user_id = current_company_id());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'livekit_company_access' AND tablename = 'livekit_sessions') THEN
        CREATE POLICY livekit_company_access ON livekit_sessions
            USING (user_id = current_company_id()::text)
            WITH CHECK (user_id = current_company_id()::text);
    END IF;
END $$;
