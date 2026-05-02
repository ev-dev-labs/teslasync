-- Phase 40 / Prompt 40 — Computed-Metric Alerts.
-- Extends alert_rules with a second rule kind ('computed_metric') that
-- aggregates over charging_sessions / drives / signal_log instead of
-- evaluating raw signal values.
--
-- For 'computed_metric' rules, the legacy signal_name / op / value_* columns
-- are unused; we persist sentinel empty strings so the existing NOT NULL +
-- CHECK constraints stay intact and Go scans into `string` keep working.
-- A new partial CHECK enforces that metric_* fields are populated when
-- kind='computed_metric'.

ALTER TABLE alert_rules
  ADD COLUMN IF NOT EXISTS kind             text             NOT NULL DEFAULT 'signal'
    CHECK (kind IN ('signal','computed_metric')),
  ADD COLUMN IF NOT EXISTS metric_id        text,
  ADD COLUMN IF NOT EXISTS metric_window    text,
  ADD COLUMN IF NOT EXISTS metric_threshold double precision,
  ADD COLUMN IF NOT EXISTS metric_op        text;

-- Constrain metric_op to the supported operator set (NULL allowed for kind='signal').
ALTER TABLE alert_rules
  DROP CONSTRAINT IF EXISTS alert_rules_metric_op_check;
ALTER TABLE alert_rules
  ADD CONSTRAINT alert_rules_metric_op_check
    CHECK (metric_op IS NULL OR metric_op IN ('>','>=','<','<=','=','!=','%_change_>','%_change_<'));

-- Constrain metric_window to the supported window set (NULL allowed for kind='signal').
ALTER TABLE alert_rules
  DROP CONSTRAINT IF EXISTS alert_rules_metric_window_check;
ALTER TABLE alert_rules
  ADD CONSTRAINT alert_rules_metric_window_check
    CHECK (metric_window IS NULL OR metric_window IN ('day','week','month','rolling_7d','rolling_30d'));

-- For kind='computed_metric', the four metric_* fields must all be populated.
ALTER TABLE alert_rules
  DROP CONSTRAINT IF EXISTS alert_rules_kind_metric_required;
ALTER TABLE alert_rules
  ADD CONSTRAINT alert_rules_kind_metric_required
    CHECK (kind = 'signal' OR (
      metric_id IS NOT NULL AND
      metric_window IS NOT NULL AND
      metric_threshold IS NOT NULL AND
      metric_op IS NOT NULL
    ));

-- Relax the legacy op CHECK so computed_metric rules can persist '' as a
-- sentinel without violating it. The original constraint is auto-named
-- alert_rules_op_check by Postgres (see migrations/_baseline_source/18-alert-rules.sql).
ALTER TABLE alert_rules
  DROP CONSTRAINT IF EXISTS alert_rules_op_check;
ALTER TABLE alert_rules
  ADD CONSTRAINT alert_rules_op_check
    CHECK (op = '' OR op IN ('=','!=','<','<=','>','>=','changed','between','outside'));

CREATE INDEX IF NOT EXISTS idx_alert_rules_kind_enabled
  ON alert_rules (kind, enabled) WHERE enabled = TRUE;

COMMENT ON COLUMN alert_rules.kind IS
  'Rule type: ''signal'' (raw telemetry) or ''computed_metric'' (aggregated).';
COMMENT ON COLUMN alert_rules.metric_id IS
  'Identifier of a registered computed metric (e.g. ''charging_cost''). Required when kind=''computed_metric''.';
COMMENT ON COLUMN alert_rules.metric_window IS
  'Aggregation window for the metric: day, week, month, rolling_7d, rolling_30d.';
COMMENT ON COLUMN alert_rules.metric_threshold IS
  'Numeric threshold compared against the computed metric value.';
COMMENT ON COLUMN alert_rules.metric_op IS
  'Comparison operator for the metric vs threshold. ''%_change_>'' / ''%_change_<'' compare current window to the previous window.';
