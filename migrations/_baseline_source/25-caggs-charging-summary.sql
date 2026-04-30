-- =========================================================================
-- 25 — cagg_charging_summary (hourly charging telemetry roll-up)
-- ADR-006: replaces fn_charging_calendar_heatmap, fn_charging_hourly_distribution,
-- fn_charging_power_timeline.
-- =========================================================================

CREATE MATERIALIZED VIEW cagg_charging_summary
WITH (timescaledb.continuous) AS
SELECT
  vehicle_id,
  session_id,
  time_bucket('1 hour', ts)  AS hour,
  count(*)                    AS sample_count,
  avg(charger_power_kw)       AS avg_power_kw,
  max(charger_power_kw)       AS peak_power_kw,
  avg(charger_voltage)        AS avg_voltage,
  avg(charger_actual_current) AS avg_current,
  max(charge_energy_added_kwh) - min(charge_energy_added_kwh) AS energy_added_kwh,
  max(charge_miles_added)     - min(charge_miles_added)        AS miles_added,
  min(battery_level)          AS start_soc,
  max(battery_level)          AS end_soc
FROM charging_telemetry
GROUP BY vehicle_id, session_id, hour
WITH NO DATA;

COMMENT ON VIEW cagg_charging_summary IS
  'Hourly per-session charging roll-up. ADR-006 — replaces 3 fn_charging_* functions.';

SELECT add_continuous_aggregate_policy('cagg_charging_summary',
  start_offset      => interval '14 days',
  end_offset        => interval '1 hour',
  schedule_interval => interval '1 hour');
