-- =========================================================================
-- 26 — cagg_signal_hourly (cold-signal hourly roll-up)
-- ADR-006: replaces mv_signal_stats. Combined with signal_observations'
-- 2-year retention (ADR-002), gives indefinite long-term signal shape.
-- =========================================================================

CREATE MATERIALIZED VIEW cagg_signal_hourly
WITH (timescaledb.continuous) AS
SELECT
  vehicle_id,
  signal_name,
  time_bucket('1 hour', ts) AS hour,
  count(*)                  AS sample_count,
  avg(value_numeric)        AS avg_value,
  min(value_numeric)        AS min_value,
  max(value_numeric)        AS max_value
FROM signal_observations
WHERE value_numeric IS NOT NULL
GROUP BY vehicle_id, signal_name, hour
WITH NO DATA;

COMMENT ON VIEW cagg_signal_hourly IS
  'Hourly per-(vehicle, signal) numeric roll-up. ADR-006 replaces mv_signal_stats. Excludes text/bool signals.';

SELECT add_continuous_aggregate_policy('cagg_signal_hourly',
  start_offset      => interval '30 days',
  end_offset        => interval '1 hour',
  schedule_interval => interval '1 hour');
