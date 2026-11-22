ALTER TABLE smart_charging_plans
    ADD COLUMN scheduled_start_at timestamptz,
    ADD COLUMN scheduled_start_time_zone text,
    ADD CONSTRAINT smart_charging_scheduled_start_valid CHECK (
        (scheduled_start_at IS NULL AND scheduled_start_time_zone IS NULL)
        OR
        (scheduled_start_at IS NOT NULL AND scheduled_start_time_zone IS NOT NULL
         AND length(scheduled_start_time_zone) BETWEEN 1 AND 64
         AND scheduled_start_at BETWEEN notify_at AND departure_at + INTERVAL '24 hours')
    ) NOT VALID;
ALTER TABLE smart_charging_plans VALIDATE CONSTRAINT smart_charging_scheduled_start_valid;

COMMENT ON COLUMN smart_charging_plans.scheduled_start_at IS
    'User-entered intended start for this trip; not a command or a vehicle-confirmed dated occurrence.';

ALTER TABLE smart_charging_decisions DROP CONSTRAINT smart_charging_decisions_kind_valid;
ALTER TABLE smart_charging_decisions ADD CONSTRAINT smart_charging_decisions_kind_valid
    CHECK (kind IN ('plug_in', 'slow_charging', 'trip_review', 'schedule_conflict')) NOT VALID;
ALTER TABLE smart_charging_decisions VALIDATE CONSTRAINT smart_charging_decisions_kind_valid;

ALTER TABLE smart_push_deliveries DROP CONSTRAINT smart_push_deliveries_decision_kind_check;
ALTER TABLE smart_push_deliveries ADD CONSTRAINT smart_push_deliveries_decision_kind_check
    CHECK (decision_kind IN ('plug_in', 'slow_charging', 'trip_review', 'schedule_conflict')) NOT VALID;
ALTER TABLE smart_push_deliveries VALIDATE CONSTRAINT smart_push_deliveries_decision_kind_check;
