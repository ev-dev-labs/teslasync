-- Materialized view: daily energy stats per vehicle.
-- Pre-computes daily energy charged, distance driven, cost, and efficiency
-- from charging_sessions and drives tables. Replaces expensive correlated
-- subqueries in energy_repo.go GetDailyBreakdown().
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_energy_daily AS
SELECT
    COALESCE(c.vehicle_id, d.vehicle_id) AS vehicle_id,
    COALESCE(c.day, d.day)               AS day,
    COALESCE(c.energy_kwh, 0)            AS energy_kwh,
    COALESCE(d.distance_km, 0)           AS distance_km,
    COALESCE(c.cost, 0)                  AS cost,
    CASE
        WHEN COALESCE(d.distance_km, 0) > 0
        THEN COALESCE(c.energy_kwh, 0) / d.distance_km * 1000
        ELSE 0
    END                                  AS efficiency
FROM (
    SELECT vehicle_id, DATE(start_date) AS day,
           SUM(charge_energy_added) AS energy_kwh,
           SUM(cost) AS cost
    FROM charging_sessions
    GROUP BY vehicle_id, DATE(start_date)
) c
FULL OUTER JOIN (
    SELECT vehicle_id, DATE(start_date) AS day,
           SUM(distance) AS distance_km
    FROM drives
    GROUP BY vehicle_id, DATE(start_date)
) d ON c.vehicle_id = d.vehicle_id AND c.day = d.day;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_energy_daily_vehicle_day
    ON mv_energy_daily (vehicle_id, day);
