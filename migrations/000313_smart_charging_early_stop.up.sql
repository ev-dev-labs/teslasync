ALTER TABLE smart_charging_plans ADD COLUMN early_stop_watch boolean NOT NULL DEFAULT false;

ALTER TABLE smart_charging_decisions ADD COLUMN interrupted_at timestamptz;
ALTER TABLE smart_charging_decisions DROP CONSTRAINT smart_charging_decisions_kind_valid;
ALTER TABLE smart_charging_decisions ADD CONSTRAINT smart_charging_decisions_kind_valid
    CHECK (kind IN ('plug_in', 'slow_charging', 'trip_review', 'schedule_conflict', 'departure_overlap', 'early_stop')) NOT VALID;
ALTER TABLE smart_charging_decisions VALIDATE CONSTRAINT smart_charging_decisions_kind_valid;
ALTER TABLE smart_charging_decisions ADD CONSTRAINT smart_charging_decisions_interruption_check
    CHECK (kind <> 'early_stop' OR interrupted_at IS NOT NULL);

ALTER TABLE smart_push_deliveries ADD COLUMN interrupted_at timestamptz;
ALTER TABLE smart_push_deliveries DROP CONSTRAINT smart_push_deliveries_decision_kind_check;
ALTER TABLE smart_push_deliveries ADD CONSTRAINT smart_push_deliveries_decision_kind_check
    CHECK (decision_kind IN ('plug_in', 'slow_charging', 'trip_review', 'schedule_conflict', 'departure_overlap', 'early_stop')) NOT VALID;
ALTER TABLE smart_push_deliveries VALIDATE CONSTRAINT smart_push_deliveries_decision_kind_check;
ALTER TABLE smart_push_deliveries ADD CONSTRAINT smart_push_deliveries_interruption_check
    CHECK ((decision_kind = 'early_stop') = (interrupted_at IS NOT NULL));

CREATE OR REPLACE VIEW smart_charging_candidate_decisions AS
SELECT plan_id, battery_pct, arrival_low_pct, arrival_high_pct, observed_at, expires_at, evaluated_at, kind,
       CASE WHEN kind = 'early_stop' THEN interrupted_at END AS interrupted_at
FROM smart_charging_decisions
WHERE kind <> 'departure_overlap'
UNION ALL
SELECT plan_id, 0::double precision, 0::double precision, 0::double precision,
       observed_at, expires_at, evaluated_at, 'departure_overlap', NULL::timestamptz
FROM smart_charging_departure_conflicts;

DROP INDEX smart_push_deliveries_occurrence_family_idx;
CREATE UNIQUE INDEX smart_push_deliveries_occurrence_family_idx ON smart_push_deliveries
    (device_id, plan_id, departure_at,
     (CASE WHEN decision_kind IN ('departure_overlap', 'early_stop') THEN decision_kind ELSE 'readiness' END));
