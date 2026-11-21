ALTER TABLE smart_window_rain_plans
    DROP CONSTRAINT smart_window_rain_park_anchor_check,
    DROP COLUMN park_observed_at;
