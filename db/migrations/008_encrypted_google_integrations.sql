-- Move Google credentials out of plaintext storage.
ALTER TABLE oauth_tokens
    ADD COLUMN IF NOT EXISTS access_token_ciphertext TEXT,
    ADD COLUMN IF NOT EXISTS refresh_token_ciphertext TEXT,
    ADD COLUMN IF NOT EXISTS encryption_envelope JSONB,
    ADD COLUMN IF NOT EXISTS google_subject VARCHAR(255),
    ADD COLUMN IF NOT EXISTS google_email VARCHAR(320);

-- Existing plaintext credentials are deliberately removed. Accounts must
-- reconnect through Google OAuth after this migration; no plaintext token is
-- carried forward through an un-audited SQL migration.
ALTER TABLE oauth_tokens
    DROP COLUMN IF EXISTS access_token,
    DROP COLUMN IF EXISTS refresh_token;
