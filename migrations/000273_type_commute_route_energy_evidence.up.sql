ALTER TABLE smart_commute_traffic_decisions
    ADD COLUMN energy_expires_at timestamptz,
    ADD COLUMN energy_outside_c double precision,
    ADD COLUMN energy_fast_eta_s integer,
    ADD COLUMN energy_fast_count integer,
    ADD COLUMN energy_fast_low_wh double precision,
    ADD COLUMN energy_fast_median_wh double precision,
    ADD COLUMN energy_fast_high_wh double precision,
    ADD COLUMN energy_saving_eta_s integer,
    ADD COLUMN energy_saving_count integer,
    ADD COLUMN energy_saving_low_wh double precision,
    ADD COLUMN energy_saving_median_wh double precision,
    ADD COLUMN energy_saving_high_wh double precision;

UPDATE smart_commute_traffic_decisions
SET energy_expires_at = (route_energy->>'expires_at')::timestamptz,
    energy_outside_c = (route_energy->>'outside_c')::double precision,
    energy_fast_eta_s = (route_energy->'fastest'->>'eta_s')::integer,
    energy_fast_count = (route_energy->'fastest'->>'drive_count')::integer,
    energy_fast_low_wh = (route_energy->'fastest'->>'low_wh')::double precision,
    energy_fast_median_wh = (route_energy->'fastest'->>'median_wh')::double precision,
    energy_fast_high_wh = (route_energy->'fastest'->>'high_wh')::double precision,
    energy_saving_eta_s = (route_energy->'saving'->>'eta_s')::integer,
    energy_saving_count = (route_energy->'saving'->>'drive_count')::integer,
    energy_saving_low_wh = (route_energy->'saving'->>'low_wh')::double precision,
    energy_saving_median_wh = (route_energy->'saving'->>'median_wh')::double precision,
    energy_saving_high_wh = (route_energy->'saving'->>'high_wh')::double precision
WHERE route_energy IS NOT NULL;

ALTER TABLE smart_commute_traffic_decisions
    DROP CONSTRAINT smart_commute_traffic_decisions_route_energy_check,
    DROP COLUMN route_energy,
    ADD CONSTRAINT smart_commute_traffic_decisions_route_energy_check CHECK (
        alternative_s BETWEEN 1 AND 10800 AND (
            (route_energy_only AND energy_expires_at IS NOT NULL AND arrival_deadline_at IS NULL AND latest_departure_at IS NULL)
            OR (NOT route_energy_only AND (
                (arrival_deadline_at IS NULL AND latest_departure_at IS NULL AND alternative_s < usual_s)
                OR (arrival_deadline_at > departure_at AND latest_departure_at < departure_at
                    AND arrival_deadline_at IS NOT NULL AND latest_departure_at IS NOT NULL
                    AND expires_at <= latest_departure_at)
            ))
        )
    ),
    ADD CONSTRAINT smart_commute_traffic_decisions_energy_band_check CHECK (
        num_nonnulls(energy_expires_at, energy_outside_c, energy_fast_eta_s, energy_fast_count,
            energy_fast_low_wh, energy_fast_median_wh, energy_fast_high_wh, energy_saving_eta_s, energy_saving_count,
            energy_saving_low_wh, energy_saving_median_wh, energy_saving_high_wh) = 0
        OR (
            num_nonnulls(energy_expires_at, energy_outside_c, energy_fast_eta_s, energy_fast_count,
                energy_fast_low_wh, energy_fast_median_wh, energy_fast_high_wh, energy_saving_eta_s, energy_saving_count,
                energy_saving_low_wh, energy_saving_median_wh, energy_saving_high_wh) = 12
            AND energy_expires_at > observed_at AND energy_expires_at <= departure_at
            AND (NOT route_energy_only OR expires_at <= energy_expires_at)
            AND energy_outside_c BETWEEN -40 AND 55
            AND energy_fast_eta_s BETWEEN 1 AND 10800
            AND energy_saving_eta_s BETWEEN energy_fast_eta_s + 1 AND 10800
            AND energy_fast_count BETWEEN 4 AND 24 AND energy_saving_count BETWEEN 4 AND 24
            AND energy_fast_low_wh > 0 AND energy_fast_median_wh >= energy_fast_low_wh
            AND energy_fast_high_wh BETWEEN energy_fast_median_wh AND 200000
            AND energy_saving_low_wh > 0 AND energy_saving_median_wh >= energy_saving_low_wh
            AND energy_saving_high_wh BETWEEN energy_saving_median_wh AND energy_fast_low_wh
        )
    );
