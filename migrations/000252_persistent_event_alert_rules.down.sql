DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM alert_rules WHERE kind IN ('system_component','place'))
    OR EXISTS (SELECT 1 FROM place_alert_observation)
    OR EXISTS (SELECT 1 FROM event_alert_cooldown) THEN
    RAISE EXCEPTION 'export and remove event rules, place observations and cooldowns before rolling back migration 000252';
  END IF;
END $$;

DROP TABLE IF EXISTS event_alert_cooldown;
DROP TABLE IF EXISTS place_alert_occupancy;
DROP TABLE IF EXISTS place_alert_observation;
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_event_fields_check;
ALTER TABLE alert_rules DROP COLUMN IF EXISTS place_id;
ALTER TABLE alert_rules DROP COLUMN IF EXISTS transition;
ALTER TABLE alert_rules DROP COLUMN IF EXISTS component_name;
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_kind_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_kind_check CHECK (kind IN ('signal','computed_metric'));
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_kind_metric_required;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_kind_metric_required
  CHECK (kind = 'signal' OR (
    metric_id IS NOT NULL AND metric_window IS NOT NULL
    AND metric_threshold IS NOT NULL AND metric_op IS NOT NULL
  ));
