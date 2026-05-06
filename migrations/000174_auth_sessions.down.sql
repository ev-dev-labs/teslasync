-- Phase-46 / Prompt 42 — rollback for auth_sessions.
--
-- The pgcrypto extension is intentionally left installed; other migrations
-- (and the platform baseline) may rely on it.

DROP INDEX IF EXISTS idx_auth_sessions_active;
DROP INDEX IF EXISTS idx_auth_sessions_subject;
DROP TABLE IF EXISTS auth_sessions;
