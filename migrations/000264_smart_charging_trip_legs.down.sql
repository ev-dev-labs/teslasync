-- Older binaries cannot safely claim trip-review delivery tokens.
DELETE FROM smart_push_deliveries WHERE decision_kind = 'trip_review';
ALTER TABLE smart_push_deliveries DROP CONSTRAINT IF EXISTS smart_push_deliveries_decision_kind_check;
ALTER TABLE smart_push_deliveries ADD CONSTRAINT smart_push_deliveries_decision_kind_check
    CHECK (decision_kind IN ('plug_in', 'slow_charging')) NOT VALID;
ALTER TABLE smart_push_deliveries VALIDATE CONSTRAINT smart_push_deliveries_decision_kind_check;
ALTER TABLE smart_charging_decisions DROP CONSTRAINT IF EXISTS smart_charging_decisions_kind_valid;
ALTER TABLE smart_charging_decisions DROP COLUMN IF EXISTS kind;
ALTER TABLE smart_charging_plans DROP CONSTRAINT IF EXISTS smart_charging_trip_legs_valid;
ALTER TABLE smart_charging_plans
    DROP COLUMN IF EXISTS destination_charge_pct,
    DROP COLUMN IF EXISTS return_use_high_pct,
    DROP COLUMN IF EXISTS return_use_low_pct,
    DROP COLUMN IF EXISTS outbound_use_high_pct,
    DROP COLUMN IF EXISTS outbound_use_low_pct;
