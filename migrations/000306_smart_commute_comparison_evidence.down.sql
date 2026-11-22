DROP FUNCTION smart_commute_drive_started(bigint, timestamptz, timestamptz);

ALTER TABLE smart_commute_traffic_decisions
    DROP COLUMN usual_route_label,
    DROP COLUMN alternative_route_label;
