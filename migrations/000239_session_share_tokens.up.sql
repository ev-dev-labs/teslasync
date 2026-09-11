-- Session share links: share_tokens can now target either a drive or a
-- charging session (exactly one). Existing rows are drive-bound, so the
-- CHECK holds for all of them at ADD time.

ALTER TABLE share_tokens
    ADD COLUMN charging_session_id BIGINT NULL
        REFERENCES charging_sessions (id) ON DELETE CASCADE;

ALTER TABLE share_tokens
    ALTER COLUMN drive_id DROP NOT NULL;

ALTER TABLE share_tokens
    ADD CONSTRAINT share_tokens_exactly_one_target CHECK (
        (drive_id IS NULL) != (charging_session_id IS NULL)
    );

CREATE INDEX IF NOT EXISTS idx_share_tokens_charging_session
    ON share_tokens (charging_session_id);
