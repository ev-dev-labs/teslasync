CREATE TABLE smart_drive_track_reviews (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject         text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    drive_id        bigint NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
    vehicle_id      bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    started_at      timestamptz NOT NULL,
    ended_at        timestamptz NOT NULL CHECK (ended_at > started_at AND ended_at <= started_at + INTERVAL '24 hours'),
    selected_at     timestamptz NOT NULL CHECK (selected_at >= started_at AND selected_at < ended_at),
    confirmed_at    timestamptz NOT NULL CHECK (confirmed_at >= ended_at),
    expires_at      timestamptz NOT NULL CHECK (expires_at > confirmed_at AND expires_at <= confirmed_at + INTERVAL '30 minutes'),
    grant_revision  bigint NOT NULL DEFAULT 0 CHECK (grant_revision >= 0),
    state_hash      bytea UNIQUE CHECK (state_hash IS NULL OR octet_length(state_hash) = 32),
    verifier_cipher text,
    state_expires_at timestamptz,
    token_cipher    text,
    token_expires_at timestamptz,
    save_status     text NOT NULL DEFAULT 'review' CHECK (save_status IN ('review','saving','saved','rejected','unknown')),
    claimed_at      timestamptz,
    CHECK ((state_hash IS NULL) = (verifier_cipher IS NULL)),
    CHECK (state_hash IS NULL OR state_expires_at IS NOT NULL),
    CHECK ((token_cipher IS NULL) = (token_expires_at IS NULL)),
    CHECK (token_expires_at IS NULL OR token_expires_at <= expires_at),
    CHECK ((save_status = 'review') = (claimed_at IS NULL)),
    UNIQUE (subject, drive_id)
);

CREATE INDEX smart_drive_track_reviews_drive_idx ON smart_drive_track_reviews(drive_id);
CREATE INDEX smart_drive_track_reviews_vehicle_idx ON smart_drive_track_reviews(vehicle_id);
