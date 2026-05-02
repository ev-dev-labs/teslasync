-- Phase 40 / Prompt 06: alert rule trigger_mode + per-rule snooze.
-- Adds two columns to alert_rules:
--   trigger_mode  - 'repeat' (default, prior behavior) or 'once'.
--   snoozed_until - nullable timestamp; suppresses the rule until it expires.
ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS trigger_mode  text         NOT NULL DEFAULT 'repeat'
    CHECK (trigger_mode IN ('once', 'repeat')),
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz  NULL;

COMMENT ON COLUMN alert_rules.trigger_mode IS
  'repeat = fire every cooldown_min minutes while condition is true (default, prior behavior). '
  'once   = fire once on the rising edge, then suppress until the condition becomes false again.';

COMMENT ON COLUMN alert_rules.snoozed_until IS
  'When set in the future, the rule is suppressed regardless of condition. '
  'NULL = not snoozed. Auto-expires by timestamp; no janitor required.';

CREATE INDEX IF NOT EXISTS idx_alert_rules_snoozed_until
  ON alert_rules (snoozed_until) WHERE snoozed_until IS NOT NULL;
