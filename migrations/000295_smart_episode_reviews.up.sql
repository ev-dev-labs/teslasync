CREATE TABLE smart_episode_reviews (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject           text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id        bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    confirmed_at      timestamptz NOT NULL,
    departure_at      timestamptz NOT NULL CHECK (
        departure_at > confirmed_at AND departure_at <= confirmed_at + INTERVAL '24 hours'),
    drive_duration_s  integer NOT NULL CHECK (drive_duration_s BETWEEN 300 AND 21600),
    expires_at        timestamptz NOT NULL CHECK (
        expires_at > confirmed_at AND expires_at <= departure_at AND expires_at <= confirmed_at + INTERVAL '2 hours'),
    spotify_episode   text CHECK (spotify_episode ~ '^[A-Za-z0-9]{22}$'),
    title             text CHECK (char_length(title) BETWEEN 1 AND 256),
    duration_s        integer CHECK (duration_s BETWEEN 1 AND 86400),
    position_s        integer CHECK (position_s >= 0 AND position_s <= duration_s),
    completed         boolean,
    state_hash        bytea UNIQUE CHECK (state_hash IS NULL OR octet_length(state_hash) = 32),
    verifier_cipher   text,
    state_expires_at  timestamptz CHECK (state_expires_at <= expires_at),
    CHECK ((title IS NULL) = (duration_s IS NULL)),
    CHECK ((position_s IS NULL) = (completed IS NULL)),
    CHECK (title IS NOT NULL OR spotify_episode IS NOT NULL),
    CHECK (position_s IS NULL OR duration_s IS NOT NULL),
    CHECK ((state_hash IS NULL) = (verifier_cipher IS NULL)),
    CHECK (state_expires_at IS NULL OR spotify_episode IS NOT NULL),
    CHECK (state_hash IS NULL OR state_expires_at IS NOT NULL),
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX smart_episode_reviews_vehicle_idx ON smart_episode_reviews(vehicle_id);
