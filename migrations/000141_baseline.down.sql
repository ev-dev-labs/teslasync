-- TeslaSync baseline down migration: drop everything in public schema.
-- Used only for local dev teardown; never run in production.
DO $$ DECLARE
    r RECORD;
BEGIN
    -- Drop all materialized views
    FOR r IN
        SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS public.%I CASCADE', r.matviewname);
    END LOOP;

    -- Drop all regular views
    FOR r IN
        SELECT viewname FROM pg_views WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.viewname);
    END LOOP;

    -- Drop all tables (CASCADE handles FK + partitions)
    FOR r IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
    END LOOP;

    -- Drop all user-defined functions
    FOR r IN
        SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.prokind = 'f'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', r.proname, r.args);
    END LOOP;

    -- Drop all enum/composite types
    FOR r IN
        SELECT t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typtype IN ('e', 'c')
          AND NOT EXISTS (
              SELECT 1 FROM pg_class c WHERE c.reltype = t.oid
          )
    LOOP
        EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
    END LOOP;
END $$;
