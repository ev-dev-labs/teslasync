CREATE TABLE smart_backup_charging_watches (
    id                          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject                     text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id                  bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    energy_site_id              bigint NOT NULL,
    place_id                    bigint NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    place_updated_at            timestamptz NOT NULL,
    device_id                   bigint NOT NULL REFERENCES smart_push_devices(id) ON DELETE CASCADE,
    device_verified_at          timestamptz NOT NULL,
    consented_at                timestamptz NOT NULL,
    next_check_at               timestamptz NOT NULL,
    outage_started_at           timestamptz NOT NULL,
    watch_until                 timestamptz NOT NULL CHECK (watch_until > outage_started_at),
    last_observed_at            timestamptz,
    qualified_from              timestamptz,
    qualified_at                timestamptz,
    qualified_until             timestamptz,
    vehicle_power_w             double precision CHECK (vehicle_power_w BETWEEN 1000 AND 1000000),
    vehicle_power_at            timestamptz,
    minimum_battery_to_load_w   double precision CHECK (minimum_battery_to_load_w BETWEEN 1000 AND 1000000),
    FOREIGN KEY (subject, energy_site_id) REFERENCES smart_solar_energy_connections(subject, energy_site_id) ON DELETE CASCADE,
    UNIQUE (subject, vehicle_id),
    CHECK ((qualified_from IS NULL AND qualified_at IS NULL AND qualified_until IS NULL
            AND vehicle_power_w IS NULL AND vehicle_power_at IS NULL AND minimum_battery_to_load_w IS NULL)
        OR (qualified_from IS NOT NULL AND qualified_at IS NOT NULL AND qualified_until IS NOT NULL
            AND vehicle_power_w IS NOT NULL AND vehicle_power_at IS NOT NULL AND minimum_battery_to_load_w IS NOT NULL
            AND outage_started_at <= qualified_from AND qualified_from <= qualified_at AND qualified_at < qualified_until))
);

CREATE INDEX smart_backup_charging_due_idx ON smart_backup_charging_watches(next_check_at, id);
CREATE INDEX smart_backup_charging_expiry_idx ON smart_backup_charging_watches(watch_until);
CREATE INDEX smart_backup_charging_place_idx ON smart_backup_charging_watches(place_id);
CREATE INDEX smart_backup_charging_vehicle_idx ON smart_backup_charging_watches(vehicle_id);
CREATE INDEX smart_backup_charging_device_idx ON smart_backup_charging_watches(device_id);

CREATE FUNCTION revoke_backup_charging_device_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM smart_backup_charging_watches WHERE device_id = NEW.id;
    RETURN NEW;
END
$$;

CREATE TRIGGER smart_backup_charging_device_revoked
    AFTER UPDATE OF verified_at, charging_enabled ON smart_push_devices
    FOR EACH ROW
    WHEN ((OLD.charging_enabled AND NOT NEW.charging_enabled) OR OLD.verified_at IS DISTINCT FROM NEW.verified_at)
    EXECUTE FUNCTION revoke_backup_charging_device_consent();

CREATE TABLE smart_push_backup_charging_deliveries (
    watch_id          bigint NOT NULL,
    device_id         bigint NOT NULL REFERENCES smart_push_devices(id) ON DELETE CASCADE,
    consented_at      timestamptz NOT NULL,
    outage_started_at timestamptz NOT NULL,
    token_hash        bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    status            text NOT NULL CHECK (status IN ('dispatching', 'accepted', 'failed', 'unknown')),
    created_at        timestamptz NOT NULL,
    expires_at        timestamptz NOT NULL CHECK (expires_at > created_at),
    claimed_at        timestamptz,
    PRIMARY KEY (watch_id, consented_at, outage_started_at)
);

CREATE INDEX smart_push_backup_charging_budget_idx ON smart_push_backup_charging_deliveries(device_id, created_at);
CREATE INDEX smart_push_backup_charging_age_idx ON smart_push_backup_charging_deliveries(created_at);
