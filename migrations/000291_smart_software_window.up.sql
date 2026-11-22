CREATE TABLE smart_software_window_plans (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject              text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id           bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    confirmed_at         timestamptz NOT NULL,
    departure_at         timestamptz NOT NULL CHECK (
        departure_at > confirmed_at + INTERVAL '30 minutes'
        AND departure_at <= confirmed_at + INTERVAL '24 hours'),
    version              text NOT NULL CHECK (version ~ '^[0-9]{4}\.[0-9]{1,3}\.[0-9]{1,4}(\.[0-9]{1,4}){0,3}$'),
    estimated_duration_s integer NOT NULL CHECK (estimated_duration_s BETWEEN 60 AND 43200),
    paused               boolean NOT NULL DEFAULT false,
    snoozed_until        timestamptz,
    CHECK (NOT paused OR snoozed_until IS NULL),
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX smart_software_window_vehicle_idx ON smart_software_window_plans(vehicle_id);
