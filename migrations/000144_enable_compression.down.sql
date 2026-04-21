-- Reverse compression setup: decompress chunks, remove policies, disable compression.
-- Safe to run on databases without timescaledb installed.

SET statement_timeout = 0;

DO $decompress$
DECLARE
    has_timescale boolean;
    rec record;
    tables text[] := ARRAY[
        'charging_telemetry',
        'climate_snapshots',
        'security_events',
        'motor_snapshots',
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
        RAISE NOTICE 'timescaledb extension not installed; nothing to roll back';
        RETURN;
    END IF;

    FOREACH tbl IN ARRAY tables LOOP
        IF NOT EXISTS (
            SELECT 1 FROM timescaledb_information.hypertables
            WHERE hypertable_schema = 'public' AND hypertable_name = tbl
        ) THEN
            CONTINUE;
        END IF;

        -- Remove policy first so it doesn't re-compress while we decompress.
        BEGIN
            PERFORM remove_compression_policy(format('public.%I', tbl)::regclass,
                if_exists => true);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'failed to remove compression policy on %.%: %', 'public', tbl, SQLERRM;
        END;

        -- Decompress all compressed chunks for this table.
        FOR rec IN
            SELECT c.chunk_schema, c.chunk_name
            FROM timescaledb_information.chunks c
            WHERE c.is_compressed
              AND c.hypertable_schema = 'public'
              AND c.hypertable_name = tbl
        LOOP
            BEGIN
                PERFORM decompress_chunk(
                    format('%I.%I', rec.chunk_schema, rec.chunk_name)::regclass,
                    if_compressed => true
                );
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'failed to decompress chunk %.%: %', rec.chunk_schema, rec.chunk_name, SQLERRM;
            END;
        END LOOP;

        -- Disable compression on the hypertable.
        BEGIN
            EXECUTE format('ALTER TABLE public.%I SET (timescaledb.compress = false)', tbl);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'failed to disable compression on %.%: %', 'public', tbl, SQLERRM;
        END;
    END LOOP;
END $decompress$;
