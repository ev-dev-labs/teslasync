ALTER TABLE smart_push_devices
    ADD COLUMN commute_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN commute_title text,
    ADD COLUMN commute_body text,
    ADD CHECK (NOT commute_enabled OR
        (verified_at IS NOT NULL AND commute_title IS NOT NULL AND commute_body IS NOT NULL));

CREATE UNIQUE INDEX smart_push_devices_commute_recipient_idx
    ON smart_push_devices (subject) WHERE commute_enabled;

CREATE TABLE smart_push_commute_deliveries (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id     bigint NOT NULL REFERENCES smart_push_devices(id) ON DELETE CASCADE,
    routine_id    bigint NOT NULL REFERENCES smart_commute_routines(id) ON DELETE CASCADE,
    consent_id    bigint NOT NULL,
    departure_at  timestamptz NOT NULL,
    token_hash    bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    status        text NOT NULL CHECK (status IN ('dispatching', 'accepted', 'failed', 'unknown')),
    created_at    timestamptz NOT NULL,
    expires_at    timestamptz NOT NULL,
    claimed_at    timestamptz,
    revoked_at    timestamptz,
    UNIQUE (routine_id, departure_at),
    CHECK (expires_at > created_at AND expires_at <= departure_at)
);

CREATE INDEX smart_push_commute_deliveries_device_time_idx
    ON smart_push_commute_deliveries (device_id, created_at DESC);

COMMENT ON COLUMN smart_push_commute_deliveries.consent_id IS
    'Binds the claim to its original consent; keep attempt history for deduplication and the shared budget after revocation.';
