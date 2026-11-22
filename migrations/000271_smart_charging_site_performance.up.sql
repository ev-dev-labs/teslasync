CREATE TABLE smart_charging_site_performance (
    subject           text        NOT NULL,
    vehicle_id        bigint      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    place_id          bigint      NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    place_updated_at  timestamptz NOT NULL,
    enabled_at        timestamptz NOT NULL,
    PRIMARY KEY (subject, vehicle_id)
);
