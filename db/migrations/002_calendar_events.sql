-- ==============================================================================
-- AI VOICE BOT — Dedicated Calendar Events Persistence Migration
-- Migration: 002_calendar_events.sql
-- ==============================================================================

-- Enable UUID extension if not already present
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Calendar Events Table
CREATE TABLE IF NOT EXISTS calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration_minutes INT NOT NULL DEFAULT 30,
    attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
    meet_link VARCHAR(255),
    status VARCHAR(32) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at TIMESTAMPTZ,
    CONSTRAINT chk_calendar_event_times CHECK (end_time > start_time)
);

-- Index for querying calendar events by user and start time
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_start 
    ON calendar_events (user_id, start_time);

-- Composite covering index for availability overlap and status filtering
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_status_time 
    ON calendar_events (user_id, status, start_time, end_time);

-- Ensure update_timestamp trigger function is defined
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach auto-updating timestamp trigger
DROP TRIGGER IF EXISTS trg_calendar_events_updated_at ON calendar_events;
CREATE TRIGGER trg_calendar_events_updated_at
    BEFORE UPDATE ON calendar_events
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp();
