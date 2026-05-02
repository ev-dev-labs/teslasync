-- Phase 40 / Prompt 40 — Computed-Metric Alerts (DOWN).
-- Drops everything 000158 added and restores the original op CHECK.

DROP INDEX IF EXISTS idx_alert_rules_kind_enabled;

ALTER TABLE alert_rules
  DROP CONSTRAINT IF EXISTS alert_rules_kind_metric_required;
ALTER TABLE alert_rules
  DROP CONSTRAINT IF EXISTS alert_rules_metric_window_check;
ALTER TABLE alert_rules
  DROP CONSTRAINT IF EXISTS alert_rules_metric_op_check;

ALTER TABLE alert_rules
  DROP COLUMN IF EXISTS metric_op,
  DROP COLUMN IF EXISTS metric_threshold,
  DROP COLUMN IF EXISTS metric_window,
  DROP COLUMN IF EXISTS metric_id,
  DROP COLUMN IF EXISTS kind;

-- Restore the original op CHECK from migrations/_baseline_source/18-alert-rules.sql.
ALTER TABLE alert_rules
  DROP CONSTRAINT IF EXISTS alert_rules_op_check;
ALTER TABLE alert_rules
  ADD CONSTRAINT alert_rules_op_check
    CHECK (op IN ('=','!=','<','<=','>','>=','changed','between','outside'));
