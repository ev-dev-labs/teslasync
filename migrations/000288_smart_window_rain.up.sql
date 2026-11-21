CREATE TABLE smart_window_rain_plans (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    subject            text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 512),
    vehicle_id         bigint NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    created_at         timestamptz NOT NULL,
    watch_until        timestamptz NOT NULL CHECK (watch_until > created_at AND watch_until <= created_at + INTERVAL '4 hours'),
    latitude_grid      smallint CHECK (latitude_grid BETWEEN -9000 AND 9000),
    longitude_grid     smallint CHECK (longitude_grid BETWEEN -18000 AND 18000),
    device_id          bigint NOT NULL,
    device_verified_at timestamptz NOT NULL,
    push_title         text NOT NULL CHECK (char_length(push_title) BETWEEN 1 AND 200),
    push_body          text NOT NULL CHECK (char_length(push_body) BETWEEN 1 AND 200),
    paused             boolean NOT NULL DEFAULT false,
    next_check_at      timestamptz,
    lease_until        timestamptz,
    reason             text NOT NULL CHECK (reason IN (
        'monitoring','unknown_state','park_changed','no_fresh_open_window',
        'weather_unavailable','no_rain_risk','window_rain_risk','expired')),
    window_position    text CHECK (window_position IN ('front_driver','front_passenger','rear_driver','rear_passenger')),
    window_observed_at timestamptz,
    forecast_at        timestamptz,
    risk_start_at      timestamptz,
    risk_end_at        timestamptz CHECK (risk_end_at = risk_start_at + INTERVAL '1 hour'),
    risk_expires_at    timestamptz CHECK (risk_expires_at <= watch_until AND risk_expires_at <= risk_end_at),
    CHECK (num_nonnulls(window_position,window_observed_at,forecast_at,risk_start_at,risk_end_at,risk_expires_at)
        = CASE WHEN reason = 'window_rain_risk' THEN 6 ELSE 0 END),
    CHECK (NOT paused OR (next_check_at IS NULL AND lease_until IS NULL AND reason <> 'window_rain_risk')),
    CHECK (num_nonnulls(latitude_grid,longitude_grid) = CASE WHEN paused OR reason IN ('expired','park_changed') THEN 0 ELSE 2 END),
    UNIQUE (subject, vehicle_id)
);

CREATE INDEX smart_window_rain_due_idx
    ON smart_window_rain_plans(next_check_at, id) WHERE next_check_at IS NOT NULL;
CREATE INDEX smart_window_rain_vehicle_idx ON smart_window_rain_plans(vehicle_id);
CREATE INDEX smart_window_rain_expiry_idx
    ON smart_window_rain_plans(watch_until, id) WHERE latitude_grid IS NOT NULL;
CREATE INDEX smart_window_rain_offer_idx
    ON smart_window_rain_plans(risk_expires_at, id) WHERE reason = 'window_rain_risk';

CREATE TABLE smart_push_window_rain_deliveries (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    subject    text NOT NULL,
    vehicle_id bigint NOT NULL,
    plan_id    bigint NOT NULL UNIQUE,
    device_id  bigint NOT NULL,
    status     text NOT NULL CHECK (status IN ('dispatching','accepted','failed','unknown')),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
    claimed_at timestamptz
);

CREATE INDEX smart_push_window_rain_expiry_idx ON smart_push_window_rain_deliveries(expires_at);
CREATE INDEX smart_push_window_rain_scope_idx ON smart_push_window_rain_deliveries(subject,vehicle_id,created_at);
CREATE INDEX smart_push_window_rain_budget_idx ON smart_push_window_rain_deliveries(device_id,created_at);
