-- Phase-50 / 0009 — F8 Redaction Layer columns rollback.
--
-- Reverses the columns added in 000207_ai_call_log_redaction.up.sql.
-- Safe to run multiple times via IF EXISTS.

BEGIN;

ALTER TABLE ai_call_log
    DROP COLUMN IF EXISTS redacted_classes,
    DROP COLUMN IF EXISTS redaction_bypass;

COMMIT;
