CREATE TABLE IF NOT EXISTS smart_capacity_trend_plans (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject        text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id     bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    time_zone      text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 80),
    next_check_at  timestamptz,
    lease_until    timestamptz,
    last_digest_expiry_at timestamptz,
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_smart_capacity_trend_plans_due
    ON smart_capacity_trend_plans (next_check_at, id) WHERE next_check_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS smart_capacity_trend_digests (
    plan_id           bigint PRIMARY KEY REFERENCES smart_capacity_trend_plans(id) ON DELETE CASCADE,
    baseline_from     timestamptz NOT NULL,
    recent_from       timestamptz NOT NULL CHECK (recent_from > baseline_from),
    recent_to         timestamptz NOT NULL CHECK (recent_to > recent_from),
    observed_to       timestamptz NOT NULL CHECK (observed_to >= recent_from AND observed_to < recent_to),
    expires_at        timestamptz NOT NULL CHECK (expires_at > recent_to),
    baseline_low_wh   double precision NOT NULL CHECK (baseline_low_wh BETWEEN 10000 AND 1000000),
    baseline_high_wh  double precision NOT NULL CHECK (baseline_high_wh BETWEEN baseline_low_wh AND 1000000),
    recent_low_wh     double precision NOT NULL CHECK (recent_low_wh BETWEEN 10000 AND 1000000),
    recent_high_wh    double precision NOT NULL CHECK (recent_high_wh BETWEEN recent_low_wh AND 1000000),
    baseline_days     smallint NOT NULL CHECK (baseline_days BETWEEN 8 AND 31),
    recent_days       smallint NOT NULL CHECK (recent_days BETWEEN 8 AND 31),
    session_ids       bigint[] NOT NULL CHECK (cardinality(session_ids) = baseline_days + recent_days),
    sample_starts     timestamptz[] NOT NULL CHECK (cardinality(sample_starts) = cardinality(session_ids)),
    sample_ends       timestamptz[] NOT NULL CHECK (cardinality(sample_ends) = cardinality(session_ids)),
    dismissed_at      timestamptz CHECK (dismissed_at BETWEEN recent_to AND expires_at)
);
