CREATE TABLE smart_park_reserve_plans (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject         text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id      bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    return_at       timestamptz NOT NULL,
    reserve_pct     double precision NOT NULL CHECK (reserve_pct BETWEEN 5 AND 90),
    created_at      timestamptz NOT NULL,
    action_until    timestamptz NOT NULL CHECK (action_until > created_at AND action_until < return_at),
    device_id       bigint,
    device_verified_at timestamptz,
    push_title      text CHECK (char_length(push_title) BETWEEN 1 AND 200),
    push_body       text CHECK (char_length(push_body) BETWEEN 1 AND 200),
    next_check_at   timestamptz,
    lease_until     timestamptz,
    reason          text CHECK (reason IN (
        'invalid_plan', 'unknown_state', 'insufficient_comparable_parks', 'reserve_not_crossed',
        'already_below_reserve', 'estimated_reserve_crossing', 'park_conditions_changed', 'expired')),
    estimate_at     timestamptz,
    comparable_episodes integer CHECK (comparable_episodes BETWEEN 3 AND 12),
    start_battery_pct double precision CHECK (start_battery_pct BETWEEN 0 AND 100),
    return_low_pct  integer CHECK (return_low_pct BETWEEN 0 AND 100),
    return_high_pct integer CHECK (return_high_pct BETWEEN return_low_pct AND 100),
    outside_c       double precision CHECK (outside_c BETWEEN -45 AND 60),
    sentry_mode     text CHECK (sentry_mode IN ('Off', 'Armed')),
    CHECK (num_nonnulls(device_id, device_verified_at, push_title, push_body) IN (0, 4)),
    CHECK (num_nonnulls(estimate_at, comparable_episodes, start_battery_pct, return_low_pct, return_high_pct, outside_c, sentry_mode) IN (0, 7)),
    CHECK ((estimate_at IS NOT NULL) = COALESCE(reason IN ('reserve_not_crossed', 'already_below_reserve', 'estimated_reserve_crossing'), false)),
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX smart_park_reserve_plans_due_idx
    ON smart_park_reserve_plans (next_check_at, id) WHERE next_check_at IS NOT NULL;
CREATE INDEX smart_park_reserve_plans_vehicle_idx ON smart_park_reserve_plans (vehicle_id);
CREATE INDEX smart_park_reserve_plans_offer_idx
    ON smart_park_reserve_plans (action_until, id) WHERE reason = 'estimated_reserve_crossing' AND device_id IS NOT NULL;

CREATE TABLE smart_push_park_reserve_deliveries (
    token_hash  bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    subject     text NOT NULL,
    vehicle_id  bigint NOT NULL,
    return_at   timestamptz NOT NULL,
    plan_id     bigint NOT NULL,
    device_id   bigint NOT NULL,
    status      text NOT NULL CHECK (status IN ('dispatching', 'accepted', 'failed', 'unknown')),
    created_at  timestamptz NOT NULL,
    expires_at  timestamptz NOT NULL CHECK (expires_at > created_at AND expires_at < return_at),
    claimed_at  timestamptz,
    UNIQUE (subject, vehicle_id, return_at)
);

CREATE INDEX smart_push_park_reserve_device_idx ON smart_push_park_reserve_deliveries (device_id, created_at DESC);
CREATE INDEX smart_push_park_reserve_expiry_idx ON smart_push_park_reserve_deliveries (expires_at);
