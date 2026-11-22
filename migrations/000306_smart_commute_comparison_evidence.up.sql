ALTER TABLE smart_commute_traffic_decisions
    ADD COLUMN usual_route_label varchar(120),
    ADD COLUMN alternative_route_label varchar(120);

-- A resumed drive keeps its original start. Check both completed overlaps and
-- the latest pre-window session, whose end is cleared while it resumes.
CREATE FUNCTION smart_commute_drive_started(vehicle bigint, since_at timestamptz, now_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT now_at >= since_at AND (
        EXISTS (
            SELECT 1 FROM drives
            WHERE vehicle_id = vehicle AND started_at BETWEEN since_at AND now_at
        ) OR EXISTS (
            SELECT 1 FROM drives
            WHERE vehicle_id = vehicle AND ended_at > since_at AND started_at < since_at
        ) OR COALESCE((
            SELECT ended_at IS NULL FROM drives
            WHERE vehicle_id = vehicle AND started_at < since_at
            ORDER BY started_at DESC LIMIT 1
        ), false)
    );
$$;
