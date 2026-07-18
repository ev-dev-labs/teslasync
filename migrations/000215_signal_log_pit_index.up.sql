-- Migration 215: Point-in-time reconstruction index for signal_log.
--
-- Goal: keep the Vehicle Time Machine's point-in-time state query fast.
-- The reconstruction endpoint runs, for every distinct field of a vehicle,
-- a `DISTINCT ON (field) ... WHERE vehicle_id = $1 AND ts <= $2
-- ORDER BY field, ts DESC` scan (the "last row at-or-before an instant"
-- pattern). That access path is served ideally by a composite btree on
-- (vehicle_id, field, ts DESC): Postgres walks each field's leading edge
-- and stops at the first row whose ts <= the requested instant.
--
-- Equivalence check (this migration is intentionally a safe no-op on an
-- up-to-date schema):
--   000186_signal_log.up.sql already created
--       CREATE INDEX signal_log_vehicle_field_ts
--         ON signal_log (vehicle_id, field, ts DESC);
--   which is column-for-column identical to the index this migration
--   would otherwise add. Creating a second, differently-named index on
--   the same tuple would only duplicate write amplification and disk with
--   zero read benefit. So the guarded DO block below detects ANY existing
--   index on signal_log that leads with (vehicle_id, field, ts DESC) and
--   skips creation; on a database that somehow lacks it (e.g. a hand-rolled
--   schema, or a future migration that drops 000186's index) it falls
--   through to the canonical CREATE INDEX IF NOT EXISTS. Either way the
--   migration is idempotent and leaves the fast path in place.
--
-- Reversible by the matching .down.sql, which drops ONLY the index this
-- migration may have created (idx_signal_log_vehicle_field_ts) and never
-- the 000186-owned signal_log_vehicle_field_ts.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename  = 'signal_log'
      AND indexdef ILIKE '%(vehicle_id, field, ts DESC)%'
  ) THEN
    RAISE NOTICE
      'idx_signal_log_vehicle_field_ts: an equivalent (vehicle_id, field, ts DESC) index already exists on signal_log; skipping (no-op).';
  ELSE
    CREATE INDEX IF NOT EXISTS idx_signal_log_vehicle_field_ts
      ON signal_log (vehicle_id, field, ts DESC);
  END IF;
END$$;
