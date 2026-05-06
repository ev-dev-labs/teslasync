-- Phase-42 / Prompt 0022: per-vehicle, point-in-time wire-format unit
-- history for Tesla Fleet Telemetry.
--
-- Tesla emits Setting{Distance,Temperature,TirePressure,Charge}Unit
-- signals each time a vehicle's user toggles a preference. The values
-- that follow (Odometer, BatteryRange, OutsideTemp, Tpms*, VehicleSpeed,
-- ...) are emitted in the wire-format unit that was active at sample
-- time. The normalize pipeline (prompt 0028) joins this table on
-- (vehicle_id, sample_time) and passes the result to units.ToSI; without
-- this row, units.ToSI returns ErrNoUnitContext and the sample is
-- dropped + counted (we never guess a default — guessing 'km' would
-- silently corrupt a US car).
--
-- ADR-004 #4: "every unit-bearing field is converted to canonical SI at
-- one place, and that one place needs the wire-format unit to do its
-- job." This table is the source of truth for that input.
--
-- NOTE on slot number: phase-42 prompt 0022 originally specified slot
-- 000160, but that slot was occupied by 000160_settings_ui_density (a
-- pre-existing phase-40 migration) before this phase began. Slot 000181
-- is the next free slot after 000167_achievement_unlocks (slots 161 and
-- 168+ are free, 168 chosen to follow the trailing edge of the existing
-- run). The schema, semantics, and Go code references are otherwise
-- exactly as the prompt specifies.

CREATE TABLE vehicle_unit_history (
  -- BIGSERIAL is the deterministic tiebreaker for collisions at the
  -- same effective_from instant: bootstrap (which uses time.Now()) and
  -- the first telemetry packet (which uses atomic.EmittedAt) can land
  -- on the same second. Without this column in ORDER BY, two pods can
  -- pick different "active" rows for the same t. The composite PK
  -- below keeps id participating in the index that the lookup query
  -- uses, so the BIGSERIAL is not just a tiebreaker but actually
  -- index-only-scannable.
  id              BIGSERIAL,
  vehicle_id      BIGINT      NOT NULL,
  unit_kind       TEXT        NOT NULL,
  unit_value      TEXT        NOT NULL,
  effective_from  TIMESTAMPTZ NOT NULL,
  source          TEXT        NOT NULL,

  -- Mirror of the closed Kind / Source sets in Go (unit_history/types.go).
  -- Adding a new value requires a new migration that ALTERs the CHECK,
  -- which keeps the database an authoritative second-line defense
  -- against drift in the Go code.
  CONSTRAINT vehicle_unit_history_kind_chk
    CHECK (unit_kind IN ('distance','temperature','pressure','charge')),
  CONSTRAINT vehicle_unit_history_source_chk
    CHECK (source IN ('telemetry','rest_bootstrap','manual')),

  -- Composite PK puts (vehicle_id, unit_kind, effective_from, id) in
  -- a B-tree that the lookup query can read in reverse — this is what
  -- makes the deterministic-tiebreaker rule "ORDER BY effective_from
  -- DESC, id DESC LIMIT 1" an index-only scan with constant cost
  -- regardless of how much history a vehicle accumulates.
  PRIMARY KEY (vehicle_id, unit_kind, effective_from, id),

  -- Idempotency contract: re-running the REST bootstrap or replaying
  -- the same MQTT payload is a no-op. Combined with ON CONFLICT DO
  -- NOTHING in repo.go, this lets every Record call be safely retried
  -- without duplicate rows. The (effective_from, value, source) tuple
  -- is the natural key — two distinct sources at the same instant ARE
  -- legitimately different rows (e.g. bootstrap and telemetry agreeing
  -- at process start).
  CONSTRAINT vehicle_unit_history_idem_uniq
    UNIQUE (vehicle_id, unit_kind, effective_from, unit_value, source)
);

-- Lookup index. The PK already covers (vehicle_id, unit_kind,
-- effective_from, id) so the lookup query
--
--   SELECT unit_value FROM vehicle_unit_history
--   WHERE vehicle_id=$1 AND unit_kind=$2 AND effective_from <= $3
--   ORDER BY effective_from DESC, id DESC LIMIT 1
--
-- is already an index-only scan via the PK. This explicit index named
-- vehicle_unit_history_lookup is a redundant safety net referenced by
-- the prompt's gate so the index exists under a stable name even if
-- a future schema change reshapes the PK columns. It uses DESC
-- ordering on effective_from + id so the planner can avoid a sort.
CREATE INDEX vehicle_unit_history_lookup
  ON vehicle_unit_history (vehicle_id, unit_kind, effective_from DESC, id DESC);

COMMENT ON TABLE vehicle_unit_history IS
  'Per-vehicle wire-format unit history for Tesla Fleet Telemetry. ADR-004 #4. '
  'NEVER use as the source of UI display preferences (those live in user settings).';

COMMENT ON COLUMN vehicle_unit_history.id IS
  'BIGSERIAL tiebreaker. Required for deterministic ORDER BY effective_from DESC, id DESC.';

COMMENT ON COLUMN vehicle_unit_history.unit_kind IS
  'distance | temperature | pressure | charge — mirrors unithistory.Kind.';

COMMENT ON COLUMN vehicle_unit_history.unit_value IS
  'Wire-format unit token: mi/km/F/C/psi/bar/charge_distance/charge_percent.';

COMMENT ON COLUMN vehicle_unit_history.effective_from IS
  'Wall-clock instant (UTC) at which this unit became active. Lookup is the largest effective_from <= sample_time.';

COMMENT ON COLUMN vehicle_unit_history.source IS
  'telemetry | rest_bootstrap | manual — provenance for audit and conflict resolution.';
