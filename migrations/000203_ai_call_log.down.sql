-- Phase-50 / 0004 — F3 AI Call Log + Usage Card.
-- Reverse of 000203_ai_call_log.up.sql.
--
-- TimescaleDB-aware ordering:
--   1. Drop retention + compression policies (otherwise dropping a
--      compressed hypertable can spew warnings).
--   2. Drop indexes.
--   3. Drop the hypertable. CASCADE is unnecessary — no view, FK or
--      continuous aggregate depends on ai_call_log.

BEGIN;

SELECT remove_retention_policy ('ai_call_log', if_exists => TRUE);
SELECT remove_compression_policy('ai_call_log', if_exists => TRUE);

DROP INDEX IF EXISTS ai_call_log_user_started_idx;
DROP INDEX IF EXISTS ai_call_log_feature_started_idx;

DROP TABLE IF EXISTS ai_call_log;

COMMIT;
