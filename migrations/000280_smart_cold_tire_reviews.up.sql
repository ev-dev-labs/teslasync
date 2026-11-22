CREATE TABLE IF NOT EXISTS smart_cold_tire_reviews (
    id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject                  text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id               bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    reading_count            integer NOT NULL DEFAULT 0 CHECK (reading_count BETWEEN 0 AND 41),
    last_reading_at          timestamptz,
    occurrence               bigint NOT NULL DEFAULT 0 CHECK (occurrence >= 0),
    corner                   text CHECK (corner IN ('front_left','front_right','rear_left','rear_right')),
    comparable_count         integer,
    baseline_at              timestamptz,
    expires_at               timestamptz,
    relative_drop_pa         double precision CHECK (relative_drop_pa > 0),
    last_gauge_pressure_pa   double precision CHECK (last_gauge_pressure_pa BETWEEN 50000 AND 700000),
    UNIQUE (subject, vehicle_id),
    CHECK (num_nonnulls(corner, comparable_count, baseline_at, expires_at, relative_drop_pa, last_gauge_pressure_pa) IN (0, 6)),
    CHECK (corner IS NULL OR (last_reading_at IS NOT NULL AND baseline_at < last_reading_at
        AND expires_at > last_reading_at AND comparable_count BETWEEN 5 AND reading_count AND occurrence > 0))
);

CREATE TABLE IF NOT EXISTS smart_cold_tire_readings (
    review_id bigint NOT NULL REFERENCES smart_cold_tire_reviews(id) ON DELETE CASCADE,
    observed_at timestamptz NOT NULL,
    ambient_c double precision NOT NULL CHECK (ambient_c BETWEEN -45 AND 50),
    front_left_pa double precision NOT NULL CHECK (front_left_pa BETWEEN 50000 AND 700000),
    front_right_pa double precision NOT NULL CHECK (front_right_pa BETWEEN 50000 AND 700000),
    rear_left_pa double precision NOT NULL CHECK (rear_left_pa BETWEEN 50000 AND 700000),
    rear_right_pa double precision NOT NULL CHECK (rear_right_pa BETWEEN 50000 AND 700000),
    PRIMARY KEY (review_id, observed_at)
);
