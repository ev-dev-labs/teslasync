-- cagg_parity_test.sql
--
-- Verify that continuous aggregates produce the same numbers as an equivalent
-- raw-table GROUP BY query. A mismatch indicates either a misconfigured
-- refresh policy, a definition drift between the CAGG and the raw query, or
-- materialization lag larger than the test window.
--
-- Usage:
--   psql "$DB_URL" -v vehicle_id=1 -f scripts/cagg_parity_test.sql

\set ON_ERROR_STOP on
\set window '7 days'
\if :{?vehicle_id}
\else
    \set vehicle_id 1
\endif

\echo '=== CAGG Parity: cagg_charging_hourly vs raw charging_telemetry ==='

WITH params AS (
    SELECT :vehicle_id::bigint AS vid, INTERVAL :'window' AS w
),
cagg AS (
    SELECT c.bucket, c.vehicle_id, c.avg_battery, c.sample_count
    FROM public.cagg_charging_hourly c, params
    WHERE c.vehicle_id = params.vid
      AND c.bucket >= NOW() - params.w
),
manual AS (
    SELECT
        public.time_bucket('1 hour', t.created_at) AS bucket,
        t.vehicle_id,
        avg(t.battery_level) AS avg_battery,
        count(*)             AS sample_count
    FROM public.charging_telemetry t, params
    WHERE t.vehicle_id = params.vid
      AND t.created_at >= NOW() - params.w
    GROUP BY t.vehicle_id, public.time_bucket('1 hour', t.created_at)
),
joined AS (
    SELECT
        COALESCE(c.bucket, m.bucket)                              AS bucket,
        c.avg_battery                                             AS cagg_battery,
        m.avg_battery                                             AS manual_battery,
        abs(COALESCE(c.avg_battery, 0) - COALESCE(m.avg_battery, 0)) < 0.01 AS battery_ok,
        c.sample_count                                            AS cagg_count,
        m.sample_count                                            AS manual_count,
        COALESCE(c.sample_count, 0) = COALESCE(m.sample_count, 0) AS count_ok
    FROM cagg c
    FULL OUTER JOIN manual m
      ON c.bucket = m.bucket AND c.vehicle_id = m.vehicle_id
)
SELECT
    count(*)                                       AS total_buckets,
    count(*) FILTER (WHERE NOT battery_ok)         AS battery_mismatches,
    count(*) FILTER (WHERE NOT count_ok)           AS count_mismatches,
    CASE
        WHEN count(*) FILTER (WHERE NOT (battery_ok AND count_ok)) = 0
        THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM joined;

\echo ''
\echo '=== CAGG Parity: cagg_climate_hourly vs raw climate_snapshots ==='

WITH params AS (
    SELECT :vehicle_id::bigint AS vid, INTERVAL :'window' AS w
),
cagg AS (
    SELECT c.bucket, c.vehicle_id, c.avg_inside_temp, c.sample_count
    FROM public.cagg_climate_hourly c, params
    WHERE c.vehicle_id = params.vid
      AND c.bucket >= NOW() - params.w
),
manual AS (
    SELECT
        public.time_bucket('1 hour', t.created_at) AS bucket,
        t.vehicle_id,
        avg(t.inside_temp) AS avg_inside_temp,
        count(*)           AS sample_count
    FROM public.climate_snapshots t, params
    WHERE t.vehicle_id = params.vid
      AND t.created_at >= NOW() - params.w
    GROUP BY t.vehicle_id, public.time_bucket('1 hour', t.created_at)
),
joined AS (
    SELECT
        abs(COALESCE(c.avg_inside_temp, 0) - COALESCE(m.avg_inside_temp, 0)) < 0.01 AS temp_ok,
        COALESCE(c.sample_count, 0) = COALESCE(m.sample_count, 0)                   AS count_ok
    FROM cagg c
    FULL OUTER JOIN manual m
      ON c.bucket = m.bucket AND c.vehicle_id = m.vehicle_id
)
SELECT
    count(*)                                  AS total_buckets,
    count(*) FILTER (WHERE NOT temp_ok)       AS temp_mismatches,
    count(*) FILTER (WHERE NOT count_ok)      AS count_mismatches,
    CASE
        WHEN count(*) FILTER (WHERE NOT (temp_ok AND count_ok)) = 0
        THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM joined;

\echo ''
\echo '=== CAGG Parity: cagg_charging_daily vs cagg_charging_hourly roll-up ==='

WITH daily AS (
    SELECT bucket, vehicle_id, avg_battery, sample_count
    FROM public.cagg_charging_daily
    WHERE vehicle_id = :vehicle_id
      AND bucket >= NOW() - INTERVAL '30 days'
),
rollup AS (
    SELECT
        public.time_bucket('1 day', bucket) AS bucket,
        vehicle_id,
        avg(avg_battery) AS avg_battery,
        sum(sample_count) AS sample_count
    FROM public.cagg_charging_hourly
    WHERE vehicle_id = :vehicle_id
      AND bucket >= NOW() - INTERVAL '30 days'
    GROUP BY vehicle_id, public.time_bucket('1 day', bucket)
)
SELECT
    count(*) AS total_days,
    count(*) FILTER (
        WHERE abs(COALESCE(d.avg_battery, 0) - COALESCE(r.avg_battery, 0)) >= 0.01
    ) AS battery_mismatches,
    CASE
        WHEN count(*) FILTER (
            WHERE abs(COALESCE(d.avg_battery, 0) - COALESCE(r.avg_battery, 0)) >= 0.01
        ) = 0 THEN 'PASS' ELSE 'FAIL'
    END AS status
FROM daily d
FULL OUTER JOIN rollup r
  ON d.bucket = r.bucket AND d.vehicle_id = r.vehicle_id;
