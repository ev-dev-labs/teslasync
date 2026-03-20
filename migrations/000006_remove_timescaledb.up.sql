-- Migration: Remove TimescaleDB dependency, use native PG17 partitioning
-- This migration is safe to run on databases that never had TimescaleDB

-- Create a function to auto-create monthly partitions
CREATE OR REPLACE FUNCTION create_monthly_partition(
    parent_table TEXT,
    partition_date DATE DEFAULT CURRENT_DATE
) RETURNS void AS $$
DECLARE
    partition_name TEXT;
    start_date DATE;
    end_date DATE;
BEGIN
    start_date := date_trunc('month', partition_date);
    end_date := start_date + INTERVAL '1 month';
    partition_name := parent_table || '_' || to_char(start_date, 'YYYY_MM');
    
    -- Check if partition already exists
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = partition_name) THEN
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            partition_name, parent_table, start_date, end_date
        );
        RAISE NOTICE 'Created partition: %', partition_name;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create partitions for current and next month for all partitioned tables
SELECT create_monthly_partition('positions', CURRENT_DATE);
SELECT create_monthly_partition('positions', CURRENT_DATE + INTERVAL '1 month');
