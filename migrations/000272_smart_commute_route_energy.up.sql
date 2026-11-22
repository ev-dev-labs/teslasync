ALTER TABLE smart_commute_traffic_consent
    ADD COLUMN compare_route_energy boolean NOT NULL DEFAULT false;

ALTER TABLE smart_commute_traffic_decisions
    DROP CONSTRAINT smart_commute_traffic_decisions_deadline_check,
    ADD COLUMN route_energy jsonb,
    ADD COLUMN route_energy_only boolean NOT NULL DEFAULT false,
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
