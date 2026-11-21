CREATE TABLE IF NOT EXISTS smart_trip_reviews (
    plan_id                       bigint PRIMARY KEY REFERENCES smart_charging_plans(id) ON DELETE CASCADE,
    journey_id                    bigint NOT NULL REFERENCES journey_sessions(id) ON DELETE CASCADE,
    plan_version                  bigint NOT NULL CHECK (plan_version > 0),
    revision                      bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    saved_at                      timestamptz NOT NULL,
    origin_updated_at             timestamptz NOT NULL,
    destination_id                bigint NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    destination_updated_at        timestamptz NOT NULL,
    stop_place_id                 bigint REFERENCES geofences(id) ON DELETE CASCADE,
    stop_place_updated_at         timestamptz,
    planned_arrival_pct           double precision NOT NULL CHECK (planned_arrival_pct BETWEEN 0 AND 100),
    planned_stop_s                integer NOT NULL CHECK (planned_stop_s BETWEEN 0 AND 21600),
    CHECK ((stop_place_id IS NULL) = (stop_place_updated_at IS NULL)),
    CHECK ((stop_place_id IS NULL) = (planned_stop_s = 0)),
    CHECK (stop_place_id IS NULL OR stop_place_id <> destination_id)
);

CREATE TABLE IF NOT EXISTS smart_trip_review_adjustments (
    review_revision         bigint PRIMARY KEY REFERENCES smart_trip_reviews(revision) ON DELETE CASCADE,
    saved_at                timestamptz NOT NULL,
    extra_stop_s            integer NOT NULL CHECK (extra_stop_s BETWEEN 0 AND 21600),
    extra_arrival_pct       double precision NOT NULL CHECK (extra_arrival_pct BETWEEN 0 AND 100),
    CHECK (extra_stop_s > 0 OR extra_arrival_pct > 0)
);

COMMENT ON TABLE smart_trip_reviews IS
    'Private opt-in pre-departure snapshot tied to a single charging plan version and reviewed journey.';
COMMENT ON TABLE smart_trip_review_adjustments IS
    'User-saved planning allowance for a similar future trip; does not modify any charging plan.';
