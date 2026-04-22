-- Backfill battery_snapshots with one row per vehicle per month
-- derived from charging_telemetry (energy_remaining, est_battery_range)
-- and charging_sessions (SOC deltas for cycle count).

INSERT INTO battery_snapshots (vehicle_id, health_score, capacity_kwh, degradation_pct, est_range_km, cycle_count, avg_cell_temp_c, created_at)
SELECT
    v.id AS vehicle_id,
    LEAST((ct.capacity / 75.0) * 100, 100) AS health_score,
    ct.capacity AS capacity_kwh,
    GREATEST(100 - LEAST((ct.capacity / 75.0) * 100, 100), 0) AS degradation_pct,
    COALESCE(ct.est_range, 0) AS est_range_km,
    COALESCE(cs.cycle_count, 0) AS cycle_count,
    COALESCE(ct.avg_temp, 0) AS avg_cell_temp_c,
    ct.month_date AS created_at
FROM vehicles v
INNER JOIN LATERAL (
    SELECT
        DATE_TRUNC('month', created_at) AS month_date,
        AVG(energy_remaining) FILTER (WHERE energy_remaining > 0) AS capacity,
        AVG(est_battery_range) FILTER (WHERE est_battery_range > 0) AS est_range,
        AVG((COALESCE(module_temp_max, 0) + COALESCE(module_temp_min, 0)) / 2.0)
            FILTER (WHERE module_temp_max IS NOT NULL) AS avg_temp
    FROM charging_telemetry
    WHERE vehicle_id = v.id AND energy_remaining IS NOT NULL AND energy_remaining > 0
    GROUP BY DATE_TRUNC('month', created_at)
) ct ON true
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(GREATEST(end_battery_level - start_battery_level, 0)) / 100, 0)::int AS cycle_count
    FROM charging_sessions
    WHERE vehicle_id = v.id
      AND end_battery_level > start_battery_level
      AND created_at < ct.month_date + INTERVAL '1 month'
) cs ON true
WHERE NOT EXISTS (
    SELECT 1 FROM battery_snapshots bs
    WHERE bs.vehicle_id = v.id
      AND bs.created_at >= ct.month_date
      AND bs.created_at < ct.month_date + INTERVAL '1 month'
)
ORDER BY v.id, ct.month_date;
