-- Enable TimescaleDB compression on hypertables for 90%+ storage savings.
--
-- segmentby = vehicle_id groups each vehicle's rows together in a chunk so that
--             queries filtering by vehicle stay fast on compressed data.
-- orderby   = created_at DESC sorts within each segment to optimize
--             "latest data" queries which dominate our workload.
--
-- Compression policies run automatically for chunks older than the threshold:
--   - High-volume tables: 7 days (charging_telemetry, climate_snapshots, etc.)
--   - Lower-volume tables: 3 days (tire_pressure_snapshots, media_snapshots, safety_snapshots)
--
-- Notes / deviations from spec:
--   * Gated on timescaledb extension being installed so fresh installs on plain
--     Postgres (dev/CI) skip this gracefully — matches pattern in 000143.
--   * `positions` is native PostgreSQL range-partitioned, not a TimescaleDB
--     hypertable, so it cannot use TimescaleDB compression and is excluded.
--   * Existing chunks older than the policy interval are compressed immediately
--     so savings are realized on historical data, not just future data.

SET statement_timeout = 0;  -- compressing existing chunks may take minutes

DO $compress$
DECLARE
    has_timescale boolean;
    rec record;
    tables_7d text[] := ARRAY[
        'charging_telemetry',
        'climate_snapshots',
        'security_events',
        'motor_snapshots'
    ];
    tables_3d text[] := ARRAY[
        'tire_pressure_snapshots',
        'media_snapshots',
        'safety_snapshots'
    ];
    tbl text;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'
    ) INTO has_timescale;

    IF NOT has_timescale THEN
        RAISE NOTICE 'timescaledb extension not installed; skipping compression setup';
        RETURN;
    END IF;

    -- Enable compression + schedule policy for 7-day tables.
    FOREACH tbl IN ARRAY tables_7d LOOP
        IF NOT EXISTS (
            SELECT 1 FROM timescaledb_information.hypertables
            WHERE hypertable_schema = 'public' AND hypertable_name = tbl
        ) THEN
            RAISE NOTICE 'table %.% is not a hypertable, skipping', 'public', tbl;
            CONTINUE;
        END IF;

        EXECUTE format(
            'ALTER TABLE public.%I SET ('
            ' timescaledb.compress,'
            ' timescaledb.compress_segmentby = ''vehicle_id'','
            ' timescaledb.compress_orderby = ''created_at DESC'''
            ')', tbl
        );
        PERFORM add_compression_policy(format('public.%I', tbl)::regclass,
            INTERVAL '7 days', if_not_exists => true);
        RAISE NOTICE 'enabled compression on %.% (7 day policy)', 'public', tbl;
    END LOOP;

    -- Enable compression + schedule policy for 3-day (lower-volume) tables.
    FOREACH tbl IN ARRAY tables_3d LOOP
        IF NOT EXISTS (
            SELECT 1 FROM timescaledb_information.hypertables
            WHERE hypertable_schema = 'public' AND hypertable_name = tbl
        ) THEN
            RAISE NOTICE 'table %.% is not a hypertable, skipping', 'public', tbl;
            CONTINUE;
        END IF;

        EXECUTE format(
            'ALTER TABLE public.%I SET ('
            ' timescaledb.compress,'
            ' timescaledb.compress_segmentby = ''vehicle_id'','
            ' timescaledb.compress_orderby = ''created_at DESC'''
            ')', tbl
        );
        PERFORM add_compression_policy(format('public.%I', tbl)::regclass,
            INTERVAL '3 days', if_not_exists => true);
        RAISE NOTICE 'enabled compression on %.% (3 day policy)', 'public', tbl;
    END LOOP;

    -- Compress any already-existing chunks past their threshold so historical
    -- data benefits immediately rather than waiting for the background job.
    FOR rec IN
        SELECT c.chunk_schema, c.chunk_name, c.hypertable_name, c.range_end
        FROM timescaledb_information.chunks c
        WHERE NOT c.is_compressed
          AND c.hypertable_schema = 'public'
          AND (
              (c.hypertable_name = ANY(tables_7d) AND c.range_end < NOW() - INTERVAL '7 days')
              OR
              (c.hypertable_name = ANY(tables_3d) AND c.range_end < NOW() - INTERVAL '3 days')
          )
        ORDER BY c.range_end
    LOOP
        BEGIN
            PERFORM compress_chunk(
                format('%I.%I', rec.chunk_schema, rec.chunk_name)::regclass,
                if_not_compressed => true
            );
            RAISE NOTICE 'compressed existing chunk %.%', rec.chunk_schema, rec.chunk_name;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'failed to compress chunk %.%: %', rec.chunk_schema, rec.chunk_name, SQLERRM;
        END;
    END LOOP;
END $compress$;
