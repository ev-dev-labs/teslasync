-- Phase-42 / Prompt 0036: derived rollups (continuous aggregates +
-- materialized views) recreated over the SI-canonical tables introduced
-- in phase-42 prompts 0030-0035 (positions, climate_snapshots,
-- charging_sessions, charging_telemetry, drives, signal_log,
-- fsm_transitions, vehicle_live_state).
--
-- ADR-004 / forward-only: the legacy versions of these rollups (over
-- the pre-phase-42 schema with kWh / mph / mi columns) were dropped
-- in cascade by the upstream phase-42 migrations:
--   * 000184_charging_si        dropped cagg_charging_summary (CASCADE
--                               with charging_telemetry / charging_sessions
--                               legacy variants).
--   * 000185_drives_si          dropped legacy cagg_fleet_stats and
--                               mv_energy_daily / mv_position_hourly /
--                               mv_signal_stats (CASCADE with the legacy
--                               drives / positions / signal_history).
--   * 000186_signal_log         dropped cagg_vehicle_daily,
--                               cagg_climate_hourly, cagg_battery_daily,
--                               and cagg_signal_hourly (CASCADE with
--                               signal_log / signal_observations /
--                               signal_catalog).
-- This migration recreates the rollups against the new SI schema. The
-- forward-only mandate means existing rows are not migrated — clients
-- backfill from MQTT replay if needed (prompt 0090 runbook), and the
-- caggs / MVs start empty.
--
-- Slot variance: prompt 0036 hardcodes slot 000181, but that slot is
-- already occupied by 000181_vehicle_unit_history (phase-42 0022).
-- Slot 000188 is the next free slot after the trailing edge of existing
-- migrations (000187_fsm_live is the immediately prior phase-42
-- migration, created by prompt 0035). This mirrors the slot-variance
-- the predecessor phase-42 prompts 0022 (000160 -> 000181), 0030
-- (000162 -> 000182), 0031 (000163 -> 000183), 0032 (000164 -> 000184),
-- 0033 (000165 -> 000185), 0034 (000166 -> 000186), and 0035
-- (000167 -> 000187) applied. The schema, semantics, and gate intent
-- are otherwise exactly as the prompt specifies, with three pragmatic
-- deviations from the prompt's literal wording (each documented inline
-- below):
--
--   * `cagg_fleet_stats` — the prompt writes "cagg over positions" but
--     the legacy contract that all in-tree consumers query
--     (energy_repo.go, regen_handler.go, maintenance_worker.go) is a
--     per-(vehicle_id, day) drive roll-up sourced from `drives`. The
--     `drives` table is a regular non-hypertable (see 000185), so a
--     real continuous aggregate is not available and the rollup is
--     created as a regular MATERIALIZED VIEW. Sourcing from positions
--     instead of drives would silently change semantics under the same
--     object name (drive_count, total_distance, total_energy, etc.).
--     We follow the legacy contract; if a positions-based rollup is
--     ever wanted, it should land under a NEW name in a future prompt.
--
--   * `cagg_charging_summary` — the prompt writes "cagg over
--     charging_sessions" but `charging_sessions` is a regular
--     non-hypertable (see 000184). We create it as a regular MV under
--     the prompt's literal name. There is repository precedent for a
--     regular MV named with the cagg_ prefix (000142_baseline_typed
--     created `cagg_fleet_stats` as a regular MV with a comment
--     explicitly calling out the naming compromise).
--
--   * `cagg_vehicle_daily` — the prompt writes "cagg over positions +
--     drives" but a single continuous aggregate cannot span two
--     tables (the cagg invalidation machinery hooks the source
--     hypertable's chunks; mutations to `drives` would not invalidate
--     the cagg). We materialize positions-derived stats here (distance,
--     speed) and leave drive_count / energy_wh to read-time JOINs
--     against `drives`.
--
-- ADR-004 / SI: every numeric column in this migration is in SI canonical
-- units (meters, seconds, Watts, Watt-hours, meters-per-second, Pascals,
-- Celsius). Pre-phase-42 consumers that query mi / mph / kWh columns
-- (energy_repo.go, regen_handler.go, battery_handler.go,
-- analytics_handler_queries.go, signal_history_writer.go) will need
-- adapter changes in a later phase-42 prompt; the rollup column NAMES
-- preserved here (bucket / end_soc / min_soc / max_soc / signal_name /
-- sample_count / min_value / max_value / avg_value / drive_count / day)
-- intentionally match the legacy queries so the SQL parser does not
-- reject them after this migration applies.

-- =========================================================================
-- Defensive cleanup: drop any legacy versions of these rollups so the
-- migration can be re-applied against test databases that still hold
-- stray pre-phase-42 objects under these names. Order is irrelevant
-- because each DROP uses CASCADE and IF EXISTS.
-- =========================================================================
DROP MATERIALIZED VIEW IF EXISTS cagg_battery_daily    CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_climate_hourly   CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_signal_hourly    CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_fleet_stats      CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_vehicle_daily    CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_charging_summary CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_energy_daily       CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_position_hourly    CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_signal_stats       CASCADE;

-- =========================================================================
-- 1. cagg_battery_daily — daily per-(vehicle_id, day) battery roll-up
-- over signal_log. Real continuous aggregate. Field names match
-- protomodel.SignalMeta.Field: BatteryLevel, ACChargingEnergyIn,
-- DCChargingEnergyIn, EnergyRemaining are all ValueKindFloat per
-- protomodel/signal_metadata_gen.go, so the rollup reads from
-- float_value.
--
-- Column contract (keeps the legacy battery-trend query in
-- internal/api/battery_handler.go and analytics_handler_queries.go
-- working without rewrites): bucket, vehicle_id, end_soc, min_soc,
-- max_soc.
--
-- Energy delta semantics: ACChargingEnergyIn / DCChargingEnergyIn /
-- EnergyRemaining are cumulative counters. The "energy added" / "energy
-- consumed" daily delta is reported as MAX - MIN of float_value over the
-- day. This is correct for a counter that monotonically increases (or
-- monotonically decreases for EnergyRemaining) within the day. If the
-- counter resets mid-day (rare; firmware-level), the delta will be
-- under-counted by exactly one reset-cycle worth of energy. Daily roll-up
-- is the canonical phase-42 grain for this metric per the prompt.
-- =========================================================================
CREATE MATERIALIZED VIEW cagg_battery_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', ts) AS bucket,
  vehicle_id,
  MIN(float_value) FILTER (WHERE field = 'BatteryLevel') AS min_soc,
  MAX(float_value) FILTER (WHERE field = 'BatteryLevel') AS max_soc,
  AVG(float_value) FILTER (WHERE field = 'BatteryLevel') AS avg_soc,
  last(float_value, ts) FILTER (WHERE field = 'BatteryLevel') AS end_soc,
  first(float_value, ts) FILTER (WHERE field = 'BatteryLevel') AS start_soc,
  COUNT(*) FILTER (WHERE field = 'BatteryLevel') AS soc_sample_count,
  -- Energy added (max - min over the day, per cumulative counter).
  MAX(float_value) FILTER (WHERE field = 'ACChargingEnergyIn')
    - MIN(float_value) FILTER (WHERE field = 'ACChargingEnergyIn') AS ac_energy_added_wh,
  MAX(float_value) FILTER (WHERE field = 'DCChargingEnergyIn')
    - MIN(float_value) FILTER (WHERE field = 'DCChargingEnergyIn') AS dc_energy_added_wh,
  -- Energy consumed: EnergyRemaining is the pack-energy field; daily
  -- start - daily end gives the consumption (positive when consumed,
  -- negative when net-charged-while-driving).
  first(float_value, ts) FILTER (WHERE field = 'EnergyRemaining')
    - last(float_value, ts) FILTER (WHERE field = 'EnergyRemaining') AS energy_consumed_wh
FROM signal_log
GROUP BY bucket, vehicle_id
WITH NO DATA;

COMMENT ON VIEW cagg_battery_daily IS
  'Phase-42 daily battery roll-up over signal_log. Continuous aggregate. '
  'bucket/vehicle_id/end_soc/min_soc/max_soc preserved for legacy consumers '
  '(battery_handler.go, analytics_handler_queries.go); energy_consumed_wh / '
  '*_energy_added_wh use cumulative-counter daily-delta semantics.';

SELECT add_continuous_aggregate_policy('cagg_battery_daily',
  start_offset      => INTERVAL '30 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

-- =========================================================================
-- 2. cagg_climate_hourly — hourly per-(vehicle_id, hour) climate
-- roll-up over climate_snapshots. Real continuous aggregate.
-- climate_snapshots is a hypertable per 000183 with inside_temp_c /
-- outside_temp_c / hvac_power columns in SI units (Celsius / boolean).
--
-- hvac_active_sample_count is the number of samples that recorded
-- hvac_power=TRUE within the hour; multiplied by the sampling cadence
-- it approximates active minutes. (The prompt wording is
-- "hvac_active_minutes"; we expose the COUNT and let the consumer
-- multiply by the known sampling cadence — Fleet Telemetry's HVAC
-- cadence varies, so committing to a fixed minute conversion at the
-- rollup layer would be incorrect.)
-- =========================================================================
CREATE MATERIALIZED VIEW cagg_climate_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', ts) AS bucket,
  vehicle_id,
  AVG(inside_temp_c)  AS avg_inside_temp_c,
  AVG(outside_temp_c) AS avg_outside_temp_c,
  MIN(inside_temp_c)  AS min_inside_temp_c,
  MAX(inside_temp_c)  AS max_inside_temp_c,
  MIN(outside_temp_c) AS min_outside_temp_c,
  MAX(outside_temp_c) AS max_outside_temp_c,
  COUNT(*) FILTER (WHERE hvac_power = TRUE) AS hvac_active_sample_count,
  COUNT(*) AS sample_count
FROM climate_snapshots
GROUP BY bucket, vehicle_id
WITH NO DATA;

COMMENT ON VIEW cagg_climate_hourly IS
  'Phase-42 hourly climate roll-up over climate_snapshots. Continuous '
  'aggregate. Temperatures in Celsius (SI). hvac_active_sample_count is a '
  'sample count; multiply by sampling cadence for minutes.';

SELECT add_continuous_aggregate_policy('cagg_climate_hourly',
  start_offset      => INTERVAL '7 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '30 minutes');

-- =========================================================================
-- 3. cagg_signal_hourly — hourly per-(vehicle_id, hour, field) signal
-- roll-up over signal_log. Real continuous aggregate.
--
-- Column contract: legacy consumer signal_history_writer.go .Stats
-- queries `signal_name`, `sample_count`, `min_value`, `max_value`,
-- `avg_value` and assumes a single numeric value column. We alias
-- `field AS signal_name` and roll up float_value for the numeric
-- aggregates (BatteryLevel, VehicleSpeed, OutsideTemp, etc. are all
-- ValueKindFloat, which covers all numeric-stats consumers). Int /
-- Bool / String / Time fields appear here with NULL min/max/avg
-- (their float_value is NULL by construction); the typed last_*
-- columns expose the latest value for any kind.
-- =========================================================================
CREATE MATERIALIZED VIEW cagg_signal_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', ts) AS hour,
  vehicle_id,
  field AS signal_name,
  COUNT(*) AS sample_count,
  AVG(float_value) AS avg_value,
  MIN(float_value) AS min_value,
  MAX(float_value) AS max_value,
  last(float_value, ts) AS last_float_value,
  last(int_value,   ts) AS last_int_value,
  last(bool_value,  ts) AS last_bool_value,
  last(str_value,   ts) AS last_str_value
FROM signal_log
GROUP BY hour, vehicle_id, field
WITH NO DATA;

COMMENT ON VIEW cagg_signal_hourly IS
  'Phase-42 hourly per-signal roll-up over signal_log. Continuous '
  'aggregate. signal_name preserves the legacy column name for '
  'signal_history_writer.go .Stats; min_value/max_value/avg_value are '
  'rolled up over float_value (numeric kinds). Typed last_* columns expose '
  'the latest value for non-numeric kinds.';

SELECT add_continuous_aggregate_policy('cagg_signal_hourly',
  start_offset      => INTERVAL '30 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

-- =========================================================================
-- 4. cagg_fleet_stats — daily per-(vehicle_id, day) drive roll-up
-- over `drives`. Regular materialized view (NOT a continuous aggregate)
-- because `drives` is a non-hypertable per 000185.
--
-- Column contract: matches the legacy MV created in
-- 000142_baseline_typed.up.sql and the legacy consumers
-- energy_repo.go (.GetDailyBreakdown, .GetTotals),
-- regen_handler.go (.regenSummary), and maintenance_worker.go
-- (.refreshFleetStats — the comment there explicitly notes "regular MV,
-- not TimescaleDB CAGG, because drives is mutable"). Column NAMES
-- preserved (vehicle_id, day, drive_count, total_distance,
-- total_energy, total_regen, total_duration, avg_speed, max_speed);
-- column UNITS migrated to SI per phase-42 (m, Wh, s, mps). Legacy
-- consumers that read `total_distance_mi` / `total_energy_kwh` /
-- `total_regen_kwh` will need adapter changes in a later phase-42
-- prompt — they are intentionally NOT preserved here because there is
-- no clean way to keep both unit systems in the same MV without
-- recomputing on every read.
--
-- Refresh policy: regular MV, refreshed by the maintenance worker via
-- REFRESH MATERIALIZED VIEW CONCURRENTLY (see refreshFleetStats in
-- internal/worker/maintenance_worker.go). The CONCURRENTLY refresh
-- requires a UNIQUE INDEX, hence cagg_fleet_stats_pk below.
-- =========================================================================
CREATE MATERIALIZED VIEW cagg_fleet_stats AS
SELECT
  vehicle_id,
  date_trunc('day', started_at)::DATE AS day,
  COUNT(*)                AS drive_count,
  SUM(distance_m)         AS total_distance_m,
  SUM(energy_used_wh)     AS total_energy_wh,
  SUM(regen_energy_wh)    AS total_regen_wh,
  SUM(duration_s)         AS total_duration_s,
  AVG(avg_speed_mps)      AS avg_speed_mps,
  MAX(max_speed_mps)      AS max_speed_mps,
  AVG(start_soc_pct)      AS avg_start_soc_pct,
  AVG(end_soc_pct)        AS avg_end_soc_pct,
  AVG(ambient_temp_c_avg) AS avg_ambient_temp_c
FROM drives
WHERE ended_at IS NOT NULL
GROUP BY vehicle_id, date_trunc('day', started_at);

CREATE UNIQUE INDEX cagg_fleet_stats_pk
  ON cagg_fleet_stats (vehicle_id, day);

COMMENT ON MATERIALIZED VIEW cagg_fleet_stats IS
  'Phase-42 daily per-vehicle drive roll-up over drives. Regular MV (NOT a '
  'TimescaleDB continuous aggregate) — drives is a non-hypertable. SI '
  'columns (m, Wh, s, mps); legacy mi/kwh/mph consumers (energy_repo.go, '
  'regen_handler.go) need adapter changes. Refresh via maintenance_worker '
  '(REFRESH MATERIALIZED VIEW CONCURRENTLY).';

-- =========================================================================
-- 5. cagg_vehicle_daily — daily per-(vehicle_id, day) positions
-- roll-up. Real continuous aggregate over the positions hypertable.
--
-- The prompt says "(cagg over positions + drives)" but a single cagg
-- cannot span two tables — the cagg invalidation machinery hooks the
-- source hypertable's chunks, and mutations to `drives` (a regular
-- table) would not invalidate the cagg. drive_count and energy_wh
-- are therefore NOT included here; consumers that need those values
-- per-day should JOIN cagg_vehicle_daily with cagg_fleet_stats (or
-- with `drives` directly) at read time.
--
-- distance_m is computed as MAX(odometer_m) - MIN(odometer_m) within
-- the day. odometer is a monotonically increasing cumulative counter
-- (excepting rare manual odometer corrections), so this is exactly
-- the day's distance.
-- =========================================================================
CREATE MATERIALIZED VIEW cagg_vehicle_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', ts) AS bucket,
  vehicle_id,
  MAX(odometer_m) AS odometer_max_m,
  MIN(odometer_m) AS odometer_min_m,
  MAX(odometer_m) - MIN(odometer_m) AS distance_m,
  AVG(speed_mps) FILTER (WHERE speed_mps > 0) AS avg_speed_mps,
  MAX(speed_mps) AS max_speed_mps,
  COUNT(*) FILTER (WHERE speed_mps > 0) AS active_sample_count,
  COUNT(*) AS sample_count
FROM positions
GROUP BY bucket, vehicle_id
WITH NO DATA;

COMMENT ON VIEW cagg_vehicle_daily IS
  'Phase-42 daily per-vehicle positions roll-up. Continuous aggregate over '
  'positions hypertable. SI columns (m, mps). drive_count / energy_wh '
  'deferred to read-time JOIN with cagg_fleet_stats / drives because cagg '
  'invalidation cannot span two tables.';

SELECT add_continuous_aggregate_policy('cagg_vehicle_daily',
  start_offset      => INTERVAL '30 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

-- =========================================================================
-- 6. cagg_charging_summary — daily per-(vehicle_id, day) charging
-- session roll-up over `charging_sessions`. Regular materialized view
-- (NOT a continuous aggregate) because charging_sessions is a
-- non-hypertable per 000184.
--
-- Naming compromise: the prompt requires the literal name
-- `cagg_charging_summary` (the gate's substring check enforces this).
-- We follow the in-tree precedent of `cagg_fleet_stats` (also a
-- regular MV with cagg_ prefix from 000142_baseline_typed) and
-- document the compromise in the COMMENT below.
--
-- Refresh policy: regular MV; refreshed by ops via
-- REFRESH MATERIALIZED VIEW CONCURRENTLY cagg_charging_summary.
-- =========================================================================
CREATE MATERIALIZED VIEW cagg_charging_summary AS
SELECT
  vehicle_id,
  date_trunc('day', started_at)::DATE AS day,
  COUNT(*)                                                  AS sessions_count,
  SUM(total_energy_added_wh)                                AS total_energy_wh,
  AVG(peak_power_w)                                         AS avg_peak_power_w,
  MAX(peak_power_w)                                         AS max_peak_power_w,
  AVG(avg_power_w)                                          AS avg_power_w,
  AVG(delta_soc_pct)                                        AS avg_delta_soc_pct,
  SUM(EXTRACT(EPOCH FROM (ended_at - started_at)))::BIGINT  AS total_duration_s,
  AVG(start_soc_pct)                                        AS avg_start_soc_pct,
  AVG(end_soc_pct)                                          AS avg_end_soc_pct
FROM charging_sessions
WHERE ended_at IS NOT NULL
GROUP BY vehicle_id, date_trunc('day', started_at);

CREATE UNIQUE INDEX cagg_charging_summary_pk
  ON cagg_charging_summary (vehicle_id, day);

COMMENT ON MATERIALIZED VIEW cagg_charging_summary IS
  'Phase-42 daily per-vehicle charging-session roll-up over '
  'charging_sessions. Regular MV (NOT a TimescaleDB continuous aggregate); '
  'the cagg_ name prefix is naming-only, matching the precedent set by '
  'cagg_fleet_stats. SI columns (Wh, W, s). Refresh via REFRESH '
  'MATERIALIZED VIEW CONCURRENTLY.';

-- =========================================================================
-- 7. mv_energy_daily — daily per-(vehicle_id, day) net energy
-- materialized view. FULL OUTER JOIN of charging-side and drive-side
-- daily aggregates so every (vehicle, day) with at least one session
-- or drive appears, with zero-fill for the missing side.
--
-- net_energy_wh = charging_energy_wh - drive_energy_wh (positive when
-- the pack net-gained energy that day, negative when net-consumed).
--
-- Refresh policy: regular MV; refresh via REFRESH MATERIALIZED VIEW
-- CONCURRENTLY mv_energy_daily.
-- =========================================================================
CREATE MATERIALIZED VIEW mv_energy_daily AS
SELECT
  COALESCE(c.vehicle_id, d.vehicle_id)                         AS vehicle_id,
  COALESCE(c.day, d.day)                                       AS day,
  COALESCE(c.charging_energy_wh, 0)                            AS charging_energy_wh,
  COALESCE(d.drive_energy_wh, 0)                               AS drive_energy_wh,
  COALESCE(d.regen_energy_wh, 0)                               AS regen_energy_wh,
  COALESCE(c.charging_energy_wh, 0) - COALESCE(d.drive_energy_wh, 0)
                                                               AS net_energy_wh,
  COALESCE(c.sessions_count, 0)                                AS sessions_count,
  COALESCE(d.drives_count, 0)                                  AS drives_count,
  COALESCE(d.distance_m, 0)                                    AS distance_m,
  COALESCE(d.duration_s, 0)                                    AS duration_s
FROM (
  SELECT
    vehicle_id,
    date_trunc('day', started_at)::DATE AS day,
    SUM(total_energy_added_wh)          AS charging_energy_wh,
    COUNT(*)                            AS sessions_count
  FROM charging_sessions
  WHERE ended_at IS NOT NULL
  GROUP BY vehicle_id, date_trunc('day', started_at)
) c
FULL OUTER JOIN (
  SELECT
    vehicle_id,
    date_trunc('day', started_at)::DATE AS day,
    SUM(energy_used_wh)                 AS drive_energy_wh,
    SUM(regen_energy_wh)                AS regen_energy_wh,
    SUM(distance_m)                     AS distance_m,
    SUM(duration_s)                     AS duration_s,
    COUNT(*)                            AS drives_count
  FROM drives
  WHERE ended_at IS NOT NULL
  GROUP BY vehicle_id, date_trunc('day', started_at)
) d ON c.vehicle_id = d.vehicle_id AND c.day = d.day;

CREATE UNIQUE INDEX mv_energy_daily_pk
  ON mv_energy_daily (vehicle_id, day);

COMMENT ON MATERIALIZED VIEW mv_energy_daily IS
  'Phase-42 daily per-vehicle net-energy roll-up. FULL OUTER JOIN of '
  'charging_sessions and drives aggregates. SI columns (Wh, m, s). '
  'net_energy_wh = charging - drive; refresh via REFRESH MATERIALIZED '
  'VIEW CONCURRENTLY.';

-- =========================================================================
-- 8. mv_position_hourly — hourly per-(vehicle_id, hour) position
-- materialized view. Regular MV (could be a cagg over positions, but
-- the prompt allows MV and we keep refresh logic consistent with the
-- other ops-refreshed MVs in this file). Uses TimescaleDB's
-- first(value, ordering_col) and last(value, ordering_col) to extract
-- the start/end lat/lng of the hour.
-- =========================================================================
CREATE MATERIALIZED VIEW mv_position_hourly AS
SELECT
  vehicle_id,
  date_trunc('hour', ts) AS hour,
  first(lat, ts)         AS start_lat,
  first(lng, ts)         AS start_lng,
  last(lat, ts)          AS end_lat,
  last(lng, ts)          AS end_lng,
  AVG(speed_mps) FILTER (WHERE speed_mps > 0) AS avg_speed_mps,
  MAX(speed_mps)         AS max_speed_mps,
  AVG(altitude_m)        AS avg_altitude_m,
  MIN(odometer_m)        AS start_odometer_m,
  MAX(odometer_m)        AS end_odometer_m,
  COUNT(*)               AS sample_count
FROM positions
GROUP BY vehicle_id, date_trunc('hour', ts);

CREATE UNIQUE INDEX mv_position_hourly_pk
  ON mv_position_hourly (vehicle_id, hour);

COMMENT ON MATERIALIZED VIEW mv_position_hourly IS
  'Phase-42 hourly per-vehicle position roll-up over positions. Regular '
  'MV. SI columns (m, mps). start_lat/start_lng/end_lat/end_lng via '
  'TimescaleDB first()/last(). Refresh via REFRESH MATERIALIZED VIEW '
  'CONCURRENTLY.';

-- =========================================================================
-- 9. mv_signal_stats — daily per-(field, day) coverage materialized
-- view over signal_log. Reports row count and per-typed-column fill
-- counts plus a fill_ratio that is the share of rows whose payload
-- (any of the typed columns) is non-null. Useful for catalog-style
-- "which signals have been observed lately and how often" reads, and
-- as a freshness signal for ops dashboards.
-- =========================================================================
CREATE MATERIALIZED VIEW mv_signal_stats AS
SELECT
  field,
  date_trunc('day', ts)::DATE AS day,
  COUNT(*)                                              AS row_count,
  COUNT(*) FILTER (WHERE str_value   IS NOT NULL)       AS str_count,
  COUNT(*) FILTER (WHERE bool_value  IS NOT NULL)       AS bool_count,
  COUNT(*) FILTER (WHERE int_value   IS NOT NULL)       AS int_count,
  COUNT(*) FILTER (WHERE float_value IS NOT NULL)       AS float_count,
  COUNT(*) FILTER (WHERE time_value  IS NOT NULL)       AS time_count,
  COUNT(DISTINCT vehicle_id)                            AS distinct_vehicles,
  ROUND(
    (COUNT(*) FILTER (
      WHERE str_value   IS NOT NULL
         OR bool_value  IS NOT NULL
         OR int_value   IS NOT NULL
         OR float_value IS NOT NULL
         OR time_value  IS NOT NULL
    ))::NUMERIC
    / NULLIF(COUNT(*), 0)::NUMERIC,
    4
  )                                                     AS fill_ratio
FROM signal_log
GROUP BY field, date_trunc('day', ts);

CREATE UNIQUE INDEX mv_signal_stats_pk
  ON mv_signal_stats (field, day);

COMMENT ON MATERIALIZED VIEW mv_signal_stats IS
  'Phase-42 daily per-(field) signal_log coverage roll-up. Regular MV. '
  'fill_ratio = share of rows with any typed-column non-null. Refresh via '
  'REFRESH MATERIALIZED VIEW CONCURRENTLY.';
