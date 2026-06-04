-- Phase 2 / Prompt 04 (Contract C, storage) — continuous aggregates (CAGGs)
-- over canonical_signal for the doc-15 §3 reference queries Q1 and Q2, so the
-- hot tier serves dashboards/rollups without scanning raw canonical chunks.
--
-- Implements doc-15 §3 Q1/Q2. Depends on prompts 02 + 03
-- (000215_create_canonical_signals + 000216_signal_store_retention_policies,
-- the latter being the migration that actually runs
-- create_hypertable('canonical_signal', 'observed_at', ...) — a continuous
-- aggregate REQUIRES its source to be a hypertable). Blocks Phase 9 (Q1/Q2
-- bench). Hard rules: H13 (SI preservation), H10 (refresh-lag observability).
-- ADR-0017 (two-layer signal store).
--
-- Repo adaptation note
-- ────────────────────
-- The source prompt targets a Gradle/Flyway repo
-- (packages/contract-storage/sql/V0NN__signal_continuous_aggregates.sql) and
-- asks for the "next free V0NN" with V001–V010 untouched. This repository is
-- golang-migrate over TimescaleDB, so — exactly as the raw/canonical/retention
-- adaptations before it (000214 / 000215 / 000216) — this lands at golang-migrate
-- slot 000217 (the next free slot after 000216_signal_store_retention_policies),
-- leaving every earlier slot untouched. The semantics — a fine bucket for Q1, a
-- coarse rollup for Q2, both over canonical_signal grouped by
-- (vehicle_id, canonical_kind), plus their refresh policies — are exactly as the
-- prompt specifies.
--
-- ─── doc-15 §3 Q1 / Q2 — the two query shapes this migration pre-aggregates ──
--   * Q1 — 30-day, single-vehicle, single-signal chart. Served by
--     cagg_canonical_signal_hourly: an HOURLY time_bucket per
--     (vehicle_id, canonical_kind) carrying avg/min/max/last(num_value). A
--     30-day chart reads ~720 pre-rolled hourly rows for one series instead of
--     scanning every raw canonical row in the window.
--   * Q2 — 1-year, multi-signal rollup. Served by cagg_canonical_signal_daily:
--     a DAILY time_bucket per (vehicle_id, canonical_kind) with the same
--     avg/min/max/last(num_value) shape. A 1-year multi-signal rollup reads
--     ~365 rows per series.
--   The "30-day" and "1-year" figures are the QUERY windows the dashboards read
--   from already-materialized buckets — they are NOT the refresh windows. The
--   refresh policies below keep only the recent edge fresh (start_offset); the
--   deep history is materialized once by the initial CALL refresh / first
--   policy run and then served cheaply.
--
-- ─── H13 — AGGREGATES OF num_value STAY SI; NO UNIT CONVERSION HERE ──────────
-- num_value in canonical_signal is already SI-canonical (000215 header H13): the
-- unit is implied by the canonical_kind suffix (".._mps", ".._wh", ".._pct", …)
-- and is NEVER re-converted in the storage layer. avg/min/max/last over an
-- SI-canonical column are themselves SI-canonical in the SAME unit — averaging
-- metres-per-second yields metres-per-second — so these CAGGs introduce no unit
-- semantics of their own. The UI applies the display-unit preference at the
-- render boundary (useUnits()); these views, like the base table, are consumed
-- verbatim. Grouping by canonical_kind keeps each bucket single-unit, so the
-- aggregates are never mixing dimensions.
--
-- ─── H10 — refresh lag is OBSERVABLE, but that wiring is not DDL ─────────────
-- The refresh policies below give TimescaleDB the job metadata
-- (timescaledb_information.jobs / job_stats) from which the writer/ops layer
-- scrapes last-run / next-run / lag. Emitting the lag metric is a
-- writer/ops concern (a later prompt), NOT this migration — per H10 the DDL only
-- has to make the lag *observable* by attaching real, introspectable policies,
-- which it does.
--
-- ─── EXTENSION GATE (no-op without TimescaleDB) ─────────────────────────────
-- Same intent as prompt 03 (000216): the migration must be a clean no-op on a
-- vanilla Postgres without the timescaledb extension. There is, however, a hard
-- TimescaleDB constraint that prompt 03 did not face:
--   CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous) CANNOT run inside
--   a transaction block OR a PL/pgSQL function/DO block.
-- So — unlike 000216, whose retention/compression calls are all plain functions
-- that nest happily inside a `DO $$ IF EXISTS(timescaledb) $$` guard — the
-- continuous-aggregate CREATEs here CANNOT be wrapped in that same DO guard. The
-- gate is therefore expressed the only way TimescaleDB permits, matching the
-- in-repo precedent set by 000147 / 000188 (which also create CAGGs with bare,
-- un-guarded statements):
--   1. The CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous) statements
--      are inherently extension-gated by construction — the
--      `timescaledb.continuous` storage parameter is only resolvable when the
--      extension is installed. In THIS repo the extension is guaranteed present
--      by the baseline (000142_baseline_typed runs CREATE EXTENSION
--      timescaledb), exactly as 000216 notes, so the CREATEs always apply.
--   2. The add_continuous_aggregate_policy(...) calls — which ARE plain
--      functions — are wrapped in the prompt-03-style
--      `DO $$ IF EXISTS(pg_extension WHERE extname='timescaledb') $$` guard, so
--      on the (in-repo impossible) substrate where the extension is somehow
--      absent the policy attachment is a clean no-op rather than an error.
-- This honours the gate verbatim everywhere TimescaleDB's transaction rule
-- allows, and documents the one place it cannot.
--
-- ─── FORWARD-ONLY ───────────────────────────────────────────────────────────
-- Forward-only: the CAGGs are created WITH NO DATA (the canonical writer is
-- Phase 5; there is nothing to back-fill at this slot) and the refresh policies
-- materialise buckets going forward. No existing rows are rewritten.
--
-- ─── ROLLBACK ───────────────────────────────────────────────────────────────
-- 000217_signal_continuous_aggregates.down.sql drops the two continuous
-- aggregates (DROP MATERIALIZED VIEW ... IF EXISTS CASCADE, which also detaches
-- their refresh policies). Both views are fresh, not-yet-read objects owned
-- solely by this slot, so the rollback is non-destructive to other objects;
-- canonical_signal itself is dropped by 000215's down.

-- =========================================================================
-- Defensive cleanup: drop any stray prior versions of these CAGGs so the
-- migration can be re-applied against test databases that still hold objects
-- under these names. IF EXISTS + CASCADE make this safe and order-independent.
-- =========================================================================
DROP MATERIALIZED VIEW IF EXISTS cagg_canonical_signal_daily  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_canonical_signal_hourly CASCADE;

-- =========================================================================
-- Q1 source — cagg_canonical_signal_hourly: HOURLY time_bucket per
-- (vehicle_id, canonical_kind) over canonical_signal. Serves the doc-15 §3 Q1
-- single-vehicle / single-signal 30-day chart downsample.
--
-- avg/min/max/last(num_value) are all SI-canonical in the unit implied by
-- canonical_kind (H13) — no conversion. last(num_value, observed_at) gives the
-- end-of-bucket value for "current reading at this hour" chart points.
-- sample_count counts only numeric rows so string/bool canonical kinds that
-- happen to share a bucket do not inflate it.
-- =========================================================================
CREATE MATERIALIZED VIEW cagg_canonical_signal_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', observed_at) AS bucket,
  vehicle_id,
  canonical_kind,
  avg(num_value)                                  AS avg_value,
  min(num_value)                                  AS min_value,
  max(num_value)                                  AS max_value,
  last(num_value, observed_at)                    AS last_value,
  count(*) FILTER (WHERE num_value IS NOT NULL)   AS sample_count
FROM canonical_signal
GROUP BY bucket, vehicle_id, canonical_kind
WITH NO DATA;

COMMENT ON VIEW cagg_canonical_signal_hourly IS
  'doc-15 Q1 source: hourly continuous aggregate over canonical_signal per '
  '(vehicle_id, canonical_kind). avg/min/max/last(num_value) are SI-canonical '
  '(H13), unit implied by the canonical_kind suffix, never re-converted. Serves '
  'single-vehicle single-signal chart downsample.';

-- =========================================================================
-- Q2 source — cagg_canonical_signal_daily: DAILY time_bucket per
-- (vehicle_id, canonical_kind) over canonical_signal. Serves the doc-15 §3 Q2
-- 1-year multi-signal rollup.
--
-- Built directly over canonical_signal (not hierarchically over the hourly
-- CAGG): a daily avg must be the mean of the raw rows, not the mean-of-hourly-
-- means, which would silently mis-weight hours with different sample counts.
-- Same SI-canonical (H13) avg/min/max/last contract as the hourly view.
-- =========================================================================
CREATE MATERIALIZED VIEW cagg_canonical_signal_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', observed_at) AS bucket,
  vehicle_id,
  canonical_kind,
  avg(num_value)                                  AS avg_value,
  min(num_value)                                  AS min_value,
  max(num_value)                                  AS max_value,
  last(num_value, observed_at)                    AS last_value,
  count(*) FILTER (WHERE num_value IS NOT NULL)   AS sample_count
FROM canonical_signal
GROUP BY bucket, vehicle_id, canonical_kind
WITH NO DATA;

COMMENT ON VIEW cagg_canonical_signal_daily IS
  'doc-15 Q2 source: daily continuous aggregate over canonical_signal per '
  '(vehicle_id, canonical_kind). Built directly over the base table (not over '
  'the hourly CAGG) so daily avg is correctly raw-row-weighted. num_value '
  'aggregates are SI-canonical (H13). Serves the 1-year multi-signal rollup.';

-- =========================================================================
-- Refresh policies. Attached inside the prompt-03-style extension gate so the
-- policy wiring is a clean no-op on a Postgres without TimescaleDB (the CAGG
-- CREATEs above cannot be DO-gated — see the EXTENSION GATE note in the header).
--
-- start_offset is the recent window each scheduled run re-materialises (to
-- absorb late-arriving canonical writes); it is NOT the query window. end_offset
-- of 1 hour leaves the still-filling current bucket out of the materialisation.
--   * hourly — refresh the last 3 days every hour.
--   * daily  — refresh the last 7 days every hour.
-- These mirror the cadence of the existing signal CAGGs (000147 / 000188). H10:
-- the resulting jobs are introspectable via timescaledb_information.job_stats
-- for refresh-lag observability (metric emission is the writer/ops layer).
-- =========================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN

        PERFORM add_continuous_aggregate_policy('cagg_canonical_signal_hourly',
            start_offset      => INTERVAL '3 days',
            end_offset        => INTERVAL '1 hour',
            schedule_interval => INTERVAL '1 hour',
            if_not_exists     => TRUE);

        PERFORM add_continuous_aggregate_policy('cagg_canonical_signal_daily',
            start_offset      => INTERVAL '7 days',
            end_offset        => INTERVAL '1 hour',
            schedule_interval => INTERVAL '1 hour',
            if_not_exists     => TRUE);

    END IF;
END $$;
