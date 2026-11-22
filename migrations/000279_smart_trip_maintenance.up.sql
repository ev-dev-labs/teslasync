CREATE TABLE IF NOT EXISTS smart_trip_maintenance (
    plan_id                 bigint PRIMARY KEY REFERENCES smart_charging_plans(id) ON DELETE CASCADE,
    plan_version            bigint NOT NULL CHECK (plan_version > 0),
    service_label           text NOT NULL CHECK (octet_length(service_label) BETWEEN 1 AND 120),
    service_completed_at    timestamptz NOT NULL,
    service_odometer_m      double precision NOT NULL CHECK (service_odometer_m BETWEEN 0 AND 10000000000),
    interval_m              double precision NOT NULL CHECK (interval_m BETWEEN 1 AND 1000000000),
    trip_distance_low_m     double precision NOT NULL CHECK (trip_distance_low_m BETWEEN 1 AND 20000000),
    trip_distance_high_m    double precision NOT NULL CHECK (trip_distance_high_m BETWEEN trip_distance_low_m AND 20000000),
    next_check_at           timestamptz NOT NULL,
    recorded_at             timestamptz,
    recorded_odometer_m     double precision,
    expires_at              timestamptz,
    published_for_version   bigint,
    CHECK (
        num_nonnulls(recorded_at, recorded_odometer_m, expires_at) = 0
        OR (
            num_nonnulls(recorded_at, recorded_odometer_m, expires_at) = 3
            AND recorded_at >= service_completed_at AND expires_at > recorded_at
            AND recorded_odometer_m BETWEEN service_odometer_m AND 10000000000
        )
    )
);

CREATE INDEX IF NOT EXISTS smart_trip_maintenance_due_idx
    ON smart_trip_maintenance(next_check_at, plan_id);
