CREATE TABLE smart_charging_departure_conflicts (
    plan_id      bigint PRIMARY KEY REFERENCES smart_charging_plans(id) ON DELETE CASCADE,
    observed_at  timestamptz NOT NULL,
    expires_at   timestamptz NOT NULL CHECK (expires_at > observed_at),
    evaluated_at timestamptz NOT NULL
);

INSERT INTO smart_charging_departure_conflicts (plan_id, observed_at, expires_at, evaluated_at)
SELECT plan_id, observed_at, expires_at, evaluated_at
FROM smart_charging_decisions
WHERE kind = 'departure_overlap';

CREATE VIEW smart_charging_candidate_decisions AS
SELECT plan_id, battery_pct, arrival_low_pct, arrival_high_pct, observed_at, expires_at, evaluated_at, kind
FROM smart_charging_decisions
WHERE kind <> 'departure_overlap'
UNION ALL
SELECT plan_id, 0::double precision, 0::double precision, 0::double precision,
       observed_at, expires_at, evaluated_at, 'departure_overlap'
FROM smart_charging_departure_conflicts;

CREATE UNIQUE INDEX IF NOT EXISTS smart_push_deliveries_occurrence_family_idx ON smart_push_deliveries
    (device_id, plan_id, departure_at, (decision_kind = 'departure_overlap'));
ALTER TABLE smart_push_deliveries
    DROP CONSTRAINT IF EXISTS smart_push_deliveries_device_id_plan_id_departure_at_key;

COMMENT ON TABLE smart_push_deliveries IS
    'At most one attempt per device, trip occurrence and advice family; all attempts share the personal delivery budget.';
