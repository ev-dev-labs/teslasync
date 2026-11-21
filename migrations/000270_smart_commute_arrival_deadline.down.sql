DELETE FROM smart_commute_traffic_decisions WHERE arrival_deadline_at IS NOT NULL;

ALTER TABLE smart_commute_traffic_decisions
    DROP CONSTRAINT smart_commute_traffic_decisions_deadline_check,
    DROP COLUMN arrival_deadline_at,
    DROP COLUMN latest_departure_at,
    ADD CONSTRAINT smart_commute_traffic_decisions_check
        CHECK (alternative_s BETWEEN 1 AND usual_s - 1);

ALTER TABLE smart_commute_traffic_consent DROP COLUMN arrival_deadline_s;
