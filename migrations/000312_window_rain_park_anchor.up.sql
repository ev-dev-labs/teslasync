ALTER TABLE smart_window_rain_plans ADD COLUMN park_observed_at timestamptz;

UPDATE smart_window_rain_plans
SET reason='park_changed', next_check_at=NULL, lease_until=NULL, latitude_grid=NULL, longitude_grid=NULL,
    window_position=NULL, window_observed_at=NULL, forecast_at=NULL,
    risk_start_at=NULL, risk_end_at=NULL, risk_expires_at=NULL
WHERE NOT paused AND reason NOT IN ('expired','park_changed');

ALTER TABLE smart_window_rain_plans ADD CONSTRAINT smart_window_rain_park_anchor_check
    CHECK ((park_observed_at IS NOT NULL) = (latitude_grid IS NOT NULL)
        AND (park_observed_at IS NULL OR park_observed_at <= created_at));
