-- ==============================================================================
-- AI VOICE BOT — Company Profile & Assistant Configuration Migration
-- Migration: 005_company_and_assistant_config.sql
-- ==============================================================================

-- 1. Company Profiles Table
CREATE TABLE IF NOT EXISTS company_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    company_name VARCHAR(255) NOT NULL DEFAULT 'Acme Operations Inc.',
    website_url VARCHAR(255) DEFAULT 'https://acmeops.com',
    company_phone VARCHAR(64) DEFAULT '+1 (555) 019-2834',
    support_email VARCHAR(255) DEFAULT 'support@acmeops.com',
    timezone VARCHAR(64) NOT NULL DEFAULT 'America/New_York (EST)',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_company_profiles_user UNIQUE (user_id)
);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_company_profiles_user ON company_profiles (user_id);

-- Auto-update updated_at timestamp trigger for company_profiles
DROP TRIGGER IF EXISTS trg_company_profiles_updated_at ON company_profiles;
CREATE TRIGGER trg_company_profiles_updated_at
    BEFORE UPDATE ON company_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

-- 2. Assistant Configurations Table
CREATE TABLE IF NOT EXISTS assistant_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    assistant_name VARCHAR(255) NOT NULL DEFAULT 'Support Agent – Charlie',
    voice_engine VARCHAR(64) NOT NULL DEFAULT 'Aoede',
    inbound_greeting TEXT NOT NULL DEFAULT 'Thank you for calling Acme Operations Support. This is Ava, how can I assist you with your account settings today?',
    system_prompt TEXT NOT NULL DEFAULT 'You are a support voice agent. Your tone is warm, polite and direct. Resolve return inquiries using the attached knowledge base. Never invent details outside Acme guidelines. If client requests a tier override, trigger salesforce routing.',
    knowledge_base_notes TEXT DEFAULT 'Standard return window is 30 days. Priority tier requires Gold membership.',
    is_deployed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_assistant_configs_user UNIQUE (user_id)
);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_assistant_configs_user ON assistant_configs (user_id);

-- Auto-update updated_at timestamp trigger for assistant_configs
DROP TRIGGER IF EXISTS trg_assistant_configs_updated_at ON assistant_configs;
CREATE TRIGGER trg_assistant_configs_updated_at
    BEFORE UPDATE ON assistant_configs
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
