-- Support the tenant-scoped recent-call query without scanning a company's
-- entire call ledger as call volume grows.
CREATE INDEX IF NOT EXISTS idx_threecx_call_sessions_company_created
    ON threecx_call_sessions (company_id, created_at DESC, pbx_call_id DESC);
