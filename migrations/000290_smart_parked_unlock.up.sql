CREATE TABLE smart_parked_unlock_plans (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject            text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id         bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    place_id           bigint NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    place_revision     timestamptz NOT NULL,
    evidence_from      timestamptz NOT NULL,
    device_id          bigint NOT NULL,
    device_verified_at timestamptz NOT NULL,
    push_title         text NOT NULL CHECK (char_length(push_title) BETWEEN 1 AND 200),
    push_body          text NOT NULL CHECK (char_length(push_body) BETWEEN 1 AND 200),
    paused             boolean NOT NULL DEFAULT false,
    snoozed_until      timestamptz,
    next_check_at      timestamptz,
    lease_until        timestamptz,
    reason             text NOT NULL CHECK (reason IN (
        'monitoring','place_changed','unknown_state','outside_place','locked','grace_period','parked_unlocked')),
    park_id            bigint CHECK (park_id > 0),
    parked_at          timestamptz,
    unlocked_since     timestamptz CHECK (unlocked_since >= evidence_from AND unlocked_since >= parked_at),
    last_observed_at   timestamptz CHECK (last_observed_at >= unlocked_since + INTERVAL '5 minutes'),
    risk_expires_at    timestamptz CHECK (risk_expires_at > last_observed_at AND risk_expires_at <= parked_at + INTERVAL '30 minutes'),
    CHECK (num_nonnulls(park_id,parked_at,unlocked_since,last_observed_at,risk_expires_at)
        = CASE WHEN reason = 'parked_unlocked' THEN 5 ELSE 0 END),
    CHECK (NOT paused OR (next_check_at IS NULL AND lease_until IS NULL AND snoozed_until IS NULL AND reason = 'monitoring')),
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX smart_parked_unlock_vehicle_idx ON smart_parked_unlock_plans(vehicle_id);
CREATE INDEX smart_parked_unlock_place_idx ON smart_parked_unlock_plans(place_id);
CREATE INDEX smart_parked_unlock_due_idx ON smart_parked_unlock_plans(next_check_at, id) WHERE next_check_at IS NOT NULL;
CREATE INDEX smart_parked_unlock_offer_idx ON smart_parked_unlock_plans(risk_expires_at, id) WHERE park_id IS NOT NULL;

CREATE TABLE smart_push_parked_unlock_deliveries (
    token_hash     bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    subject        text NOT NULL,
    vehicle_id     bigint NOT NULL,
    plan_id        bigint NOT NULL,
    device_id      bigint NOT NULL,
    park_id        bigint NOT NULL,
    unlocked_since timestamptz NOT NULL,
    status         text NOT NULL CHECK (status IN ('dispatching','accepted','failed','unknown')),
    created_at     timestamptz NOT NULL,
    expires_at     timestamptz NOT NULL CHECK (expires_at > created_at),
    claimed_at     timestamptz,
    UNIQUE (subject, vehicle_id, park_id)
);

CREATE INDEX smart_push_parked_unlock_expiry_idx ON smart_push_parked_unlock_deliveries(expires_at);
CREATE INDEX smart_push_parked_unlock_budget_idx ON smart_push_parked_unlock_deliveries(device_id,created_at);
