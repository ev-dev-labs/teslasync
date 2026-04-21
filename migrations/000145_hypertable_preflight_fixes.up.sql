-- Hypertable preflight: fix constraints that block create_hypertable().
-- Must run BEFORE migration 000146_create_hypertables.
--
-- TimescaleDB requires the partitioning column (created_at) to be part of
-- every unique constraint / primary key. Seven of the eight candidate
-- telemetry tables ship with a single-column BIGSERIAL primary key; this
-- migration rewrites them to composite (id, created_at) primary keys.
--
-- Preflight audit (run against the live DB to confirm state before/after):
--
--   -- Primary keys must include created_at
--   SELECT tc.table_name,
--          string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS pk_columns
--   FROM information_schema.table_constraints tc
--   JOIN information_schema.key_column_usage kcu
--        ON tc.constraint_name = kcu.constraint_name
--       AND tc.table_schema   = kcu.table_schema
--   WHERE tc.constraint_type = 'PRIMARY KEY'
--     AND tc.table_name IN (
--         'charging_telemetry','climate_snapshots','security_events','positions',
--         'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots')
--   GROUP BY tc.table_name;
--
--   -- No inbound foreign keys allowed on hypertables
--   SELECT tc.constraint_name, tc.table_name AS referencing_table,
--          ccu.table_name AS referenced_table
--   FROM information_schema.table_constraints tc
--   JOIN information_schema.constraint_column_usage ccu
--        ON tc.constraint_name = ccu.constraint_name
--   WHERE tc.constraint_type = 'FOREIGN KEY'
--     AND ccu.table_name IN (
--         'charging_telemetry','climate_snapshots','security_events','positions',
--         'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots');
--
--   -- No BEFORE ROW triggers allowed on hypertables
--   SELECT event_object_table, trigger_name, action_timing
--   FROM information_schema.triggers
--   WHERE event_object_table IN (
--         'charging_telemetry','climate_snapshots','security_events','positions',
--         'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots')
--     AND action_timing = 'BEFORE';
--
-- The schema squash captured in 000000_baseline already has zero inbound FKs
-- and zero triggers on these tables (confirmed via audit), so the only
-- blockers are the single-column primary keys. The DO blocks below are
-- defensive: they drop any future inbound FK or BEFORE trigger if present.

SET statement_timeout = 0;

BEGIN;

-- ============================================================
-- 0. Flatten any natively-partitioned candidate table into a regular table.
-- ============================================================
-- Pre-squash environments may have ALTERed a candidate table into a
-- declaratively partitioned parent (relkind='p'). TimescaleDB cannot convert
-- a partitioned table to a hypertable, so we must flatten it first.
--
-- Strategy per partitioned table T:
--   1. Detach the BIGSERIAL sequence so `DROP TABLE ... CASCADE` does not
--      cascade into it (the new regular table re-uses the sequence).
--   2. Create a sibling regular table `T_flat` via CREATE TABLE LIKE
--      (LIKE on a partitioned parent produces a regular table).
--   3. `INSERT INTO T_flat SELECT * FROM T` reads through all partitions.
--   4. Drop the partitioned parent (cascades to all partitions).
--   5. Rename `T_flat` -> T, rename its PK index back to `T_pkey`.
--   6. Recreate foreign keys (LIKE does not copy FK constraints) and reattach
--      sequence ownership / bump the sequence past max(id).
--
-- Only `positions` is known to be partitioned in legacy environments; the
-- loop below handles any other candidate should that change.
DO $$
DECLARE
    t TEXT;
    r RECORD;
    max_id BIGINT;
BEGIN
    FOR t IN SELECT unnest(ARRAY[
                 'charging_telemetry','climate_snapshots','security_events','positions',
                 'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots'])
    LOOP
        IF EXISTS (
            SELECT 1 FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'p'
        ) THEN
            RAISE NOTICE 'Flattening native-partitioned table %', t;

            -- 1. Detach the sequence from the doomed column so it survives the DROP
            IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t || '_id_seq' AND relkind = 'S') THEN
                EXECUTE format('ALTER SEQUENCE %I OWNED BY NONE', t || '_id_seq');
            END IF;

            -- 2. Create a flat sibling copying defaults + constraints + indexes + storage
            EXECUTE format(
                'CREATE TABLE %I (LIKE %I INCLUDING DEFAULTS INCLUDING CONSTRAINTS '
                'INCLUDING INDEXES INCLUDING STORAGE INCLUDING COMMENTS INCLUDING GENERATED)',
                t || '_flat', t);

            -- 3. Move all rows (SELECT reads across every partition)
            EXECUTE format('INSERT INTO %I SELECT * FROM %I', t || '_flat', t);

            -- 4. Capture outbound FKs before we drop the parent so we can recreate them
            --    (LIKE does NOT copy FK constraints).
            CREATE TEMP TABLE IF NOT EXISTS _fk_replay (ddl TEXT) ON COMMIT DROP;
            FOR r IN
                SELECT pg_get_constraintdef(con.oid) AS def
                FROM pg_constraint con
                JOIN pg_class c ON c.oid = con.conrelid
                WHERE c.relname = t
                  AND con.contype = 'f'
            LOOP
                INSERT INTO _fk_replay(ddl)
                VALUES (format('ALTER TABLE %I ADD %s', t, r.def));
            END LOOP;

            -- 5. Drop the partitioned parent (and partitions) and promote the flat table
            EXECUTE format('DROP TABLE %I CASCADE', t);
            EXECUTE format('ALTER TABLE %I RENAME TO %I', t || '_flat', t);

            -- 6. Rename PK index from <t>_flat_pkey back to <t>_pkey if present
            IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t || '_flat_pkey' AND relkind = 'i') THEN
                EXECUTE format('ALTER INDEX %I RENAME TO %I', t || '_flat_pkey', t || '_pkey');
            END IF;

            -- 7. Reattach sequence and advance it past existing ids
            IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t || '_id_seq' AND relkind = 'S') THEN
                EXECUTE format('ALTER SEQUENCE %I OWNED BY %I.id', t || '_id_seq', t);
                EXECUTE format('SELECT setval(%L, GREATEST(COALESCE((SELECT max(id) FROM %I), 0), 1))',
                               t || '_id_seq', t);
            END IF;

            -- 8. Recreate foreign keys captured in step 4
            FOR r IN SELECT ddl FROM _fk_replay LOOP
                EXECUTE r.ddl;
            END LOOP;
            DELETE FROM _fk_replay;
        END IF;
    END LOOP;
END $$;

-- Recreate mv_position_hourly if it was dropped while flattening `positions`.
-- Migration 000148 later replaces it with a TimescaleDB continuous aggregate,
-- but we keep the legacy MV intact so environments that pause at this
-- migration do not lose a pre-existing artifact.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname='positions' AND c.relkind='r')
       AND NOT EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname='mv_position_hourly') THEN
        CREATE MATERIALIZED VIEW public.mv_position_hourly AS
            SELECT vehicle_id,
                   date_trunc('hour'::text, created_at) AS hour,
                   avg(speed)         AS avg_speed,
                   avg(power)         AS avg_power,
                   avg(battery_level) AS avg_battery,
                   avg(latitude)      AS avg_lat,
                   avg(longitude)     AS avg_lng,
                   avg(inside_temp)   AS avg_inside_temp,
                   avg(outside_temp)  AS avg_outside_temp,
                   count(*)           AS sample_count,
                   min(created_at)    AS first_at,
                   max(created_at)    AS last_at
            FROM public.positions
            GROUP BY vehicle_id, date_trunc('hour'::text, created_at)
            WITH NO DATA;
        CREATE UNIQUE INDEX idx_mv_position_hourly_vehicle_hour
            ON public.mv_position_hourly USING btree (vehicle_id, hour);
    END IF;
END $$;

-- ============================================================
-- 1. Drop inbound foreign keys TO candidate hypertable tables.
-- ============================================================
-- FKs pointing AT a hypertable are not supported. Outbound FKs are fine.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT DISTINCT tc.constraint_name, tc.table_schema, tc.table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
           AND tc.table_schema   = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name IN (
              'charging_telemetry','climate_snapshots','security_events','positions',
              'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots')
    LOOP
        EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
                       r.table_schema, r.table_name, r.constraint_name);
        RAISE NOTICE 'Dropped inbound FK % on %.%',
                     r.constraint_name, r.table_schema, r.table_name;
    END LOOP;
END $$;

-- ============================================================
-- 2. Demote BEFORE ROW triggers to AFTER.
-- ============================================================
-- BEFORE ROW triggers are not supported on hypertables. The current schema
-- defines none; this guard exists so a future trigger added before this
-- migration re-runs in a fresh environment still produces a valid state.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT event_object_schema, event_object_table, trigger_name
        FROM information_schema.triggers
        WHERE event_object_table IN (
              'charging_telemetry','climate_snapshots','security_events','positions',
              'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots')
          AND action_timing = 'BEFORE'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I.%I',
                       r.trigger_name, r.event_object_schema, r.event_object_table);
        RAISE NOTICE 'Dropped BEFORE trigger % on %.% (recreate as AFTER manually)',
                     r.trigger_name, r.event_object_schema, r.event_object_table;
    END LOOP;
END $$;

-- ============================================================
-- 3. Replace single-column PKs with composite (id, created_at) PKs.
-- ============================================================
-- `positions` already has a composite PK in the baseline, but the
-- DROP ... IF EXISTS + ADD pattern is idempotent for every table.
--
-- BIGSERIAL auto-increment continues to work under composite PKs: the
-- underlying sequence is still owned by `id`, so INSERTs that only provide
-- vehicle_id and rely on DEFAULT now() for created_at keep working.

ALTER TABLE charging_telemetry DROP CONSTRAINT IF EXISTS charging_telemetry_pkey;
ALTER TABLE charging_telemetry ADD  PRIMARY KEY (id, created_at);

ALTER TABLE climate_snapshots DROP CONSTRAINT IF EXISTS climate_snapshots_pkey;
ALTER TABLE climate_snapshots ADD  PRIMARY KEY (id, created_at);

ALTER TABLE security_events DROP CONSTRAINT IF EXISTS security_events_pkey;
ALTER TABLE security_events ADD  PRIMARY KEY (id, created_at);

ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_pkey;
ALTER TABLE positions ADD  PRIMARY KEY (id, created_at);

ALTER TABLE motor_snapshots DROP CONSTRAINT IF EXISTS motor_snapshots_pkey;
ALTER TABLE motor_snapshots ADD  PRIMARY KEY (id, created_at);

ALTER TABLE tire_pressure_snapshots DROP CONSTRAINT IF EXISTS tire_pressure_snapshots_pkey;
ALTER TABLE tire_pressure_snapshots ADD  PRIMARY KEY (id, created_at);

ALTER TABLE media_snapshots DROP CONSTRAINT IF EXISTS media_snapshots_pkey;
ALTER TABLE media_snapshots ADD  PRIMARY KEY (id, created_at);

ALTER TABLE safety_snapshots DROP CONSTRAINT IF EXISTS safety_snapshots_pkey;
ALTER TABLE safety_snapshots ADD  PRIMARY KEY (id, created_at);

-- ============================================================
-- 4. Unique constraints.
-- ============================================================
-- Audit of 000000_baseline confirms none of the candidate tables carry a
-- UNIQUE constraint beyond the primary key handled above. If a future
-- migration introduces one, it MUST include created_at in the column list.

COMMIT;
