CREATE TABLE smart_public_charging_fee_terms (
    subject                  text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id               bigint      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    place_id                 bigint      NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    place_updated_at         timestamptz NOT NULL,
    confirmed_unconditional  boolean     NOT NULL CHECK (confirmed_unconditional),
    currency                 text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$' AND currency <> 'XXX'),
    fee_per_minute_minor      bigint      NOT NULL CHECK (fee_per_minute_minor BETWEEN 1 AND 100000),
    grace_s                  integer     NOT NULL CHECK (grace_s BETWEEN 120 AND 3600),
    source_url               text        NOT NULL CHECK (length(source_url) BETWEEN 1 AND 1024),
    confirmed_at             timestamptz NOT NULL,
    valid_until              timestamptz NOT NULL CHECK (valid_until > confirmed_at AND valid_until <= confirmed_at + INTERVAL '720 hours'),
    push_device_id          bigint      REFERENCES smart_push_devices(id) ON DELETE SET NULL,
    push_device_verified_at timestamptz,
    push_title               text        CHECK (char_length(push_title) BETWEEN 1 AND 200),
    push_body                text        CHECK (char_length(push_body) BETWEEN 1 AND 200),
    CHECK (push_device_id IS NULL OR (push_device_verified_at IS NOT NULL AND push_title IS NOT NULL AND push_body IS NOT NULL)),
    PRIMARY KEY (subject, vehicle_id)
);

CREATE INDEX smart_public_fee_push_due_idx ON smart_public_charging_fee_terms (valid_until) WHERE push_device_id IS NOT NULL;
CREATE INDEX smart_public_fee_push_device_idx ON smart_public_charging_fee_terms (push_device_id) WHERE push_device_id IS NOT NULL;

CREATE TABLE smart_push_public_fee_deliveries (
    subject          text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    device_id        bigint      REFERENCES smart_push_devices(id) ON DELETE SET NULL,
    vehicle_id       bigint      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    place_id         bigint      NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    place_updated_at timestamptz NOT NULL,
    confirmed_at     timestamptz NOT NULL,
    session_id       bigint      NOT NULL CHECK (session_id > 0),
    token_hash       bytea       NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    status           text        NOT NULL CHECK (status IN ('dispatching', 'accepted', 'failed', 'unknown')),
    created_at       timestamptz NOT NULL,
    expires_at       timestamptz NOT NULL CHECK (expires_at > created_at),
    claimed_at       timestamptz,
    PRIMARY KEY (subject, vehicle_id, session_id)
);

CREATE INDEX smart_push_public_fee_device_time_idx ON smart_push_public_fee_deliveries (device_id, created_at DESC);
CREATE INDEX smart_push_public_fee_expiry_idx ON smart_push_public_fee_deliveries (expires_at);
