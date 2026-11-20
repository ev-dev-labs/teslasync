CREATE TABLE IF NOT EXISTS smart_push_devices (
    id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject                  text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    endpoint_hash            bytea NOT NULL UNIQUE CHECK (octet_length(endpoint_hash) = 32),
    subscription_ciphertext  text NOT NULL,
    verification_hash        bytea CHECK (verification_hash IS NULL OR octet_length(verification_hash) = 32),
    verification_expires_at  timestamptz,
    verified_at              timestamptz,
    charging_enabled         boolean NOT NULL DEFAULT false,
    verification_title       text NOT NULL,
    verification_body        text NOT NULL,
    charging_title           text NOT NULL,
    charging_body            text NOT NULL,
    created_at               timestamptz NOT NULL,
    updated_at               timestamptz NOT NULL,
    CHECK ((verification_hash IS NULL) = (verification_expires_at IS NULL)),
    CHECK (NOT charging_enabled OR verified_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS smart_push_devices_subject_idx
    ON smart_push_devices (subject, id);

CREATE TABLE IF NOT EXISTS smart_push_deliveries (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id      bigint NOT NULL REFERENCES smart_push_devices(id) ON DELETE CASCADE,
    plan_id        bigint NOT NULL REFERENCES smart_charging_plans(id) ON DELETE CASCADE,
    plan_version   bigint NOT NULL,
    departure_at   timestamptz NOT NULL,
    place_updated_at timestamptz NOT NULL,
    decision_kind  text NOT NULL CHECK (decision_kind IN ('plug_in', 'slow_charging')),
    token_hash     bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    status         text NOT NULL CHECK (status IN ('dispatching', 'accepted', 'failed', 'unknown')),
    created_at     timestamptz NOT NULL,
    expires_at     timestamptz NOT NULL,
    claimed_at     timestamptz,
    revoked_at     timestamptz,
    UNIQUE (device_id, plan_id, departure_at),
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS smart_push_deliveries_device_time_idx
    ON smart_push_deliveries (device_id, created_at DESC);

COMMENT ON TABLE smart_push_devices IS
    'Subject-owned verified browser push subscriptions; endpoint and keys are encrypted at rest.';
COMMENT ON TABLE smart_push_deliveries IS
    'At-most-one dispatch attempt per device and trip occurrence; provider acceptance is not proof of delivery.';
