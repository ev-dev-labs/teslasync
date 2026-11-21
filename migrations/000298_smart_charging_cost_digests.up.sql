CREATE TABLE smart_charging_cost_plans (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    time_zone text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 80),
    currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$' AND currency <> 'XXX'),
    material_change_minor bigint NOT NULL CHECK (material_change_minor BETWEEN 1 AND 1000000000),
    next_check_at timestamptz,
    lease_until timestamptz,
    last_checked_at timestamptz,
    next_cycle_at timestamptz,
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX idx_smart_charging_cost_plans_due ON smart_charging_cost_plans (next_check_at, id)
    WHERE next_check_at IS NOT NULL;

CREATE TABLE smart_charging_cost_digests (
    plan_id bigint PRIMARY KEY REFERENCES smart_charging_cost_plans(id) ON DELETE CASCADE,
    prior_from timestamptz NOT NULL,
    current_from timestamptz NOT NULL CHECK (current_from > prior_from),
    through timestamptz NOT NULL CHECK (through > current_from),
    checked_at timestamptz NOT NULL CHECK (checked_at >= through),
    expires_at timestamptz NOT NULL CHECK (expires_at > checked_at),
    dismissed_at timestamptz CHECK (dismissed_at >= checked_at AND dismissed_at < expires_at),
    comparable_sites integer NOT NULL CHECK (comparable_sites BETWEEN 1 AND 2048),
    distance_minor bigint NOT NULL,
    purchase_intensity_minor bigint NOT NULL,
    site_mix_minor bigint NOT NULL,
    effective_price_minor bigint NOT NULL,
    unattributed_minor bigint NOT NULL,
    prior_sessions integer NOT NULL CHECK (prior_sessions BETWEEN 4 AND 4096),
    prior_recorded_costs integer NOT NULL CHECK (prior_recorded_costs BETWEEN 4 AND prior_sessions),
    prior_compared_sessions integer NOT NULL CHECK (prior_compared_sessions BETWEEN 4 AND prior_recorded_costs),
    prior_recorded_spend_minor bigint NOT NULL CHECK (prior_recorded_spend_minor >= 0),
    prior_compared_spend_minor bigint NOT NULL CHECK (prior_compared_spend_minor BETWEEN 0 AND prior_recorded_spend_minor),
    prior_distance_m double precision NOT NULL CHECK (prior_distance_m BETWEEN 10000 AND 100000000),
    current_sessions integer NOT NULL CHECK (current_sessions BETWEEN 4 AND 4096),
    current_recorded_costs integer NOT NULL CHECK (current_recorded_costs BETWEEN 4 AND current_sessions),
    current_compared_sessions integer NOT NULL CHECK (current_compared_sessions BETWEEN 4 AND current_recorded_costs),
    current_recorded_spend_minor bigint NOT NULL CHECK (current_recorded_spend_minor >= 0),
    current_compared_spend_minor bigint NOT NULL CHECK (current_compared_spend_minor BETWEEN 0 AND current_recorded_spend_minor),
    current_distance_m double precision NOT NULL CHECK (current_distance_m BETWEEN 10000 AND 100000000)
);
