-- Phase 2 / Prompt 03 (Contract C, storage) — retention + compression policies
-- for the two-layer signal store (raw_signal + canonical_signal).
--
-- Implements TL-6; ADR-0017 (two-layer signal store); ADR-0345
-- (observability retention per-signal per-tier). Depends on prompts 01 + 02
-- (migrations 000214_create_raw_signals + 000215_create_canonical_signals).
-- Blocks Phase 9 (retention assertion). Hard rules: H17, H35, H10.
--
-- Repo adaptation note
-- ────────────────────
-- The source prompt targets a Gradle/Flyway repo
-- (packages/contract-storage/sql/V0NN__signal_retention_policies.sql) and notes
-- that Timescale wiring "lands in a later sprint" (the upstream V007 header), so
-- it asks the hypertable conversion to be GATED — a no-op when the TimescaleDB
-- extension is absent. This repository is golang-migrate over TimescaleDB and
-- already runs `CREATE EXTENSION IF NOT EXISTS timescaledb` in the baseline
-- (000142_baseline_typed), so the extension is normally present here. We still
-- honour the prompt's gate verbatim — the whole policy block is wrapped in a
-- `DO $$ ... IF EXISTS(pg_extension) ... $$` guard so the migration is a clean
-- no-op on any Postgres without TimescaleDB (and harmless when it is present).
-- This is forward-only (H17) and slots at 000216, the next free slot after
-- 000215_create_canonical_signals. Prompts 01/02 deferred the
-- create_hypertable call to "a later operational prompt"; this IS that prompt.
--
-- ─── GATE (no-op without the extension) ────────────────────────────────────
-- create_hypertable / add_compression_policy / add_retention_policy are
-- TimescaleDB functions that do not exist unless the extension is installed;
-- calling them on a vanilla Postgres errors. Guarding on
-- `pg_extension WHERE extname = 'timescaledb'` makes the migration apply cleanly
-- on either substrate, so activation stays effectively sprint-gated on the
-- extension being wired into the target deployment.
--
-- ─── H17 — FORWARD-ONLY, retention deletes CHUNKS not ROWS ──────────────────
-- raw_signal is append-only (H17): the writer never UPDATEs/DELETEs a row, and a
-- correction is a NEW row. A TimescaleDB retention policy does NOT issue
-- row-level DELETEs against live data — it DROPs whole expired chunks (the
-- physical partitions older than the window). Chunk expiry is a coarse,
-- time-bounded storage-reclamation operation, not an in-place mutation of any
-- retained reading, so it is fully compatible with the append-only / immutable
-- contract: every row that is still inside the window is byte-for-byte what the
-- provider emitted. The same reasoning applies to canonical_signal.
--
-- ─── TL-6 — raw compress@7d / 90d retention; canonical retention ≥ raw ──────
--   * raw_signal     — compress chunks ≥ 7 days old, retain 90 days total.
--   * canonical_signal — retention ≥ raw. Phase-1 BASELINE is 365 days
--     (≥ the 90-day raw window, mirroring the positions hypertable precedent in
--     000142). canonical is the long-lived query surface read by dashboards,
--     alerts, and automations, so it must outlive the raw replay substrate.
--
-- ─── ADR-0345 — per-tier scaling owned by deployment config, not hard-coded ──
-- The 365-day canonical baseline is the Phase-1 floor, NOT a per-tier ceiling.
-- Per-signal / per-tier retention scaling (e.g. a long-retention analytics tier)
-- is applied by deployment configuration per ADR-0345 — this migration does not
-- hard-code anything longer than the Phase-1 baseline. Cold-tier (ClickHouse)
-- retention is out of scope (Phase 6); CAGGs are out of scope (prompt 04).
--
-- ─── H35 / privacy ─────────────────────────────────────────────────────────
-- Both tables carry privacy_class (stamped from the SignalDescriptor,
-- ADR-0331); the retention windows above are the storage-tier expression of the
-- privacy/retention contract, reclaiming sensitive history on a bounded clock.
--
-- ─── ROLLBACK ──────────────────────────────────────────────────────────────
-- 000216_signal_store_retention_policies.down.sql removes the retention and
-- compression policies and disables compression on both tables (also gated on
-- the extension). It deliberately does NOT convert the hypertables back to plain
-- tables — TimescaleDB has no in-place un-hypertable, and the table-drop
-- rollbacks live in 000215/000214. Removing only what this migration added keeps
-- the down strictly scoped and non-destructive to other objects.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN

        -- Convert both layers to hypertables. observed_at is already part of
        -- each PK (000214/000215), so this is a pure metadata change. 1-day
        -- chunks per doc-15. The tables are unwritten at this slot (no shipped
        -- writer yet — see the 000214/000215 headers), so migrate_data is
        -- intentionally omitted: there is nothing to move and omitting it keeps
        -- the call safe inside golang-migrate's per-file transaction.
        PERFORM create_hypertable('raw_signal', 'observed_at',
            chunk_time_interval => INTERVAL '1 day',
            if_not_exists       => TRUE);
        PERFORM create_hypertable('canonical_signal', 'observed_at',
            chunk_time_interval => INTERVAL '1 day',
            if_not_exists       => TRUE);

        -- raw_signal: compression segmented by vehicle_id, newest-first order so
        -- recent-window reads decompress only the leading rows (matches the
        -- positions / signal_log compression shape in 000142 / 000145).
        ALTER TABLE raw_signal SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'vehicle_id',
            timescaledb.compress_orderby   = 'observed_at DESC'
        );
        -- TL-6: compress raw chunks ≥ 7 days old.
        PERFORM add_compression_policy('raw_signal', INTERVAL '7 days',
            if_not_exists => TRUE);
        -- TL-6: retain 90 days of raw (chunk expiry, H17-compatible).
        PERFORM add_retention_policy('raw_signal', INTERVAL '90 days',
            if_not_exists => TRUE);

        -- canonical_signal: same compression shape.
        ALTER TABLE canonical_signal SET (
            timescaledb.compress,
            timescaledb.compress_segmentby = 'vehicle_id',
            timescaledb.compress_orderby   = 'observed_at DESC'
        );
        PERFORM add_compression_policy('canonical_signal', INTERVAL '7 days',
            if_not_exists => TRUE);
        -- TL-6 / ADR-0345: retention ≥ raw. 365-day Phase-1 baseline; per-tier
        -- scaling is applied by deployment config, not hard-coded here.
        PERFORM add_retention_policy('canonical_signal', INTERVAL '365 days',
            if_not_exists => TRUE);

    END IF;
END $$;
