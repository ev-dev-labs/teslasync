DELETE FROM smart_push_deliveries WHERE decision_kind = 'departure_overlap';
DELETE FROM smart_charging_decisions WHERE kind = 'departure_overlap';

ALTER TABLE smart_push_deliveries DROP CONSTRAINT smart_push_deliveries_decision_kind_check;
ALTER TABLE smart_push_deliveries ADD CONSTRAINT smart_push_deliveries_decision_kind_check
    CHECK (decision_kind IN ('plug_in', 'slow_charging', 'trip_review', 'schedule_conflict')) NOT VALID;
ALTER TABLE smart_push_deliveries VALIDATE CONSTRAINT smart_push_deliveries_decision_kind_check;

ALTER TABLE smart_charging_decisions DROP CONSTRAINT smart_charging_decisions_kind_valid;
ALTER TABLE smart_charging_decisions ADD CONSTRAINT smart_charging_decisions_kind_valid
    CHECK (kind IN ('plug_in', 'slow_charging', 'trip_review', 'schedule_conflict')) NOT VALID;
ALTER TABLE smart_charging_decisions VALIDATE CONSTRAINT smart_charging_decisions_kind_valid;

ALTER TABLE smart_charging_plans
    DROP CONSTRAINT smart_charging_service_window_valid,
    DROP COLUMN service_starts_at,
    DROP COLUMN service_ends_at,
    DROP CONSTRAINT smart_charging_software_window_valid,
    DROP COLUMN software_starts_at,
    DROP COLUMN software_ends_at,
    DROP COLUMN departure_overlap_push;
