-- Reverse Phase 40 / Prompt 06.
DROP INDEX IF EXISTS idx_alert_rules_snoozed_until;
ALTER TABLE alert_rules
  DROP COLUMN IF EXISTS snoozed_until,
  DROP COLUMN IF EXISTS trigger_mode;
