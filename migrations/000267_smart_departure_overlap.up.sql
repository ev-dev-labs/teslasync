ALTER TABLE smart_charging_plans
    ADD COLUMN service_starts_at timestamptz,
    ADD COLUMN service_ends_at timestamptz,
    ADD COLUMN software_starts_at timestamptz,
    ADD COLUMN software_ends_at timestamptz,
    ADD COLUMN departure_overlap_push boolean NOT NULL DEFAULT false,
    ADD CONSTRAINT smart_charging_service_window_valid CHECK (
        (service_starts_at IS NULL AND service_ends_at IS NULL) OR
        (service_starts_at IS NOT NULL AND service_ends_at IS NOT NULL AND service_starts_at < service_ends_at
         AND service_starts_at >= departure_at - INTERVAL '168 hours'
         AND service_ends_at <= departure_at + INTERVAL '168 hours')
    ) NOT VALID,
    ADD CONSTRAINT smart_charging_software_window_valid CHECK (
        (software_starts_at IS NULL AND software_ends_at IS NULL) OR
        (software_starts_at IS NOT NULL AND software_ends_at IS NOT NULL AND software_starts_at < software_ends_at
         AND software_starts_at >= departure_at - INTERVAL '168 hours'
         AND software_ends_at <= departure_at + INTERVAL '168 hours')
    ) NOT VALID;
ALTER TABLE smart_charging_plans VALIDATE CONSTRAINT smart_charging_service_window_valid;
ALTER TABLE smart_charging_plans VALIDATE CONSTRAINT smart_charging_software_window_valid;

ALTER TABLE smart_charging_decisions DROP CONSTRAINT smart_charging_decisions_kind_valid;
ALTER TABLE smart_charging_decisions ADD CONSTRAINT smart_charging_decisions_kind_valid
    CHECK (kind IN ('plug_in', 'slow_charging', 'trip_review', 'schedule_conflict', 'departure_overlap')) NOT VALID;
ALTER TABLE smart_charging_decisions VALIDATE CONSTRAINT smart_charging_decisions_kind_valid;

ALTER TABLE smart_push_deliveries DROP CONSTRAINT smart_push_deliveries_decision_kind_check;
ALTER TABLE smart_push_deliveries ADD CONSTRAINT smart_push_deliveries_decision_kind_check
    CHECK (decision_kind IN ('plug_in', 'slow_charging', 'trip_review', 'schedule_conflict', 'departure_overlap')) NOT VALID;
ALTER TABLE smart_push_deliveries VALIDATE CONSTRAINT smart_push_deliveries_decision_kind_check;
