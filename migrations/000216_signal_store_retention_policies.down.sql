-- Rollback for 000216_signal_store_retention_policies.up.sql.
--
-- Removes only what the up migration added: the retention + compression
-- policies and the compression setting on raw_signal + canonical_signal. Gated
-- on the TimescaleDB extension so it is a clean no-op without it, mirroring the
-- up gate. It does NOT un-hypertable the tables (TimescaleDB has no in-place
-- reversal) — the table drops live in 000215/000214 — so this rollback stays
-- strictly scoped and non-destructive to other objects.
--
-- TimescaleDB-aware ordering: drop retention + compression policies first
-- (otherwise toggling compression off / dropping a compressed hypertable can
-- spew warnings), then disable compression.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN

        PERFORM remove_retention_policy  ('canonical_signal', if_exists => TRUE);
        PERFORM remove_compression_policy('canonical_signal', if_exists => TRUE);
        PERFORM remove_retention_policy  ('raw_signal',       if_exists => TRUE);
        PERFORM remove_compression_policy('raw_signal',       if_exists => TRUE);

        ALTER TABLE canonical_signal SET (timescaledb.compress = FALSE);
        ALTER TABLE raw_signal       SET (timescaledb.compress = FALSE);

    END IF;
END $$;
