-- Phase-50 / 0005 — F4 AI Tool-Use Framework.
-- Reverse of 000204_ai_chat_continuations.up.sql.
--
-- Plain table (not a hypertable), so a single DROP CASCADE-free
-- statement reverses everything cleanly. Indexes are dropped
-- implicitly with the table.

BEGIN;

DROP INDEX IF EXISTS ai_chat_continuations_expires_idx;
DROP INDEX IF EXISTS ai_chat_continuations_user_idx;
DROP TABLE IF EXISTS ai_chat_continuations;

COMMIT;
