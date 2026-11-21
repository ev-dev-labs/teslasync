CREATE TABLE IF NOT EXISTS smart_warranty_reminders (
    warranty_id      bigint PRIMARY KEY REFERENCES vehicle_warranties(id) ON DELETE CASCADE,
    generation       bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    enabled_at       timestamptz NOT NULL,
    next_check_at    timestamptz NOT NULL,
    lease_until      timestamptz,
    published_at     timestamptz CHECK (published_at >= enabled_at),
    evidence_from    timestamptz,
    recorded_at      timestamptz,
    observed_days    integer,
    remaining_m      double precision,
    pace_mps         double precision,
    earliest_at      timestamptz,
    latest_at        timestamptz,
    term_end         timestamptz,
    expires_at       timestamptz,
    CHECK (
        num_nonnulls(evidence_from, recorded_at, observed_days, remaining_m, pace_mps, earliest_at, latest_at, term_end, expires_at) = 0
        OR (
            num_nonnulls(evidence_from, recorded_at, observed_days, remaining_m, pace_mps, earliest_at, latest_at, term_end, expires_at) = 9
            AND evidence_from < recorded_at AND observed_days >= 8
            AND remaining_m > 0 AND pace_mps > 0 AND earliest_at < latest_at AND latest_at < term_end
            AND recorded_at < expires_at AND expires_at < earliest_at
        )
    )
);

CREATE INDEX IF NOT EXISTS smart_warranty_reminders_due_idx
    ON smart_warranty_reminders(next_check_at, warranty_id);
