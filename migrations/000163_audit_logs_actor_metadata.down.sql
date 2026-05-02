-- Reverse Phase-40 / Prompt 49 metadata columns. Drops are guarded with
-- IF EXISTS so this is idempotent across rollbacks.
ALTER TABLE audit_logs
    DROP COLUMN IF EXISTS user_agent,
    DROP COLUMN IF EXISTS ip;
