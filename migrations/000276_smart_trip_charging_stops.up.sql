CREATE TABLE IF NOT EXISTS smart_trip_stop_scopes (
    id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plan_id                 bigint NOT NULL UNIQUE REFERENCES smart_charging_plans(id) ON DELETE CASCADE,
    plan_version            bigint NOT NULL CHECK (plan_version > 0),
    origin_updated_at       timestamptz NOT NULL,
    destination_place_id    bigint NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    destination_updated_at  timestamptz NOT NULL,
    capacity_wh             double precision NOT NULL CHECK (capacity_wh BETWEEN 1000 AND 500000),
    start_pct               double precision NOT NULL CHECK (start_pct BETWEEN 1 AND 100),
    limit_pct               double precision NOT NULL CHECK (limit_pct BETWEEN 1 AND 100),
    high_usage_wh_per_m     double precision NOT NULL CHECK (high_usage_wh_per_m BETWEEN 0.000001 AND 2),
    last_compared_at        timestamptz,
    result_expires_at       timestamptz,
    CHECK ((last_compared_at IS NULL) = (result_expires_at IS NULL)),
    CHECK (last_compared_at < result_expires_at)
);

CREATE TABLE IF NOT EXISTS smart_trip_stop_check_limits (
    plan_id       bigint PRIMARY KEY REFERENCES smart_charging_plans(id) ON DELETE CASCADE,
    next_check_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS smart_trip_stop_places (
    scope_id          bigint NOT NULL REFERENCES smart_trip_stop_scopes(id) ON DELETE CASCADE,
    place_id          bigint NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    place_updated_at  timestamptz NOT NULL,
    time_zone         text NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 80),
    PRIMARY KEY (scope_id, place_id)
);

CREATE TABLE IF NOT EXISTS smart_trip_stop_waits (
    scope_id   bigint NOT NULL,
    place_id   bigint NOT NULL,
    arrived_at timestamptz NOT NULL,
    wait_s     integer NOT NULL CHECK (wait_s BETWEEN 0 AND 14400),
    PRIMARY KEY (scope_id, place_id, arrived_at),
    FOREIGN KEY (scope_id, place_id) REFERENCES smart_trip_stop_places(scope_id, place_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS smart_trip_stop_results (
    scope_id              bigint NOT NULL,
    place_id              bigint NOT NULL,
    rank                  integer NOT NULL CHECK (rank BETWEEN 1 AND 4),
    detour_m              bigint NOT NULL CHECK (detour_m >= 0),
    detour_s              bigint NOT NULL CHECK (detour_s >= 0),
    arrive_at             timestamptz NOT NULL,
    station_arrival_wh    double precision NOT NULL CHECK (station_arrival_wh BETWEEN 0 AND 500000),
    destination_charge_wh double precision NOT NULL CHECK (destination_charge_wh BETWEEN 0 AND 500000),
    expected_wait_s       double precision NOT NULL CHECK (expected_wait_s BETWEEN 0 AND 14400),
    estimated_charge_s    bigint NOT NULL CHECK (estimated_charge_s BETWEEN 1 AND 86400),
    wait_sample_count     integer NOT NULL CHECK (wait_sample_count >= 8),
    charge_sample_count   integer NOT NULL CHECK (charge_sample_count >= 3),
    PRIMARY KEY (scope_id, place_id),
    UNIQUE (scope_id, rank),
    FOREIGN KEY (scope_id, place_id) REFERENCES smart_trip_stop_places(scope_id, place_id) ON DELETE CASCADE
);

COMMENT ON TABLE smart_trip_stop_scopes IS
    'Private outbound comparison consent, bound to the reviewed charging plan and place revisions.';
COMMENT ON TABLE smart_trip_stop_waits IS
    'User-entered historical queue waits; not live stall availability.';
COMMENT ON TABLE smart_trip_stop_check_limits IS
    'Per-plan request cooldown survives replacing or removing comparison consent; contains no route inputs.';
