ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_kind_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_kind_check
  CHECK (kind IN ('signal','computed_metric','system_component','place')) NOT VALID;
ALTER TABLE alert_rules VALIDATE CONSTRAINT alert_rules_kind_check;

-- Migration 000158 required metric operands for *every* non-signal kind.
-- Restrict that requirement to computed_metric before event rules are inserted.
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_kind_metric_required;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_kind_metric_required
  CHECK (kind <> 'computed_metric' OR (
    metric_id IS NOT NULL AND metric_window IS NOT NULL
    AND metric_threshold IS NOT NULL AND metric_op IS NOT NULL
  )) NOT VALID;
ALTER TABLE alert_rules VALIDATE CONSTRAINT alert_rules_kind_metric_required;

ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS component_name text;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS transition text;
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS place_id bigint REFERENCES geofences(id) ON DELETE CASCADE;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_event_fields_check CHECK (
  (kind = 'system_component' AND all_vehicles = TRUE
    AND component_name IS NOT NULL AND transition IS NOT NULL
    AND component_name IN ('telemetry','mqtt','database','redis','tesla_api','worker')
    AND transition IN ('outage','recovery') AND place_id IS NULL AND signal_name = '' AND op = ''
    AND value_num IS NULL AND value_text IS NULL AND value_bool IS NULL AND value_min IS NULL AND value_max IS NULL
    AND metric_id IS NULL AND metric_window IS NULL AND metric_op IS NULL AND metric_threshold IS NULL)
  OR (kind = 'place' AND place_id IS NOT NULL AND transition IS NOT NULL AND transition IN ('enter','exit')
    AND component_name IS NULL AND signal_name = '' AND op = ''
    AND value_num IS NULL AND value_text IS NULL AND value_bool IS NULL AND value_min IS NULL AND value_max IS NULL
    AND metric_id IS NULL AND metric_window IS NULL AND metric_op IS NULL AND metric_threshold IS NULL)
  OR (kind IN ('signal','computed_metric') AND component_name IS NULL AND transition IS NULL AND place_id IS NULL)
) NOT VALID;
ALTER TABLE alert_rules VALIDATE CONSTRAINT alert_rules_event_fields_check;

-- The legacy FK points at alerts(id), not alert_rules(id). New rule-backed
-- notification_logs rows must not fail when those sequences diverge. Existing
-- historical alert_id values remain readable; do not rewrite their identity.
ALTER TABLE notification_logs DROP CONSTRAINT IF EXISTS notification_logs_alert_id_fkey;
COMMENT ON COLUMN notification_logs.alert_id IS
  'Source rule ID for rule-backed notifications; legacy rows may reference historical alerts IDs.';

CREATE TABLE place_alert_observation (
  vehicle_id bigint PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL
);
CREATE TABLE place_alert_occupancy (
  vehicle_id bigint NOT NULL REFERENCES place_alert_observation(vehicle_id) ON DELETE CASCADE,
  place_id bigint NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
  PRIMARY KEY (vehicle_id, place_id)
);
CREATE TABLE event_alert_cooldown (
  rule_id bigint NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  subject text NOT NULL,
  fired_at timestamptz NOT NULL,
  PRIMARY KEY (rule_id, subject)
);
