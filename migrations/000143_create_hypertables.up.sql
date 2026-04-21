-- Convert time-series tables to TimescaleDB hypertables.
--
-- migrate_data => true moves existing rows into chunks.
-- if_not_exists => true makes this safe to re-run.
-- chunk_time_interval defaults to 7 days (good for our write rate of ~2,880 rows/day/vehicle).
--
-- Notes / deviations from spec:
--   * The entire migration is gated on the timescaledb extension being installed
--     so fresh installs on plain Postgres (dev/CI) skip this gracefully, matching
--     the extension-install pattern in 000141_baseline.
--   * TimescaleDB requires the partitioning column (created_at) to be part of any
--     UNIQUE/PRIMARY KEY. Most telemetry tables have PRIMARY KEY (id) today, so we
--     expand those PKs to (id, created_at) before calling create_hypertable.
--   * `positions` is already PostgreSQL-native range-partitioned on created_at and
--     cannot be converted into a TimescaleDB hypertable in place; it is intentionally
--     skipped here.

SET statement_timeout = 0;  -- migration may take minutes on large tables

DO $hyper$
DECLARE
    has_timescale boolean;
    tbl text;
    tables text[] := ARRAY[
        'charging_telemetry',
        'climate_snapshots',
        'security_events',
        'motor_snapshots',
        'tire_pressure_snapshots',
        'media_snapshots',
        'safety_snapshots'
    ];
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'
    ) INTO has_timescale;

    IF NOT has_timescale THEN
        RAISE NOTICE 'timescaledb extension not installed; skipping hypertable conversion';
        RETURN;
    END IF;

    FOREACH tbl IN ARRAY tables LOOP
        -- Skip if the table doesn't exist (defensive — all should exist from baseline).
        IF NOT EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = tbl AND c.relkind = 'r'
        ) THEN
            RAISE NOTICE 'table %.% not found, skipping', 'public', tbl;
            CONTINUE;
        END IF;

        -- Skip if already a hypertable.
        IF EXISTS (
            SELECT 1 FROM timescaledb_information.hypertables
            WHERE hypertable_schema = 'public' AND hypertable_name = tbl
        ) THEN
            RAISE NOTICE 'table %.% is already a hypertable, skipping', 'public', tbl;
            CONTINUE;
        END IF;

        -- Ensure the primary key includes created_at (TimescaleDB constraint).
        -- If the existing PK is just (id), replace it with (id, created_at).
        IF EXISTS (
            SELECT 1
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = 'public'
              AND rel.relname = tbl
              AND con.contype = 'p'
              AND NOT EXISTS (
                  SELECT 1
                  FROM unnest(con.conkey) AS k(attnum)
                  JOIN pg_attribute a
                    ON a.attrelid = con.conrelid AND a.attnum = k.attnum
                  WHERE a.attname = 'created_at'
              )
        ) THEN
            EXECUTE format(
                'ALTER TABLE public.%I DROP CONSTRAINT %I',
                tbl, tbl || '_pkey'
            );
            EXECUTE format(
                'ALTER TABLE public.%I ADD CONSTRAINT %I PRIMARY KEY (id, created_at)',
                tbl, tbl || '_pkey'
            );
            RAISE NOTICE 'expanded %.% primary key to (id, created_at)', 'public', tbl;
        END IF;

        -- Convert to hypertable.
        EXECUTE format(
            $create$SELECT create_hypertable('public.%I', 'created_at',
                migrate_data => true,
                if_not_exists => true,
                chunk_time_interval => INTERVAL '7 days')$create$,
            tbl
        );
        RAISE NOTICE 'converted %.% to hypertable', 'public', tbl;
    END LOOP;
END $hyper$;
