-- ==============================================================================
-- AI VOICE BOT — OAuth Tokens Schema Migration
-- Migration: 003_oauth_tokens.sql
-- Lead Architect: Anesu Mupesa (ANE-02) / Collaborator 1 (DEL-05)
-- ==============================================================================

-- OAuth Tokens Table for User Integrations (Google Calendar, etc.)
CREATE TABLE IF NOT EXISTS oauth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    provider VARCHAR(32) NOT NULL DEFAULT 'google',
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_type VARCHAR(32) DEFAULT 'Bearer',
    scope TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_oauth_user_provider UNIQUE (user_id, provider)
);

-- Indices for fast token lookups by user and provider
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_provider ON oauth_tokens (user_id, provider);

-- Auto-update updated_at timestamp trigger
DROP TRIGGER IF EXISTS trg_oauth_tokens_updated_at ON oauth_tokens;
CREATE TRIGGER trg_oauth_tokens_updated_at
    BEFORE UPDATE ON oauth_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

