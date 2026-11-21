CREATE TABLE IF NOT EXISTS smart_charging_slow_samples (
    plan_id       bigint PRIMARY KEY REFERENCES smart_charging_plans(id) ON DELETE CASCADE,
    plan_version  bigint NOT NULL CHECK (plan_version > 0),
    first_seen_at timestamptz NOT NULL,
    last_seen_at  timestamptz NOT NULL,
    CHECK (last_seen_at >= first_seen_at)
);

COMMENT ON TABLE smart_charging_slow_samples IS
    'Consecutive fresh feasibility checks for an explicitly enabled charging plan.';
