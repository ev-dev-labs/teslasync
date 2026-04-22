-- =========================================================================
-- 24 — cagg_fleet_stats (daily per-vehicle drive roll-up)
-- ADR-006: replaces mv_energy_daily MV.
--
-- DEVIATION NOTE:
--   Implemented as a regular MATERIALIZED VIEW (not a TimescaleDB continuous
--   aggregate) because the source table `drives` is intentionally a regular,
--   mutable table (per schema 11 — "Mutable; re-scoring updates score column"),
--   and converting it to a hypertable is blocked by the incoming FK from
--   `trip_drives.drive_id → drives(id)` (TimescaleDB hypertables don't permit
--   FKs onto non-time unique columns). Naming kept as `cagg_*` for callsite
--   stability per ADR-006; refresh is operational (cron / maintenance worker
--   calls REFRESH MATERIALIZED VIEW CONCURRENTLY cagg_fleet_stats).
-- =========================================================================

CREATE MATERIALIZED VIEW cagg_fleet_stats AS
SELECT
  vehicle_id,
  time_bucket('1 day', start_ts) AS day,
  count(*)                         AS drive_count,
  sum(distance_mi)                 AS total_distance_mi,
  sum(energy_used_kwh)             AS total_energy_kwh,
  sum(regen_kwh)                   AS total_regen_kwh,
  sum(duration_min)                AS total_duration_min,
  avg(avg_speed_mph)               AS avg_speed_mph,
  max(max_speed_mph)               AS max_speed_mph,
  avg(score)                       AS avg_score
FROM drives
GROUP BY vehicle_id, day
WITH NO DATA;

COMMENT ON MATERIALIZED VIEW cagg_fleet_stats IS
  'Daily per-vehicle drive roll-up. ADR-006 — replaces mv_energy_daily. '
  'Regular MV (not CAGG) because drives is a mutable non-hypertable; '
  'refresh via maintenance worker.';

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX cagg_fleet_stats_pk
  ON cagg_fleet_stats (vehicle_id, day);
