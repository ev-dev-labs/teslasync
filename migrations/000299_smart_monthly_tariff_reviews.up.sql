CREATE TABLE smart_monthly_tariff_plans (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    site_id bigint NOT NULL CHECK (site_id > 0),
    site_revision timestamptz NOT NULL,
    current_tariff_id bigint NOT NULL CHECK (current_tariff_id > 0),
    current_version integer NOT NULL CHECK (current_version > 0),
    alternative_tariff_id bigint NOT NULL CHECK (alternative_tariff_id > 0 AND alternative_tariff_id <> current_tariff_id),
    alternative_version integer NOT NULL CHECK (alternative_version > 0),
    time_zone text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 80),
    minimum_savings_minor bigint NOT NULL CHECK (minimum_savings_minor BETWEEN 1 AND 1000000000),
    switch_fee_minor bigint NOT NULL CHECK (switch_fee_minor BETWEEN 0 AND 1000000000),
    next_check_at timestamptz,
    lease_until timestamptz,
    last_checked_at timestamptz,
    next_cycle_at timestamptz,
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX idx_smart_monthly_tariff_plans_due ON smart_monthly_tariff_plans (next_check_at, id)
    WHERE next_check_at IS NOT NULL;

CREATE TABLE smart_monthly_tariff_digests (
    plan_id bigint PRIMARY KEY REFERENCES smart_monthly_tariff_plans(id) ON DELETE CASCADE,
    month_from timestamptz NOT NULL,
    month_through timestamptz NOT NULL CHECK (month_through > month_from),
    checked_at timestamptz NOT NULL CHECK (checked_at >= month_through),
    expires_at timestamptz NOT NULL CHECK (expires_at > checked_at),
    dismissed_at timestamptz CHECK (dismissed_at >= checked_at AND dismissed_at < expires_at),
    days integer NOT NULL CHECK (days BETWEEN 28 AND 31),
    sessions integer NOT NULL CHECK (sessions BETWEEN 4 AND 512),
    energy_wh double precision NOT NULL CHECK (energy_wh BETWEEN 400 AND 512000000),
    current_low_minor bigint NOT NULL CHECK (current_low_minor >= 0),
    current_high_minor bigint NOT NULL CHECK (current_high_minor >= current_low_minor),
    alt_low_minor bigint NOT NULL CHECK (alt_low_minor >= 0),
    alt_high_minor bigint NOT NULL CHECK (alt_high_minor >= alt_low_minor),
    current_fixed_minor bigint NOT NULL CHECK (current_fixed_minor >= 0),
    alt_fixed_minor bigint NOT NULL CHECK (alt_fixed_minor >= 0),
    saving_low_minor bigint NOT NULL CHECK (saving_low_minor > 0),
    saving_high_minor bigint NOT NULL CHECK (saving_high_minor >= saving_low_minor)
);
