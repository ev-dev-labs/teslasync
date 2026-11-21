CREATE TABLE IF NOT EXISTS smart_climate_schedule_plans (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject            text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id         bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    automation_id      bigint NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
    schedule_revision  timestamptz NOT NULL,
    enabled_at         timestamptz NOT NULL,
    next_check_at      timestamptz NOT NULL,
    lease_until        timestamptz,
    last_review_week   timestamptz,
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_smart_climate_schedule_plans_due
    ON smart_climate_schedule_plans (next_check_at, id);
CREATE INDEX IF NOT EXISTS idx_smart_climate_schedule_plans_automation
    ON smart_climate_schedule_plans (automation_id);

CREATE TABLE IF NOT EXISTS smart_climate_schedule_receipts (
    plan_id     bigint NOT NULL REFERENCES smart_climate_schedule_plans(id) ON DELETE CASCADE,
    history_id  bigint NOT NULL REFERENCES automation_history(id) ON DELETE CASCADE,
    fired_at    timestamptz NOT NULL,
    PRIMARY KEY (plan_id, history_id)
);

CREATE INDEX IF NOT EXISTS idx_smart_climate_schedule_receipts_plan
    ON smart_climate_schedule_receipts (plan_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_smart_climate_schedule_receipts_history
    ON smart_climate_schedule_receipts (history_id);

CREATE TABLE IF NOT EXISTS smart_climate_schedule_reviews (
    plan_id           bigint PRIMARY KEY REFERENCES smart_climate_schedule_plans(id) ON DELETE CASCADE,
    week_of           timestamptz NOT NULL,
    expires_at        timestamptz NOT NULL CHECK (expires_at > week_of),
    observed_through  timestamptz NOT NULL CHECK (observed_through >= week_of AND observed_through < expires_at),
    run_times         timestamptz[] NOT NULL CHECK (cardinality(run_times) BETWEEN 3 AND 6)
);
