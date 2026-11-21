CREATE TABLE smart_cabin_prep_plans (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject                 text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id              bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    departure_at            timestamptz NOT NULL,
    time_zone               text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 100),
    target_c                double precision NOT NULL CHECK (target_c BETWEEN 16 AND 29),
    device_id               bigint NOT NULL REFERENCES smart_push_devices(id) ON DELETE CASCADE,
    device_verified_at      timestamptz NOT NULL,
    push_title              text NOT NULL CHECK (char_length(push_title) BETWEEN 1 AND 200),
    push_body               text NOT NULL CHECK (char_length(push_body) BETWEEN 1 AND 200),
    created_at              timestamptz NOT NULL CHECK (created_at < departure_at),
    next_check_at           timestamptz CHECK (next_check_at < departure_at),
    lease_until             timestamptz,
    reason                  text CHECK (reason IN (
        'eligible', 'invalid_plan', 'unknown_state', 'already_active', 'within_comfort_band',
        'insufficient_comparable_mornings', 'variable_prep_time', 'departure_observed', 'changed_conditions', 'expired')),
    comparable_mornings     integer CHECK (comparable_mornings BETWEEN 3 AND 12),
    lead_low_s              integer CHECK (lead_low_s BETWEEN 120 AND 2100),
    lead_high_s             integer CHECK (lead_high_s BETWEEN lead_low_s AND 2220),
    estimate_at             timestamptz,
    baseline_cabin_c        double precision CHECK (baseline_cabin_c BETWEEN -45 AND 80),
    baseline_outside_c      double precision CHECK (baseline_outside_c BETWEEN -45 AND 60),
    expires_at              timestamptz CHECK (expires_at < departure_at),
    CHECK ((reason IS NULL) = (next_check_at IS NOT NULL)),
    CHECK ((reason IS NOT DISTINCT FROM 'eligible') = (expires_at IS NOT NULL)),
    CHECK (num_nonnulls(comparable_mornings,lead_low_s,lead_high_s,estimate_at,baseline_cabin_c,baseline_outside_c) IN (0,6)),
    CHECK (expires_at IS NULL OR estimate_at IS NOT NULL),
    UNIQUE (subject,vehicle_id)
);

CREATE INDEX smart_cabin_prep_due_idx ON smart_cabin_prep_plans (next_check_at,id) WHERE next_check_at IS NOT NULL;
CREATE INDEX smart_cabin_prep_device_idx ON smart_cabin_prep_plans (device_id);
CREATE INDEX smart_cabin_prep_offer_idx ON smart_cabin_prep_plans (expires_at,id) WHERE expires_at IS NOT NULL;

CREATE TABLE smart_push_cabin_prep_deliveries (
    subject        text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id     bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    departure_at   timestamptz NOT NULL,
    plan_id        bigint NOT NULL CHECK (plan_id > 0),
    device_id      bigint REFERENCES smart_push_devices(id) ON DELETE SET NULL,
    token_hash     bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    status         text NOT NULL CHECK (status IN ('dispatching','accepted','failed','unknown')),
    created_at     timestamptz NOT NULL,
    expires_at     timestamptz NOT NULL CHECK (expires_at > created_at AND expires_at < departure_at),
    claimed_at     timestamptz,
    PRIMARY KEY (subject,vehicle_id,departure_at)
);

CREATE INDEX smart_push_cabin_prep_device_idx ON smart_push_cabin_prep_deliveries (device_id,created_at DESC);
CREATE INDEX smart_push_cabin_prep_expiry_idx ON smart_push_cabin_prep_deliveries (expires_at);
