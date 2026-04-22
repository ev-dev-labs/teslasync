-- ============================================================================
-- TeslaSync baseline schema — DOWN migration
-- ============================================================================
-- Drops everything in the public schema, including all functions, tables,
-- continuous aggregates, types, and TimescaleDB extensions.
-- This is a destructive operation: only use it on dev/test databases.
-- ============================================================================

DO $$
DECLARE
    r RECORD;
BEGIN
    -- Drop continuous aggregates first (depends on hypertables)
    FOR r IN
        SELECT view_name
        FROM timescaledb_information.continuous_aggregates
        WHERE view_schema = 'public'
    LOOP
        EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS public.%I CASCADE', r.view_name);
    END LOOP;

    -- Drop all views
    FOR r IN
        SELECT viewname
        FROM pg_views
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.viewname);
    END LOOP;

    -- Drop all tables (CASCADE handles FKs and remaining views)
    FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
    END LOOP;

    -- Drop all functions defined in public schema (skip those owned by extensions)
    FOR r IN
        SELECT p.proname, oidvectortypes(p.proargtypes) AS args
        FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = p.oid AND d.deptype = 'e'
          )
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', r.proname, r.args);
    END LOOP;

    -- Drop all enum/composite types in public (skip those owned by extensions)
    FOR r IN
        SELECT t.typname
        FROM pg_type t
        WHERE t.typnamespace = 'public'::regnamespace
          AND t.typtype IN ('e', 'c')
          AND t.typrelid = 0
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d
              WHERE d.objid = t.oid AND d.deptype = 'e'
          )
    LOOP
        EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
    END LOOP;
END $$;

DROP EXTENSION IF EXISTS vector CASCADE;
DROP EXTENSION IF EXISTS timescaledb_toolkit CASCADE;
DROP EXTENSION IF EXISTS timescaledb CASCADE;
