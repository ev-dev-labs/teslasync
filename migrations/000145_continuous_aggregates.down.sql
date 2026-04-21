-- Reverse continuous aggregate setup: remove retention policies, drop caggs.
-- Safe to run on databases without timescaledb installed.

SET statement_timeout = 0;

DO $revert$
DECLARE
    has_timescale boolean;
    retention_tables text[] := ARRAY[
        'charging_telemetry',
        'climate_snapshots',
        'security_events',
        'cagg_charging_hourly'
    ];
    cagg_views text[] := ARRAY[
        -- Drop cascading (weekly) aggregate first since it depends on daily.
        'cagg_fleet_weekly',
        'cagg_vehicle_daily',
        'cagg_climate_daily',
        'cagg_charging_hourly'
    ];
    tbl text;
    v text;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'
    ) INTO has_timescale;

    IF NOT has_timescale THEN
        RAISE NOTICE 'timescaledb extension not installed; nothing to roll back';
        RETURN;
    END IF;

    -- Remove retention policies.
    FOREACH tbl IN ARRAY retention_tables LOOP
        BEGIN
            PERFORM remove_retention_policy(format('public.%I', tbl)::regclass,
                if_exists => true);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'failed to remove retention policy on %: %', tbl, SQLERRM;
        END;
    END LOOP;

    -- Drop continuous aggregates (policies are removed automatically on DROP).
    FOREACH v IN ARRAY cagg_views LOOP
        IF EXISTS (
            SELECT 1 FROM timescaledb_information.continuous_aggregates
            WHERE view_name = v
        ) THEN
            EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS %I CASCADE', v);
            RAISE NOTICE 'dropped continuous aggregate %', v;
        END IF;
    END LOOP;
END $revert$;
