CREATE TABLE smart_solar_energy_connections (
    id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject                  text        NOT NULL UNIQUE CHECK (char_length(subject) BETWEEN 1 AND 512),
    energy_site_id           bigint      NOT NULL CHECK (energy_site_id > 0),
    state_hash               bytea       CHECK (octet_length(state_hash) = 32),
    state_claimed_at         timestamptz,
    encrypted_access_token   text,
    encrypted_refresh_token  text,
    expires_at               timestamptz NOT NULL,
    refresh_after            timestamptz,
    UNIQUE (subject, energy_site_id),
    CHECK (
      (state_hash IS NOT NULL AND encrypted_access_token IS NULL AND encrypted_refresh_token IS NULL AND refresh_after IS NULL) OR
      (state_hash IS NULL AND state_claimed_at IS NULL AND encrypted_access_token IS NOT NULL
        AND encrypted_refresh_token IS NOT NULL AND refresh_after IS NOT NULL)
    )
);

CREATE INDEX smart_solar_energy_pending_idx ON smart_solar_energy_connections (expires_at) WHERE state_hash IS NOT NULL;

CREATE TABLE smart_solar_charging_plans (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject          text        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id       bigint      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    energy_site_id   bigint      NOT NULL,
    place_id         bigint      NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    place_updated_at timestamptz NOT NULL,
    consented_at     timestamptz NOT NULL,
    next_check_at    timestamptz NOT NULL,
    reserve_pct      double precision CHECK (reserve_pct BETWEEN 0 AND 100),
    reserve_read_at  timestamptz,
    CHECK ((reserve_pct IS NULL) = (reserve_read_at IS NULL)),
    FOREIGN KEY (subject, energy_site_id) REFERENCES smart_solar_energy_connections(subject, energy_site_id) ON DELETE CASCADE,
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX smart_solar_charging_due_idx ON smart_solar_charging_plans (next_check_at, id);
CREATE INDEX smart_solar_charging_place_idx ON smart_solar_charging_plans (place_id);
CREATE INDEX smart_solar_charging_vehicle_idx ON smart_solar_charging_plans (vehicle_id);

CREATE TABLE smart_solar_charging_samples (
    plan_id         bigint      NOT NULL REFERENCES smart_solar_charging_plans(id) ON DELETE CASCADE,
    consented_at    timestamptz NOT NULL,
    observed_at     timestamptz NOT NULL,
    grid_connected  boolean     NOT NULL,
    storm_mode      boolean     NOT NULL,
    grid_power_w    double precision NOT NULL CHECK (grid_power_w BETWEEN -1000000 AND 1000000),
    solar_power_w   double precision NOT NULL CHECK (solar_power_w BETWEEN 0 AND 1000000),
    battery_power_w double precision NOT NULL CHECK (battery_power_w BETWEEN -1000000 AND 1000000),
    battery_pct     double precision NOT NULL CHECK (battery_pct BETWEEN 0 AND 100),
    PRIMARY KEY (plan_id, consented_at, observed_at)
);

CREATE INDEX smart_solar_charging_sample_age_idx ON smart_solar_charging_samples (observed_at);
