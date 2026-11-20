DELETE FROM smart_push_deliveries WHERE decision_kind = 'schedule_conflict';
DELETE FROM smart_charging_decisions WHERE kind = 'schedule_conflict';

ALTER TABLE smart_push_deliveries DROP CONSTRAINT smart_push_deliveries_decision_kind_check;
ALTER TABLE smart_push_deliveries ADD CONSTRAINT smart_push_deliveries_decision_kind_check
    CHECK (decision_kind IN ('plug_in', 'slow_charging', 'trip_review')) NOT VALID;
ALTER TABLE smart_push_deliveries VALIDATE CONSTRAINT smart_push_deliveries_decision_kind_check;

ALTER TABLE smart_charging_decisions DROP CONSTRAINT smart_charging_decisions_kind_valid;
ALTER TABLE smart_charging_decisions ADD CONSTRAINT smart_charging_decisions_kind_valid
    CHECK (kind IN ('plug_in', 'slow_charging', 'trip_review')) NOT VALID;
ALTER TABLE smart_charging_decisions VALIDATE CONSTRAINT smart_charging_decisions_kind_valid;

ALTER TABLE smart_charging_plans
    DROP CONSTRAINT smart_charging_scheduled_start_valid,
    DROP COLUMN scheduled_start_time_zone,
    DROP COLUMN scheduled_start_at;
