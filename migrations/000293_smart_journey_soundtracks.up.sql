CREATE TABLE smart_journey_soundtrack_reviews (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject       text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    journey_id    bigint NOT NULL REFERENCES journey_sessions(id) ON DELETE CASCADE,
    vehicle_id    bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    started_at    timestamptz NOT NULL,
    ended_at      timestamptz NOT NULL CHECK (ended_at > started_at AND ended_at <= started_at + INTERVAL '24 hours'),
    confirmed_at  timestamptz NOT NULL CHECK (confirmed_at >= ended_at),
    expires_at    timestamptz NOT NULL CHECK (expires_at > confirmed_at AND expires_at <= confirmed_at + INTERVAL '168 hours'),
    paused        boolean NOT NULL DEFAULT false,
    snoozed_until timestamptz,
    CHECK (NOT paused OR snoozed_until IS NULL),
    UNIQUE (subject, journey_id)
);

CREATE INDEX smart_journey_soundtracks_journey_idx ON smart_journey_soundtrack_reviews(journey_id);
CREATE INDEX smart_journey_soundtracks_vehicle_idx ON smart_journey_soundtrack_reviews(vehicle_id);
