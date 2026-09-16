-- ==============================================================================
-- AI VOICE BOT — Initial PostgreSQL Schema Migration
-- Migration: 001_initial_schema.sql
-- Lead Architect: Anesu Mupesa (ANE-02)
-- ==============================================================================

-- Enable UUID extension if not already present
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Tasks Table (Durable State Ledger for Dual-Speed Architecture)
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    session_id VARCHAR(128),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    tool_name VARCHAR(64) NOT NULL,
    input_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_result JSONB,
    error_message TEXT,
    idempotency_key VARCHAR(128) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying tasks by user and status
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks (user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks (session_id);

-- 2. Idempotency Records Table (Zero Duplication Guarantee - ADR-004)
CREATE TABLE IF NOT EXISTS idempotency_records (
    key VARCHAR(128) PRIMARY KEY,
    user_id UUID NOT NULL,
    tool_name VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('acquired', 'committed', 'refunded')),
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Index for expired key cleanup and user query
CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_records (expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_user ON idempotency_records (user_id);

-- 3. User Preferences Table (Long-term Working Context & Memory)
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY,
    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',
    working_hours JSONB NOT NULL DEFAULT '{"start": "09:00", "end": "17:00"}'::jsonb,
    default_meeting_duration_minutes INT NOT NULL DEFAULT 30,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger function for auto-updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();

DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER trg_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
