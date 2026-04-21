-- Revert continuous aggregates. Dropping the CAGGs also removes their
-- attached refresh and retention policies automatically.

DROP VIEW IF EXISTS v_fleet_weekly;

DROP MATERIALIZED VIEW IF EXISTS cagg_position_daily;
DROP MATERIALIZED VIEW IF EXISTS cagg_climate_hourly;
DROP MATERIALIZED VIEW IF EXISTS cagg_charging_hourly;
DROP MATERIALIZED VIEW IF EXISTS cagg_position_hourly;

-- Recreate the legacy mv_position_hourly so reverting this migration does not
-- break the maintenance_worker refresh loop (if it's also rolled back).
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_position_hourly AS
SELECT
    vehicle_id,
    date_trunc('hour', created_at) AS hour,
    avg(speed)         AS avg_speed,
    avg(power)         AS avg_power,
    avg(battery_level) AS avg_battery,
    avg(latitude)      AS avg_lat,
    avg(longitude)     AS avg_lng,
    avg(inside_temp)   AS avg_inside_temp,
    avg(outside_temp)  AS avg_outside_temp,
    count(*)           AS sample_count,
    min(created_at)    AS first_at,
    max(created_at)    AS last_at
FROM positions
GROUP BY vehicle_id, date_trunc('hour', created_at)
WITH NO DATA;
