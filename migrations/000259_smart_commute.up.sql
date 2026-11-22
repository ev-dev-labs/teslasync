CREATE TABLE IF NOT EXISTS smart_commute_settings (
    subject                text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id             bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    enabled                boolean NOT NULL DEFAULT false,
    local_analysis_enabled boolean NOT NULL DEFAULT false,
    paused                 boolean NOT NULL DEFAULT false,
    time_zone              text NOT NULL DEFAULT '' CHECK (char_length(time_zone) <= 128),
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (subject, vehicle_id),
    CHECK (enabled OR (NOT local_analysis_enabled AND NOT paused))
);

CREATE TABLE IF NOT EXISTS smart_commute_routines (
    id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject                  text NOT NULL,
    vehicle_id               bigint NOT NULL,
    status                   text NOT NULL CHECK (status IN ('suggested', 'confirmed', 'declined')),
    name                     text NOT NULL DEFAULT '' CHECK (char_length(name) <= 120),
    weekday                  smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    departure_s              integer NOT NULL CHECK (departure_s BETWEEN 0 AND 86399),
    time_zone                text NOT NULL CHECK (char_length(time_zone) BETWEEN 1 AND 128),
    origin_latitude          double precision NOT NULL CHECK (origin_latitude BETWEEN -90 AND 90),
    origin_longitude         double precision NOT NULL CHECK (origin_longitude BETWEEN -180 AND 180),
    destination_latitude     double precision NOT NULL CHECK (destination_latitude BETWEEN -90 AND 90),
    destination_longitude    double precision NOT NULL CHECK (destination_longitude BETWEEN -180 AND 180),
    evidence_matching_days   integer,
    evidence_window_start_s integer,
    evidence_window_end_s   integer,
    evidence_first_at        timestamptz,
    evidence_last_at         timestamptz,
    snoozed_until            timestamptz,
    created_at               timestamptz NOT NULL,
    updated_at               timestamptz NOT NULL,
    FOREIGN KEY (subject, vehicle_id)
        REFERENCES smart_commute_settings(subject, vehicle_id) ON DELETE CASCADE,
    CHECK (
        (evidence_matching_days IS NULL AND evidence_window_start_s IS NULL AND
         evidence_window_end_s IS NULL AND evidence_first_at IS NULL AND evidence_last_at IS NULL)
        OR
        (evidence_matching_days IS NOT NULL AND evidence_matching_days >= 7 AND
         evidence_window_start_s IS NOT NULL AND evidence_window_start_s BETWEEN 0 AND 86399 AND
         evidence_window_end_s IS NOT NULL AND evidence_window_end_s BETWEEN evidence_window_start_s AND 86399 AND
         evidence_first_at IS NOT NULL AND evidence_last_at IS NOT NULL AND evidence_last_at >= evidence_first_at)
    ),
    CHECK (status <> 'suggested' OR evidence_matching_days IS NOT NULL),
    CHECK (status = 'suggested' OR snoozed_until IS NULL),
    CHECK (status <> 'confirmed' OR char_length(name) > 0)
);

CREATE INDEX IF NOT EXISTS smart_commute_routines_owner_status_idx
    ON smart_commute_routines (subject, vehicle_id, status, id);

COMMENT ON TABLE smart_commute_settings IS
    'Private per-subject, per-vehicle consent. Both the feature and local history analysis default off.';
COMMENT ON TABLE smart_commute_routines IS
    'Subject-owned learned suggestions and user-confirmed routines. Locations are sensitive; do not broadcast them.';
