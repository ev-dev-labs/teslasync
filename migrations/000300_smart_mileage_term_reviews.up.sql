CREATE TABLE smart_mileage_term_plans (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    time_zone text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 80),
    first_day date NOT NULL,
    end_day date NOT NULL CHECK (end_day > first_day),
    opening_odometer_m double precision NOT NULL CHECK (opening_odometer_m BETWEEN 0 AND 10000000000),
    allowance_m double precision NOT NULL CHECK (allowance_m BETWEEN 1000 AND 10000000),
    minimum_overage_m double precision NOT NULL CHECK (minimum_overage_m BETWEEN 100 AND allowance_m),
    paused boolean NOT NULL,
    next_check_at timestamptz CHECK (NOT paused OR next_check_at IS NULL),
    lease_until timestamptz,
    last_checked_at timestamptz,
    next_cycle_at timestamptz,
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX idx_smart_mileage_term_plans_due ON smart_mileage_term_plans (next_check_at, id)
    WHERE next_check_at IS NOT NULL;

CREATE TABLE smart_mileage_term_digests (
    plan_id bigint PRIMARY KEY REFERENCES smart_mileage_term_plans(id) ON DELETE CASCADE,
    month_through timestamptz NOT NULL,
    checked_at timestamptz NOT NULL CHECK (checked_at >= month_through),
    expires_at timestamptz NOT NULL CHECK (expires_at > checked_at),
    dismissed_at timestamptz CHECK (dismissed_at >= checked_at AND dismissed_at < expires_at),
    evidence_from timestamptz NOT NULL,
    observed_at timestamptz NOT NULL CHECK (observed_at > evidence_from AND observed_at < month_through),
    observed_days integer NOT NULL CHECK (observed_days BETWEEN 8 AND 91),
    used_m double precision NOT NULL CHECK (used_m BETWEEN 0 AND 10000000000),
    allowed_to_date_m double precision NOT NULL CHECK (allowed_to_date_m BETWEEN 0 AND 10000000),
    lower_m double precision NOT NULL CHECK (lower_m BETWEEN used_m AND 14000000000),
    upper_m double precision NOT NULL CHECK (upper_m BETWEEN lower_m AND 14000000000)
);
