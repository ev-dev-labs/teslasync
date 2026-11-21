CREATE TABLE smart_spotify_connections (
    subject          text PRIMARY KEY CHECK (char_length(subject) BETWEEN 1 AND 512),
    revision         bigint GENERATED ALWAYS AS IDENTITY,
    return_vehicle_id bigint NOT NULL CHECK (return_vehicle_id > 0),
    state_hash       bytea CHECK (octet_length(state_hash) = 32),
    verifier_cipher  text,
    state_expires_at timestamptz NOT NULL,
    token_cipher     text,
    token_expires_at timestamptz,
    CHECK ((state_hash IS NULL) = (verifier_cipher IS NULL)),
    CHECK ((token_cipher IS NULL) = (token_expires_at IS NULL)),
    CHECK (state_hash IS NULL OR token_cipher IS NULL)
);

CREATE TABLE smart_media_playlist_drafts (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject           text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id        bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    created_at        timestamptz NOT NULL,
    departure_at      timestamptz NOT NULL CHECK (
        departure_at > created_at AND departure_at <= created_at + INTERVAL '24 hours'),
    target_duration_s integer NOT NULL CHECK (target_duration_s BETWEEN 300 AND 21600),
    paused            boolean NOT NULL DEFAULT false,
    snoozed_until     timestamptz,
    status            text NOT NULL DEFAULT 'preview' CHECK (
        status IN ('preview', 'saving', 'saved', 'rejected', 'created_only', 'unknown')),
    dispatch_at       timestamptz,
    playlist_id       text CHECK (playlist_id ~ '^[A-Za-z0-9]{22}$'),
    CHECK (NOT paused OR snoozed_until IS NULL),
    CHECK ((status = 'preview') = (dispatch_at IS NULL)),
    CHECK (status NOT IN ('saved', 'created_only') OR playlist_id IS NOT NULL),
    CHECK (status NOT IN ('preview', 'rejected') OR playlist_id IS NULL),
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX smart_media_playlist_vehicle_idx ON smart_media_playlist_drafts(vehicle_id);

CREATE TABLE smart_media_playlist_candidates (
    draft_id     bigint NOT NULL REFERENCES smart_media_playlist_drafts(id) ON DELETE CASCADE,
    position     smallint NOT NULL CHECK (position BETWEEN 1 AND 100),
    title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 256),
    artist       text NOT NULL CHECK (char_length(artist) BETWEEN 1 AND 256),
    duration_s   integer NOT NULL CHECK (duration_s BETWEEN 10 AND 14400),
    observed_at  timestamptz NOT NULL,
    suggested    boolean NOT NULL,
    PRIMARY KEY (draft_id, position)
);
