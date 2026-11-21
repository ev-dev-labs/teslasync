DELETE FROM smart_push_deliveries WHERE decision_kind = 'early_stop';
DELETE FROM smart_charging_decisions WHERE kind = 'early_stop';

DROP INDEX smart_push_deliveries_occurrence_family_idx;
CREATE UNIQUE INDEX smart_push_deliveries_occurrence_family_idx ON smart_push_deliveries
    (device_id, plan_id, departure_at, (decision_kind = 'departure_overlap'));

DROP VIEW smart_charging_candidate_decisions;
CREATE VIEW smart_charging_candidate_decisions AS
SELECT plan_id, battery_pct, arrival_low_pct, arrival_high_pct, observed_at, expires_at, evaluated_at, kind
FROM smart_charging_decisions
WHERE kind <> 'departure_overlap'
UNION ALL
SELECT plan_id, 0::double precision, 0::double precision, 0::double precision,
       observed_at, expires_at, evaluated_at, 'departure_overlap'
FROM smart_charging_departure_conflicts;

ALTER TABLE smart_push_deliveries DROP COLUMN interrupted_at;
ALTER TABLE smart_push_deliveries DROP CONSTRAINT smart_push_deliveries_decision_kind_check;
ALTER TABLE smart_push_deliveries ADD CONSTRAINT smart_push_deliveries_decision_kind_check
    CHECK (decision_kind IN ('plug_in', 'slow_charging', 'trip_review', 'schedule_conflict', 'departure_overlap')) NOT VALID;
ALTER TABLE smart_push_deliveries VALIDATE CONSTRAINT smart_push_deliveries_decision_kind_check;

ALTER TABLE smart_charging_decisions DROP COLUMN interrupted_at;
ALTER TABLE smart_charging_decisions DROP CONSTRAINT smart_charging_decisions_kind_valid;
ALTER TABLE smart_charging_decisions ADD CONSTRAINT smart_charging_decisions_kind_valid
    CHECK (kind IN ('plug_in', 'slow_charging', 'trip_review', 'schedule_conflict', 'departure_overlap')) NOT VALID;
ALTER TABLE smart_charging_decisions VALIDATE CONSTRAINT smart_charging_decisions_kind_valid;

ALTER TABLE smart_charging_plans DROP COLUMN early_stop_watch;
