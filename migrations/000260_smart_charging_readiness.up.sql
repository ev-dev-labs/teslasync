CREATE TABLE IF NOT EXISTS smart_charging_plans (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject            text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id         bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    charging_place_id  bigint REFERENCES geofences(id) ON DELETE SET NULL,
    enabled            boolean NOT NULL DEFAULT false,
    notify_at          timestamptz NOT NULL,
    departure_at       timestamptz NOT NULL,
    trip_use_low_pct   double precision NOT NULL CHECK (trip_use_low_pct BETWEEN 0 AND 100),
    trip_use_high_pct  double precision NOT NULL CHECK (trip_use_high_pct BETWEEN trip_use_low_pct AND 100),
    reserve_pct        double precision NOT NULL CHECK (reserve_pct BETWEEN 0 AND 100),
    snoozed_until      timestamptz,
    next_check_at      timestamptz,
    lease_token        text,
    lease_until        timestamptz,
    version            bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at         timestamptz NOT NULL,
    updated_at         timestamptz NOT NULL,
    CHECK (notify_at < departure_at - INTERVAL '30 minutes'),
    CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);

CREATE INDEX IF NOT EXISTS smart_charging_plans_owner_idx
    ON smart_charging_plans (subject, vehicle_id, departure_at, id);
CREATE INDEX IF NOT EXISTS smart_charging_plans_due_idx
    ON smart_charging_plans (next_check_at, id)
    WHERE enabled AND next_check_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS smart_charging_decisions (
    plan_id           bigint PRIMARY KEY REFERENCES smart_charging_plans(id) ON DELETE CASCADE,
    battery_pct       double precision NOT NULL CHECK (battery_pct BETWEEN 0 AND 100),
    arrival_low_pct   double precision NOT NULL CHECK (arrival_low_pct BETWEEN 0 AND 100),
    arrival_high_pct  double precision NOT NULL CHECK (arrival_high_pct BETWEEN arrival_low_pct AND 100),
    observed_at       timestamptz NOT NULL,
    expires_at        timestamptz NOT NULL,
    evaluated_at      timestamptz NOT NULL,
    CHECK (expires_at > observed_at)
);

COMMENT ON TABLE smart_charging_plans IS
    'Private one-trip readiness plans; activation requires explicit per-plan consent.';
COMMENT ON TABLE smart_charging_decisions IS
    'Short-lived, subject-owned readiness evidence, never a broadcast notification.';
