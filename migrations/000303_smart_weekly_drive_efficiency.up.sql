CREATE TABLE smart_weekly_drive_efficiency_plans (
    subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    revision bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    time_zone text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 80),
    next_check_at timestamptz,
    lease_until timestamptz,
    last_week date,
    PRIMARY KEY (subject, vehicle_id),
    CHECK (next_check_at IS NOT NULL OR lease_until IS NULL)
);

CREATE INDEX idx_smart_weekly_drive_efficiency_due
    ON smart_weekly_drive_efficiency_plans (next_check_at, revision) WHERE next_check_at IS NOT NULL;

CREATE TABLE smart_weekly_drive_efficiency_digests (
    plan_revision bigint PRIMARY KEY REFERENCES smart_weekly_drive_efficiency_plans(revision) ON DELETE CASCADE,
    reference_drive_id bigint NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
    baseline_from timestamptz NOT NULL,
    recent_from timestamptz NOT NULL,
    recent_until timestamptz NOT NULL,
    observed_until timestamptz NOT NULL,
    published_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    baseline_days integer NOT NULL CHECK (baseline_days BETWEEN 4 AND 42),
    recent_days integer NOT NULL CHECK (recent_days BETWEEN 4 AND 7),
    baseline_low_wh_per_m double precision NOT NULL CHECK (baseline_low_wh_per_m > 0),
    baseline_high_wh_per_m double precision NOT NULL CHECK (baseline_high_wh_per_m BETWEEN baseline_low_wh_per_m AND 1),
    recent_low_wh_per_m double precision NOT NULL CHECK (recent_low_wh_per_m > 0),
    recent_high_wh_per_m double precision NOT NULL CHECK (recent_high_wh_per_m BETWEEN recent_low_wh_per_m AND 1),
    higher boolean NOT NULL,
    dismissed_at timestamptz,
    CHECK (baseline_from < recent_from AND recent_from < observed_until AND observed_until < recent_until
        AND recent_until < published_at AND published_at < expires_at),
    CHECK (dismissed_at IS NULL OR dismissed_at >= published_at)
);
