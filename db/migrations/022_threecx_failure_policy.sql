-- Require each configured 3CX integration to record its approved call-failure
-- behavior. Existing integrations stay out of active routing until re-saved.
ALTER TABLE threecx_integrations
    ADD COLUMN IF NOT EXISTS failure_action VARCHAR(16),
    ADD COLUMN IF NOT EXISTS failure_destination VARCHAR(128);

UPDATE threecx_integrations
SET state = 'degraded', last_checked_at = NULL, updated_at = NOW()
WHERE state = 'active' AND failure_action IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'threecx_integrations'::regclass
          AND conname = 'threecx_failure_policy_valid'
    ) THEN
        ALTER TABLE threecx_integrations
            ADD CONSTRAINT threecx_failure_policy_valid CHECK (
                (failure_action IS NULL AND failure_destination IS NULL)
                OR (failure_action = 'disconnect' AND failure_destination IS NULL)
                OR (failure_action = 'transfer'
                    AND failure_destination IS NOT NULL
                    AND length(btrim(failure_destination)) > 0
                    AND transfer_destinations @> jsonb_build_array(failure_destination))
            );
    END IF;
END $$;
