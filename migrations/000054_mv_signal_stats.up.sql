-- Materialized view: hourly signal statistics per vehicle per signal.
-- Pre-computes min/max/avg/count for numeric signals. Replaces full table
-- scans in signal_history_writer.go Stats().
--
-- Idempotent: drops existing view first in case a prior run partially succeeded.
DROP MATERIALIZED VIEW IF EXISTS mv_signal_stats;

CREATE MATERIALIZED VIEW mv_signal_stats AS
SELECT
    vehicle_id,
    signal,
    date_trunc('hour', created_at) AS hour,
    MIN(value_num)                 AS min_val,
    MAX(value_num)                 AS max_val,
    AVG(value_num)                 AS avg_val,
    COUNT(*)                       AS cnt
FROM signal_history
WHERE value_num IS NOT NULL
GROUP BY vehicle_id, signal, date_trunc('hour', created_at);

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX idx_mv_signal_stats_vehicle_signal_hour
    ON mv_signal_stats (vehicle_id, signal, hour);
