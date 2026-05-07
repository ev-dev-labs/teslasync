-- Phase-43a / Prompt 0006 — security_events acknowledgement columns + a
-- BIGSERIAL surrogate id for /guard/events/{event_id}/acknowledge.
--
-- The natural PK on security_events is the 3-tuple
--   (vehicle_id, ts, event_type)
-- which the writer (internal/tesla/router/writers/security_event_writer.go)
-- explicitly relies on at the writer's NOT EXISTS dedupe — two distinct
-- event_types at the same instant (e.g. AirbagDeployed AND Locked) are
-- expected to land on the same (vehicle_id, ts) bucket. The REST URL
-- /guard/events/{event_id}/acknowledge therefore can NOT use ts alone
-- as the surrogate identifier; we extend Decision #4 with a sequence-
-- backed BIGINT id column. The frontend GuardEvent type already expects
-- `id: number` (web/src/api/hooks/useGuard.ts:19-31) so the handler
-- shape is fixed regardless.
--
-- All operations use IF [NOT] EXISTS / WHERE id IS NULL so this
-- migration is idempotent and safe to re-run.
--
-- TimescaleDB note: a UNIQUE INDEX on (id) alone is rejected by the
-- hypertable on `ts`. We use a non-unique (vehicle_id, id) lookup
-- index instead — the sequence guarantees practical uniqueness, and
-- every UPDATE/SELECT path also filters on vehicle_id so a hypothetical
-- collision could not cross vehicles.

-- Surrogate id sequence + column. Two-step (BIGINT then SET DEFAULT
-- + backfill) avoids the hypertable rewrite that BIGSERIAL with
-- volatile DEFAULT would trigger on existing rows.
CREATE SEQUENCE IF NOT EXISTS security_events_id_seq;

ALTER TABLE security_events ADD COLUMN IF NOT EXISTS id BIGINT;
ALTER TABLE security_events ALTER COLUMN id SET DEFAULT nextval('security_events_id_seq');
ALTER SEQUENCE security_events_id_seq OWNED BY security_events.id;

-- Backfill existing rows. WHERE id IS NULL keeps it idempotent: a
-- re-run after partial completion picks up where it left off, and a
-- re-run after full completion is a no-op. On a large hypertable this
-- can touch every chunk — installs that already accumulated millions
-- of security_events rows should expect WAL/lock pressure proportional
-- to row count; small/fresh installs complete in milliseconds.
UPDATE security_events SET id = nextval('security_events_id_seq') WHERE id IS NULL;

-- Tighten the column once every row has a value. SET NOT NULL on a
-- column with an existing default + no nulls is a metadata-only change
-- in PostgreSQL 12+.
ALTER TABLE security_events ALTER COLUMN id SET NOT NULL;

-- (vehicle_id, id) is the lookup index used by the acknowledge
-- handler's WHERE id=$1 AND vehicle_id=$2. Non-unique because
-- TimescaleDB rejects unique indexes on a hypertable that don't
-- include the partition key (ts); the sequence + per-row INSERT
-- path is the practical uniqueness guarantee.
CREATE INDEX IF NOT EXISTS security_events_vehicle_id_idx
    ON security_events (vehicle_id, id);

-- Acknowledgement columns per Decision #4.
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS acknowledged_by TEXT;

COMMENT ON COLUMN security_events.id IS
  'Phase-43a / Prompt 0006 surrogate id for REST acknowledgement URL. Natural PK is (vehicle_id, ts, event_type); this column adds a single-token addressable identifier without altering the natural PK.';
COMMENT ON COLUMN security_events.acknowledged_at IS
  'Set by POST /vehicles/{vehicle_id}/guard/events/{event_id}/acknowledge. NULL means unacknowledged. Re-acknowledgement overwrites the timestamp per Decision #3.';
COMMENT ON COLUMN security_events.acknowledged_by IS
  'Actor identity (resolved via cfg.Auth.ForwardAuthHeader) at acknowledgement time. Empty string in open-mode installs that have no upstream auth — that is a deliberate match for actorFromRequest semantics, not a bug.';
