-- Service Principal appId and Route Point DN are different 3CX values.
-- Existing rows were validated without a distinct appId, so keep them out of
-- active call routing until the owner reconnects with the correct credentials.
ALTER TABLE threecx_integrations
    ADD COLUMN IF NOT EXISTS app_id VARCHAR(255);

UPDATE threecx_integrations
SET state = 'degraded',
    last_checked_at = NULL,
    updated_at = NOW()
WHERE app_id IS NULL AND state = 'active';
