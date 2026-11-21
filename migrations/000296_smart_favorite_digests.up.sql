CREATE SEQUENCE smart_favorite_digest_revision_seq AS bigint;

CREATE TABLE smart_favorite_digest_plans (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject        text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id     bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    revision       bigint NOT NULL DEFAULT nextval('smart_favorite_digest_revision_seq'),
    time_zone      text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 80),
    next_check_at  timestamptz,
    lease_until    timestamptz,
    UNIQUE (subject, vehicle_id),
    CHECK (lease_until IS NULL OR next_check_at IS NOT NULL)
);

ALTER SEQUENCE smart_favorite_digest_revision_seq OWNED BY smart_favorite_digest_plans.revision;

CREATE INDEX smart_favorite_digest_plans_due_idx ON smart_favorite_digest_plans(next_check_at, id) WHERE next_check_at IS NOT NULL;
CREATE INDEX smart_favorite_digest_plans_vehicle_idx ON smart_favorite_digest_plans(vehicle_id);

CREATE TABLE smart_favorite_digest_candidates (
    plan_id         bigint NOT NULL REFERENCES smart_favorite_digest_plans(id) ON DELETE CASCADE,
    key             text NOT NULL CHECK (key ~ '^[0-9a-f]{64}$'),
    ordinal         smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 5),
    period_from     timestamptz NOT NULL,
    period_until    timestamptz NOT NULL,
    expires_at      timestamptz NOT NULL,
    title           text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 256),
    artist          text NOT NULL CHECK (char_length(artist) BETWEEN 1 AND 256),
    source          text NOT NULL CHECK (source IN ('spotify','youtube_music','apple_music','tidal','bluetooth','usb')),
    duration_s      integer NOT NULL CHECK (duration_s BETWEEN 30 AND 1800),
    observed_drives smallint NOT NULL CHECK (observed_drives BETWEEN 3 AND 100),
    observed_dates  smallint NOT NULL CHECK (observed_dates BETWEEN 2 AND 7 AND observed_dates <= observed_drives),
    CHECK (period_from < period_until AND period_until < expires_at),
    PRIMARY KEY (plan_id, key),
    UNIQUE (plan_id, ordinal)
);

CREATE TABLE smart_confirmed_favorite_tracks (
    plan_id      bigint NOT NULL REFERENCES smart_favorite_digest_plans(id) ON DELETE CASCADE,
    key          text NOT NULL CHECK (key ~ '^[0-9a-f]{64}$'),
    title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 256),
    artist       text NOT NULL CHECK (char_length(artist) BETWEEN 1 AND 256),
    source       text NOT NULL CHECK (source IN ('spotify','youtube_music','apple_music','tidal','bluetooth','usb')),
    duration_s   integer NOT NULL CHECK (duration_s BETWEEN 30 AND 1800),
    confirmed_at timestamptz NOT NULL,
    PRIMARY KEY (plan_id, key)
);
