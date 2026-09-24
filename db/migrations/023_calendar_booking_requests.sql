-- Durable requests for calendar bookings that could not be completed because
-- the provider/broker was temporarily unavailable. This is separate from the
-- generic user task ledger and stores only the data needed to retry a booking.
CREATE TABLE IF NOT EXISTS calendar_booking_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    session_id VARCHAR(128),
    idempotency_key VARCHAR(128) NOT NULL,
    request_payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed', 'needs_reconnect', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_until TIMESTAMPTZ,
    result_payload JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT calendar_booking_requests_company_idempotency_unique UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_calendar_booking_requests_claim
    ON calendar_booking_requests (next_attempt_at, created_at)
    WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_calendar_booking_requests_user_status
    ON calendar_booking_requests (user_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_calendar_booking_requests_updated_at ON calendar_booking_requests;
CREATE TRIGGER trg_calendar_booking_requests_updated_at
    BEFORE UPDATE ON calendar_booking_requests
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

ALTER TABLE calendar_booking_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_booking_requests_company_access ON calendar_booking_requests
    USING (user_id = current_company_id())
    WITH CHECK (user_id = current_company_id());
ALTER TABLE calendar_booking_requests FORCE ROW LEVEL SECURITY;

-- The background service must use a dedicated BYPASSRLS database role whose
-- only table grants are SELECT/UPDATE on this queue. The regular API role stays
-- NOBYPASSRLS and uses the tenant policy above.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'calendar_booking_worker') THEN
        EXECUTE 'GRANT SELECT ON calendar_booking_requests TO calendar_booking_worker';
        EXECUTE 'GRANT UPDATE (status, attempt_count, next_attempt_at, lease_until, result_payload, error_message, updated_at) ON calendar_booking_requests TO calendar_booking_worker';
    END IF;
END $$;
