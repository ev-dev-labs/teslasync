DELETE FROM smart_commute_traffic_decisions WHERE route_energy_only;

ALTER TABLE smart_commute_traffic_decisions
    DROP CONSTRAINT smart_commute_traffic_decisions_route_energy_check,
    DROP COLUMN route_energy_only,
    DROP COLUMN route_energy,
    ADD CONSTRAINT smart_commute_traffic_decisions_deadline_check CHECK (
        alternative_s BETWEEN 1 AND 10800 AND (
            (arrival_deadline_at IS NULL AND latest_departure_at IS NULL AND alternative_s < usual_s)
            OR (arrival_deadline_at > departure_at AND latest_departure_at < departure_at
                AND arrival_deadline_at IS NOT NULL AND latest_departure_at IS NOT NULL
                AND expires_at <= latest_departure_at)
        )
    );

ALTER TABLE smart_commute_traffic_consent DROP COLUMN compare_route_energy;
