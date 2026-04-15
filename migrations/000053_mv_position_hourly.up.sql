-- Materialized view: hourly position aggregates per vehicle.
-- Pre-computes hourly averages for speed, power, battery, coordinates, and
-- temperatures. Replaces manual INSERT+DELETE compression in maintenance_worker.go.
--
-- Idempotent: drops existing view first in case a prior run partially succeeded.
DROP MATERIALIZED VIEW IF EXISTS mv_position_hourly;

CREATE MATERIALIZED VIEW mv_position_hourly AS
SELECT
    vehicle_id,
    date_trunc('hour', created_at)  AS hour,
    AVG(speed)                      AS avg_speed,
    AVG(power)                      AS avg_power,
    AVG(battery_level)              AS avg_battery,
    AVG(latitude)                   AS avg_lat,
    AVG(longitude)                  AS avg_lng,
    AVG(inside_temp)                AS avg_inside_temp,
    AVG(outside_temp)               AS avg_outside_temp,
    COUNT(*)                        AS sample_count,
    MIN(created_at)                 AS first_at,
    MAX(created_at)                 AS last_at
FROM positions
GROUP BY vehicle_id, date_trunc('hour', created_at);

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX idx_mv_position_hourly_vehicle_hour
    ON mv_position_hourly (vehicle_id, hour);
