-- Migration: Remove TimescaleDB dependency, use native PG17 partitioning
-- This migration is safe to run on databases that never had TimescaleDB

-- Create a function to auto-create monthly partitions
-- The maintenance worker will call this function periodically
CREATE OR REPLACE FUNCTION create_monthly_partition(
    parent_table TEXT,
    partition_date DATE DEFAULT CURRENT_DATE
) RETURNS void AS $$
DECLARE
    partition_name TEXT;
    start_date DATE;
    end_date DATE;
    default_name TEXT;
BEGIN
    start_date := date_trunc('month', partition_date);
    end_date := start_date + INTERVAL '1 month';
    partition_name := parent_table || '_' || to_char(start_date, 'YYYY_MM');
    default_name := parent_table || '_default';
    
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = partition_name) THEN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = default_name) THEN
            EXECUTE format('ALTER TABLE %I DETACH PARTITION %I', parent_table, default_name);
        END IF;
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            partition_name, parent_table, start_date, end_date
        );
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = default_name) THEN
            EXECUTE format('ALTER TABLE %I ATTACH PARTITION %I DEFAULT', parent_table, default_name);
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql;
