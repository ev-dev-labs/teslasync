CREATE TABLE IF NOT EXISTS smart_overnight_drain_plans (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject        text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id     bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    time_zone      text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 80),
    next_check_at  timestamptz,
    lease_until    timestamptz,
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_smart_overnight_drain_plans_due
    ON smart_overnight_drain_plans (next_check_at, id) WHERE next_check_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS smart_overnight_drain_reviews (
    plan_id             bigint PRIMARY KEY REFERENCES smart_overnight_drain_plans(id) ON DELETE CASCADE,
    morning_at          timestamptz NOT NULL,
    expires_at          timestamptz NOT NULL CHECK (expires_at > morning_at),
    start_at            timestamptz NOT NULL,
    end_at              timestamptz NOT NULL CHECK (end_at > start_at AND end_at <= morning_at),
    measured_loss_pct   double precision NOT NULL CHECK (measured_loss_pct BETWEEN 0 AND 100),
    typical_low_pct     double precision NOT NULL CHECK (typical_low_pct >= 0),
    typical_high_pct    double precision NOT NULL CHECK (typical_high_pct >= typical_low_pct AND typical_high_pct < measured_loss_pct),
    baseline_starts     timestamptz[] NOT NULL CHECK (cardinality(baseline_starts) BETWEEN 4 AND 14),
    baseline_ends       timestamptz[] NOT NULL CHECK (cardinality(baseline_ends) = cardinality(baseline_starts)),
    sentry_at           timestamptz CHECK (sentry_at BETWEEN start_at AND end_at),
    climate_at          timestamptz CHECK (climate_at BETWEEN start_at AND end_at),
    wake_request_at     timestamptz CHECK (wake_request_at BETWEEN start_at AND end_at),
    dismissed_at        timestamptz CHECK (dismissed_at BETWEEN morning_at AND expires_at),
    CHECK (num_nonnulls(sentry_at, climate_at, wake_request_at) > 0)
);
