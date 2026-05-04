-- Phase-42 / Prompt 0035: fsm_transitions + vehicle_live_state.
--
-- ADR-004 layered live-state contract — these two tables are the durable
-- DB-side anchors for live state and the FSM transition log:
--
--   * vehicle_live_state mirrors the L2 (Redis) HSET
--     `vehicle:{vehicleID}:signals` so that, after a Redis flush or a
--     full restart, every consumer can recover the current per-vehicle
--     state from the database without replaying history. SignalStore (L1)
--     and the Redis HSET (L2) remain the hot read paths; this table is a
--     periodic, low-frequency snapshot.
--   * fsm_transitions is the append-only state-machine transition log
--     that backs drive/charge/climate FSM debugging, completion logic,
--     and timeline UIs. One row per state transition per FSM per vehicle.
--
-- Neither table is a hypertable: vehicle_live_state is keyed by vehicle
-- (one row per vehicle, ever); fsm_transitions has too few rows per
-- vehicle (~1000s/year) to benefit from chunk-based partitioning. They
-- live as plain regular tables.
--
-- Forward-only rewrite: phase-42 abolishes the legacy fsm_state /
-- live_state schema (if any predecessor left such artifacts). The
-- defensive DROP IF EXISTS preamble keeps this migration idempotent
-- against test databases that still hold legacy objects.
--
-- Slot variance: prompt 0035 hardcodes slot 000167, but that slot is
-- already occupied by 000167_achievement_unlocks (a pre-phase-42
-- migration committed before this phase began). Slot 000174 is the next
-- free slot after the trailing edge of existing migrations
-- (000173_signal_log is the immediately prior phase-42 migration,
-- created by prompt 0034). This mirrors the slot-variance the
-- predecessor phase-42 prompts 0022 (000160 -> 000168), 0030
-- (000162 -> 000169), 0031 (000163 -> 000170), 0032 (000164 -> 000171),
-- 0033 (000165 -> 000172), and 0034 (000166 -> 000173) applied. The
-- schema, semantics, and gate intent are otherwise exactly as the
-- prompt specifies.

-- =========================================================================
-- Defensive cleanup: drop any legacy objects with the same names so this
-- migration can be re-applied against test databases without conflict.
-- =========================================================================
DROP TABLE IF EXISTS fsm_transitions    CASCADE;
DROP TABLE IF EXISTS vehicle_live_state CASCADE;

-- =========================================================================
-- fsm_transitions — append-only state-machine transition log.
-- One row per state change per FSM per vehicle. Surrogate BIGSERIAL PK
-- keeps the writer hot path lock-free; (vehicle_id, ts) and (fsm_name,
-- ts) indexes back the two dominant query shapes ("show this vehicle's
-- recent transitions" and "show all vehicles' transitions through a
-- given FSM").
-- =========================================================================
CREATE TABLE fsm_transitions (
  id         BIGSERIAL PRIMARY KEY,
  vehicle_id BIGINT NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,
  fsm_name   TEXT NOT NULL,
  from_state TEXT,
  to_state   TEXT NOT NULL,
  trigger    TEXT,
  details    JSONB
);

CREATE INDEX fsm_transitions_vehicle_ts ON fsm_transitions (vehicle_id, ts DESC);
CREATE INDEX fsm_transitions_fsm_ts     ON fsm_transitions (fsm_name, ts DESC);

COMMENT ON TABLE fsm_transitions IS
  'Append-only state-machine transition log. ADR-004 layered live-state '
  'contract: SignalStore (L1) holds the running FSM state in process, '
  'this table holds the durable history of every transition.';

COMMENT ON COLUMN fsm_transitions.vehicle_id IS
  'Vehicles foreign-key value (no DB-level FK to keep the writer hot path lock-free; matches the precedent set by phase-42 prompts 0030-0034).';
COMMENT ON COLUMN fsm_transitions.ts IS
  'Wall-clock timestamp of the transition.';
COMMENT ON COLUMN fsm_transitions.fsm_name IS
  'Name of the finite-state machine that transitioned (drive_state, charge_state, climate_state, ...).';
COMMENT ON COLUMN fsm_transitions.from_state IS
  'Previous state, or NULL for the very first transition observed for this (vehicle, fsm).';
COMMENT ON COLUMN fsm_transitions.to_state IS
  'New state. Always non-null; a transition is defined by its destination.';
COMMENT ON COLUMN fsm_transitions.trigger IS
  'Field name (or other free-form trigger label) that caused the transition. NULL for transitions driven by external events with no single owning field.';
COMMENT ON COLUMN fsm_transitions.details IS
  'Optional structured context for the transition (e.g. before/after values, decision-tree branch). JSONB so callers can attach FSM-specific shapes without schema migrations.';

-- =========================================================================
-- vehicle_live_state — durable mirror of the L2 (Redis) live signal HSET.
-- One row per vehicle, ever. Updated on a periodic snapshot cadence, NOT
-- on every signal value (that path stays on SignalStore + Redis +
-- signal_log). Restart recovery / cold-pod warm-up reads this row to
-- skip the otherwise required signal_log replay.
-- =========================================================================
CREATE TABLE vehicle_live_state (
  vehicle_id BIGINT PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL,
  drive_state TEXT,
  charge_state TEXT,
  last_lat DOUBLE PRECISION,
  last_lng DOUBLE PRECISION,
  last_speed_mps DOUBLE PRECISION,
  soc_pct REAL,
  odometer_m DOUBLE PRECISION,
  battery_level INT,
  inside_temp_c REAL,
  outside_temp_c REAL,
  locked BOOLEAN,
  sentry_mode BOOLEAN,
  full_state JSONB
);

COMMENT ON TABLE vehicle_live_state IS
  'Durable per-vehicle live-state snapshot. ADR-004 layered live-state '
  'contract: this table is the cold-storage mirror of the L2 (Redis) '
  'HSET vehicle:{vehicleID}:signals so that consumers can recover the '
  'current state without replaying signal_log after a Redis flush or a '
  'full restart. NOT a hot-path read; SignalStore (L1) and Redis (L2) '
  'remain the hot live-state paths.';

COMMENT ON COLUMN vehicle_live_state.vehicle_id IS
  'Vehicles foreign-key value and natural primary key. One row per vehicle ever; subsequent snapshots UPSERT in place.';
COMMENT ON COLUMN vehicle_live_state.updated_at IS
  'Wall-clock timestamp of the most recent snapshot write. Cross-pod readers may treat values older than the snapshot cadence (typically a few minutes) as stale.';
COMMENT ON COLUMN vehicle_live_state.drive_state IS
  'Last observed drive FSM state (P / R / N / D, or aggregated states like driving / parked).';
COMMENT ON COLUMN vehicle_live_state.charge_state IS
  'Last observed charge FSM state (Disconnected / Charging / Stopped / Complete / Starting / NoPower / ...).';
COMMENT ON COLUMN vehicle_live_state.last_lat IS
  'Latitude of the most recent position sample, in WGS-84 decimal degrees.';
COMMENT ON COLUMN vehicle_live_state.last_lng IS
  'Longitude of the most recent position sample, in WGS-84 decimal degrees.';
COMMENT ON COLUMN vehicle_live_state.last_speed_mps IS
  'Speed of the most recent position sample, SI (meters per second). Matches the SI-canonical unit used everywhere else in phase-42.';
COMMENT ON COLUMN vehicle_live_state.soc_pct IS
  'State of charge as a percentage (0-100). REAL precision matches the phase-42 hot-path SOC fields.';
COMMENT ON COLUMN vehicle_live_state.odometer_m IS
  'Lifetime odometer reading, SI (meters).';
COMMENT ON COLUMN vehicle_live_state.battery_level IS
  'Battery level reported by the vehicle (typically the Tesla "battery_level" UI field, an integer 0-100).';
COMMENT ON COLUMN vehicle_live_state.inside_temp_c IS
  'Cabin / inside temperature, SI (Celsius).';
COMMENT ON COLUMN vehicle_live_state.outside_temp_c IS
  'Ambient / outside temperature, SI (Celsius).';
COMMENT ON COLUMN vehicle_live_state.locked IS
  'Whether the vehicle is locked at the time of the snapshot.';
COMMENT ON COLUMN vehicle_live_state.sentry_mode IS
  'Whether sentry mode is active at the time of the snapshot.';
COMMENT ON COLUMN vehicle_live_state.full_state IS
  'Periodic full snapshot of the L2 (Redis) HSET payload, for restart recovery. JSONB so the schema does not have to grow when new live-state fields are added; the typed columns above are the indexed / commonly-queried subset.';
