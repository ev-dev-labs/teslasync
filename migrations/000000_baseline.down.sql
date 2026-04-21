-- Drop everything in reverse dependency order.
-- This is a fresh-install baseline teardown; it wipes the entire public schema.
DO $$ DECLARE
    r RECORD;
BEGIN
    -- Drop all materialized views first
    FOR r IN SELECT matviewname FROM pg_matviews WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS public.%I CASCADE', r.matviewname);
    END LOOP;

    -- Drop all regular views
    FOR r IN SELECT viewname FROM pg_views WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.viewname);
    END LOOP;

    -- Drop all functions (CASCADE pulls triggers that depend on them)
    FOR r IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', r.proname, r.args);
    END LOOP;

    -- Drop all tables
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
    END LOOP;

    -- Drop all sequences left behind
    FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'
    LOOP
        EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.sequence_name);
    END LOOP;

    -- Drop all enum types
    FOR r IN SELECT t.typname FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE n.nspname = 'public' AND t.typtype = 'e'
    LOOP
        EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
    END LOOP;
END $$;
