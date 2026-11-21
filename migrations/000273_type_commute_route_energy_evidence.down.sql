ALTER TABLE smart_commute_traffic_decisions ADD COLUMN route_energy jsonb;

UPDATE smart_commute_traffic_decisions
SET route_energy = jsonb_build_object(
    'expires_at', energy_expires_at, 'outside_c', energy_outside_c,
    'fastest', jsonb_build_object(
        'eta_s', energy_fast_eta_s, 'drive_count', energy_fast_count,
        'low_wh', energy_fast_low_wh, 'median_wh', energy_fast_median_wh, 'high_wh', energy_fast_high_wh
    ),
    'saving', jsonb_build_object(
        'eta_s', energy_saving_eta_s, 'drive_count', energy_saving_count,
        'low_wh', energy_saving_low_wh, 'median_wh', energy_saving_median_wh, 'high_wh', energy_saving_high_wh
    )
)
WHERE energy_expires_at IS NOT NULL;

ALTER TABLE smart_commute_traffic_decisions
    DROP CONSTRAINT smart_commute_traffic_decisions_energy_band_check,
    DROP CONSTRAINT smart_commute_traffic_decisions_route_energy_check,
    DROP COLUMN energy_expires_at,
    DROP COLUMN energy_outside_c,
    DROP COLUMN energy_fast_eta_s,
    DROP COLUMN energy_fast_count,
    DROP COLUMN energy_fast_low_wh,
    DROP COLUMN energy_fast_median_wh,
    DROP COLUMN energy_fast_high_wh,
    DROP COLUMN energy_saving_eta_s,
    DROP COLUMN energy_saving_count,
    DROP COLUMN energy_saving_low_wh,
    DROP COLUMN energy_saving_median_wh,
    DROP COLUMN energy_saving_high_wh,
    ADD CONSTRAINT smart_commute_traffic_decisions_route_energy_check CHECK (
        alternative_s BETWEEN 1 AND 10800 AND (
            (route_energy_only AND route_energy IS NOT NULL AND arrival_deadline_at IS NULL AND latest_departure_at IS NULL)
            OR (NOT route_energy_only AND (
                (arrival_deadline_at IS NULL AND latest_departure_at IS NULL AND alternative_s < usual_s)
                OR (arrival_deadline_at > departure_at AND latest_departure_at < departure_at
                    AND arrival_deadline_at IS NOT NULL AND latest_departure_at IS NOT NULL
                    AND expires_at <= latest_departure_at)
            ))
        )
    );
