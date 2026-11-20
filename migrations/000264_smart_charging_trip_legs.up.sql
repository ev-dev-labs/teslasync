ALTER TABLE smart_charging_plans
    ADD COLUMN IF NOT EXISTS outbound_use_low_pct double precision,
    ADD COLUMN IF NOT EXISTS outbound_use_high_pct double precision,
    ADD COLUMN IF NOT EXISTS return_use_low_pct double precision,
    ADD COLUMN IF NOT EXISTS return_use_high_pct double precision,
    ADD COLUMN IF NOT EXISTS destination_charge_pct double precision;

ALTER TABLE smart_charging_plans
    ADD CONSTRAINT smart_charging_trip_legs_valid CHECK (
        (outbound_use_low_pct IS NULL AND outbound_use_high_pct IS NULL
         AND return_use_low_pct IS NULL AND return_use_high_pct IS NULL
         AND destination_charge_pct IS NULL)
        OR
        (outbound_use_low_pct IS NOT NULL AND outbound_use_high_pct IS NOT NULL
         AND return_use_low_pct IS NOT NULL AND return_use_high_pct IS NOT NULL
         AND outbound_use_low_pct BETWEEN 0 AND 100
         AND outbound_use_high_pct BETWEEN outbound_use_low_pct AND 100
         AND return_use_low_pct BETWEEN 0 AND 100
         AND return_use_high_pct BETWEEN return_use_low_pct AND 100
         AND (destination_charge_pct IS NULL OR destination_charge_pct BETWEEN 0 AND 100))
    ) NOT VALID;

ALTER TABLE smart_charging_plans VALIDATE CONSTRAINT smart_charging_trip_legs_valid;

COMMENT ON COLUMN smart_charging_plans.destination_charge_pct IS
    'User-planned battery percentage to add at the destination, not an observed or guaranteed charge.';

ALTER TABLE smart_charging_decisions
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'plug_in';

UPDATE smart_charging_decisions d SET kind = 'slow_charging'
FROM smart_charging_slow_samples s, smart_charging_plans p
WHERE s.plan_id = d.plan_id AND p.id = d.plan_id AND s.plan_version = p.version
  AND s.last_seen_at = d.evaluated_at
  AND s.first_seen_at <= d.evaluated_at - INTERVAL '5 minutes';

ALTER TABLE smart_charging_decisions
    ADD CONSTRAINT smart_charging_decisions_kind_valid
    CHECK (kind IN ('plug_in', 'slow_charging', 'trip_review')) NOT VALID;
ALTER TABLE smart_charging_decisions VALIDATE CONSTRAINT smart_charging_decisions_kind_valid;

ALTER TABLE smart_push_deliveries DROP CONSTRAINT IF EXISTS smart_push_deliveries_decision_kind_check;
ALTER TABLE smart_push_deliveries ADD CONSTRAINT smart_push_deliveries_decision_kind_check
    CHECK (decision_kind IN ('plug_in', 'slow_charging', 'trip_review')) NOT VALID;
ALTER TABLE smart_push_deliveries VALIDATE CONSTRAINT smart_push_deliveries_decision_kind_check;
