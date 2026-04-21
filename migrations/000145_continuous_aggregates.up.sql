-- TimescaleDB continuous aggregates for real-time analytics.
--
-- These pre-computed rollups replace on-the-fly aggregation over raw telemetry
-- hypertables. Each continuous aggregate refreshes incrementally on a schedule;
-- queries against them combine materialized data with recent unmaterialized rows
-- so results are always real-time.
--
-- Prerequisites:
--   * timescaledb extension installed (see migration 000141 baseline)
--   * Source tables converted to hypertables (see migration 000143)
--
-- Aggregates defined:
--   cagg_charging_hourly  — 1h buckets from charging_telemetry (battery + power)
--   cagg_vehicle_daily    — 1d buckets from charging_telemetry (battery summary)
--   cagg_climate_daily    — 1d buckets from climate_snapshots (inside/outside temps)
--   cagg_fleet_weekly     — 1w cascading aggregate from cagg_vehicle_daily
--
-- Notes / deviations from spec:
--   * The spec's cagg_vehicle_daily combined charging_telemetry battery data with
--     climate signals from a 'signals' JSONB column. Our schema stores climate in
--     a separate `climate_snapshots` table, so we split it into two daily aggregates.
--   * Requires TimescaleDB >= 2.12, which allows continuous aggregates to be
--     created inside transaction blocks via EXECUTE from a DO block. Older
--     TimescaleDB versions will error and the migration should be run manually.
--   * Fresh installs on plain Postgres (dev/CI) skip this gracefully, matching
--     the extension-gating pattern in 000143/000144.
--   * Retention policies drop raw telemetry older than 180 days while keeping
--     aggregates indefinitely — dashboards still work on historical data.

SET statement_timeout = 0;

DO $cagg$
DECLARE
    has_timescale boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'
    ) INTO has_timescale;

    IF NOT has_timescale THEN
        RAISE NOTICE 'timescaledb extension not installed; skipping continuous aggregate setup';
        RETURN;
    END IF;

    -- Guard against duplicate creation if the migration is re-run.
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.continuous_aggregates
        WHERE view_name = 'cagg_charging_hourly'
    ) THEN
        EXECUTE $ddl$
            CREATE MATERIALIZED VIEW cagg_charging_hourly
            WITH (timescaledb.continuous) AS
            SELECT
                vehicle_id,
                time_bucket(INTERVAL '1 hour', created_at) AS bucket,
                avg(battery_level)::double precision       AS avg_battery,
                max(battery_level)                         AS max_battery,
                min(battery_level)                         AS min_battery,
                avg(charger_voltage)                       AS avg_voltage,
                avg(charge_rate_mph)                       AS avg_charge_rate,
                avg(dc_charging_power)                     AS avg_dc_power,
                avg(ac_charging_power)                     AS avg_ac_power,
                max(dc_charging_power)                     AS max_dc_power,
                count(*)                                   AS sample_count
            FROM charging_telemetry
            GROUP BY vehicle_id, bucket
            WITH NO DATA
        $ddl$;

        PERFORM add_continuous_aggregate_policy('cagg_charging_hourly',
            start_offset      => INTERVAL '3 hours',
            end_offset        => INTERVAL '30 minutes',
            schedule_interval => INTERVAL '15 minutes'
        );
        RAISE NOTICE 'created continuous aggregate cagg_charging_hourly';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.continuous_aggregates
        WHERE view_name = 'cagg_vehicle_daily'
    ) THEN
        EXECUTE $ddl$
            CREATE MATERIALIZED VIEW cagg_vehicle_daily
            WITH (timescaledb.continuous) AS
            SELECT
                vehicle_id,
                time_bucket(INTERVAL '1 day', created_at) AS bucket,
                count(*)                                   AS telemetry_count,
                avg(battery_level)::double precision       AS avg_battery,
                min(battery_level)                         AS min_battery,
                max(battery_level)                         AS max_battery,
                avg(charge_rate_mph)                       AS avg_charge_rate,
                sum(dc_charging_energy_in)                 AS total_dc_energy,
                sum(ac_charging_energy_in)                 AS total_ac_energy,
                max(est_battery_range)                     AS max_est_range,
                min(est_battery_range)                     AS min_est_range
            FROM charging_telemetry
            GROUP BY vehicle_id, bucket
            WITH NO DATA
        $ddl$;

        PERFORM add_continuous_aggregate_policy('cagg_vehicle_daily',
            start_offset      => INTERVAL '3 days',
            end_offset        => INTERVAL '1 hour',
            schedule_interval => INTERVAL '1 hour'
        );
        RAISE NOTICE 'created continuous aggregate cagg_vehicle_daily';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.continuous_aggregates
        WHERE view_name = 'cagg_climate_daily'
    ) THEN
        EXECUTE $ddl$
            CREATE MATERIALIZED VIEW cagg_climate_daily
            WITH (timescaledb.continuous) AS
            SELECT
                vehicle_id,
                time_bucket(INTERVAL '1 day', created_at) AS bucket,
                count(*)                                   AS sample_count,
                avg(inside_temp)                           AS avg_inside_temp,
                min(inside_temp)                           AS min_inside_temp,
                max(inside_temp)                           AS max_inside_temp,
                avg(outside_temp)                          AS avg_outside_temp,
                min(outside_temp)                          AS min_outside_temp,
                max(outside_temp)                          AS max_outside_temp,
                avg(hvac_power)                            AS avg_hvac_power
            FROM climate_snapshots
            GROUP BY vehicle_id, bucket
            WITH NO DATA
        $ddl$;

        PERFORM add_continuous_aggregate_policy('cagg_climate_daily',
            start_offset      => INTERVAL '3 days',
            end_offset        => INTERVAL '1 hour',
            schedule_interval => INTERVAL '1 hour'
        );
        RAISE NOTICE 'created continuous aggregate cagg_climate_daily';
    END IF;

    -- Cascading aggregate: weekly fleet summary built from cagg_vehicle_daily.
    -- Hierarchical caggs avoid re-scanning raw telemetry on the weekly refresh.
    IF NOT EXISTS (
        SELECT 1 FROM timescaledb_information.continuous_aggregates
        WHERE view_name = 'cagg_fleet_weekly'
    ) THEN
        EXECUTE $ddl$
            CREATE MATERIALIZED VIEW cagg_fleet_weekly
            WITH (timescaledb.continuous) AS
            SELECT
                time_bucket(INTERVAL '1 week', bucket) AS week,
                count(DISTINCT vehicle_id)              AS vehicle_count,
                sum(telemetry_count)                    AS total_samples,
                avg(avg_battery)                        AS fleet_avg_battery,
                min(min_battery)                        AS fleet_min_battery,
                max(max_battery)                        AS fleet_max_battery,
                sum(total_dc_energy)                    AS fleet_total_dc_energy,
                sum(total_ac_energy)                    AS fleet_total_ac_energy
            FROM cagg_vehicle_daily
            GROUP BY week
            WITH NO DATA
        $ddl$;

        PERFORM add_continuous_aggregate_policy('cagg_fleet_weekly',
            start_offset      => INTERVAL '4 weeks',
            end_offset        => INTERVAL '1 day',
            schedule_interval => INTERVAL '1 day'
        );
        RAISE NOTICE 'created continuous aggregate cagg_fleet_weekly';
    END IF;

    -- Retention policies: automatic data lifecycle management.
    -- Raw telemetry is dropped after 180 days; continuous aggregates are
    -- preserved so historical dashboards and long-term trend analysis keep working.
    PERFORM add_retention_policy('charging_telemetry', INTERVAL '180 days',
        if_not_exists => true);
    PERFORM add_retention_policy('climate_snapshots',  INTERVAL '180 days',
        if_not_exists => true);
    PERFORM add_retention_policy('security_events',    INTERVAL '365 days',
        if_not_exists => true);

    -- Drop hourly aggregates after 1 year — daily/weekly remain indefinitely.
    PERFORM add_retention_policy('cagg_charging_hourly', INTERVAL '1 year',
        if_not_exists => true);

    RAISE NOTICE 'continuous aggregate setup complete';
END $cagg$;

-- Initial backfill is intentionally NOT performed here because
-- refresh_continuous_aggregate() is a procedure that cannot run inside a
-- transaction block (which migrations always are). Real-time aggregation is
-- enabled by default on these caggs, so queries will union materialized data
-- with recent unmaterialized rows and return complete results immediately.
-- To pre-materialize historical data for faster initial reads, run manually:
--
--   CALL refresh_continuous_aggregate('cagg_charging_hourly', NULL, NULL);
--   CALL refresh_continuous_aggregate('cagg_vehicle_daily',   NULL, NULL);
--   CALL refresh_continuous_aggregate('cagg_climate_daily',   NULL, NULL);
--   CALL refresh_continuous_aggregate('cagg_fleet_weekly',    NULL, NULL);
