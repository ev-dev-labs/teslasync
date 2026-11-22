ALTER TABLE smart_trip_stop_scopes
    ADD COLUMN approved_place_count smallint CHECK (approved_place_count BETWEEN 2 AND 4);

ALTER TABLE smart_trip_reviews
    ADD COLUMN explicit_arrival_baseline boolean NOT NULL DEFAULT false;

ALTER TABLE smart_trip_review_adjustments
    ADD COLUMN arrival_observed_at timestamptz;
