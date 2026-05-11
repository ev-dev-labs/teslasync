-- Phase-42 / Prompt 0034: Recreate signal_log as the ADR-004 cold-path
-- change feed.
--
-- ADR-004 #2 / #3: live signal state is layered. SignalStore (in-process
-- L1) and RedisSignalCache (cross-pod L2) hold the latest known value of
-- every routed Field; signal_log is the durable TimescaleDB history that
-- backs charts, point-in-time reconstruction, completion logic, and
-- replay. Every routed Atomic with `also_signal_log: true` writes here in
-- addition to its hot table, and every Field whose routing.yaml entry is
-- `dest: signal_log` writes here only.
--
-- ADR-004 #4 / single-entry contract: values land here AFTER
-- normalize.toSI has run on the codec output, so everything stored in
-- this table is SI-canonical (meters, seconds, Watts, Watt-hours,
-- meters-per-second, Pascals, Celsius, ...). The schema does not carry
-- per-row units because every Field's unit is statically determined by
-- protomodel.SignalMeta.UnitKind — knowable at read time without DB
-- support.
--
-- Forward-only rewrite: phase-42 abolishes the legacy cold-path schema
-- (signal_observations + signal_catalog from 000142_baseline_typed, and
-- the signal_log carried over from 000040_signal_history /
-- 000145_signal_history_to_signal_log) and replaces it with a single
-- typed-column hypertable. Existing rows are not migrated; clients
-- backfill from MQTT replay if needed (prompt 0090 runbook).
--
-- Slot variance: prompt 0034 hardcodes slot 000166, but that slot is
-- already occupied by 000166_chatbot_sessions (a pre-phase-42 migration
-- committed before this phase began). Slot 000186 is the next free slot
-- after the trailing edge of existing migrations (000185_drives_si is
-- the immediately prior phase-42 migration, created by prompt 0033).
-- This mirrors the slot-variance the predecessor phase-42 prompts 0022
-- (000160 -> 000181), 0030 (000162 -> 000182), 0031 (000163 -> 000183),
-- 0032 (000164 -> 000184), and 0033 (000165 -> 000185) applied. The
-- schema, semantics, and gate intent are otherwise exactly as the
-- prompt specifies.
--
-- Routing rule (a later phase-42 prompt wires this in routing.yaml):
--   atomic with also_signal_log=true   -> hot table + signal_log
--   atomic with dest=signal_log only   -> signal_log (no hot home)
--
-- Compression and retention policies are intentionally NOT applied here
-- — phase-42 defers per-table policy decisions to a later operational
-- prompt, the same way prompts 0030-0033 deferred them for positions,
-- snapshots, charging_telemetry, and drives.

-- =========================================================================
-- Defensive cleanup of the legacy cold-path schema. Order matters:
-- continuous aggregates must be dropped before the hypertable they read
-- from, and signal_observations FKs onto signal_catalog so the
-- observations table goes first.
-- =========================================================================

-- CAGGs over the legacy signal_log (000147_continuous_aggregates):
DROP MATERIALIZED VIEW IF EXISTS cagg_vehicle_daily   CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_climate_hourly  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_battery_daily   CASCADE;

-- CAGG over the legacy signal_observations (000142_baseline_typed § 26):
DROP MATERIALIZED VIEW IF EXISTS cagg_signal_hourly   CASCADE;

-- Legacy cold-path tables. CASCADE drops residual FKs without dropping
-- unrelated parent tables (e.g. vehicles).
DROP TABLE IF EXISTS signal_log            CASCADE;
DROP TABLE IF EXISTS signal_observations   CASCADE;
DROP TABLE IF EXISTS signal_catalog        CASCADE;

-- =========================================================================
-- signal_log — cold-path change feed (ADR-004).
-- One row per routed value. Composite primary key (vehicle_id, ts, field)
-- gives the cold path exactly-once semantics: a duplicate redelivery of
-- the same (vehicle, timestamp, field) is silently rejected by the PK,
-- and a write that races a duplicate sees a unique-violation error that
-- the writer can ignore as "already recorded".
--
-- One typed column per protomodel.ValueKind. Exactly one of the typed
-- columns is non-null per row, dictated by `value_kind`:
--
--   value_kind  typed column   covers
--   ----------  -------------  -------------------------------------------
--   1 String    str_value      ValueKindString
--   2 Bool      bool_value     ValueKindBool
--   3 Int32     int_value      ValueKindInt32
--   4 Int64     int_value      ValueKindInt64
--   5 Float     float_value    ValueKindFloat
--   6 Double    float_value    ValueKindDouble
--   7 Enum      int_value      ValueKindEnum   (parsed proto enum number)
--   9 Time      time_value     ValueKindTime
--
-- ValueKindCompound (8) is NOT representable here because compound
-- fields (LocationValue, ChargingPolicyState, ...) are flattened into
-- scalar atomics by the codec before they reach normalize.toSI / the
-- router; the cold-path writer never sees a compound value directly.
-- ValueKindUnknown (0) and ValueKindInvalid (10) are not valid values to
-- log — the codec drops invalid samples and the router rejects unknown
-- kinds (tesla_normalize_values_processed_total{outcome="dropped_invalid"}).
-- =========================================================================
CREATE TABLE signal_log (
  vehicle_id  BIGINT      NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  field       TEXT        NOT NULL,
  value_kind  SMALLINT    NOT NULL,
  str_value   TEXT,
  bool_value  BOOLEAN,
  int_value   BIGINT,
  float_value DOUBLE PRECISION,
  time_value  TIMESTAMPTZ,
  PRIMARY KEY (vehicle_id, ts, field)
);

SELECT create_hypertable('signal_log', 'ts', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

CREATE INDEX signal_log_vehicle_field_ts ON signal_log (vehicle_id, field, ts DESC);
CREATE INDEX signal_log_field_ts          ON signal_log (field, ts DESC);

COMMENT ON TABLE signal_log IS
  'Cold-path change feed for Tesla telemetry. ADR-004 layered live state '
  'contract: L1=SignalStore, L2=Redis, durable=signal_log.';

COMMENT ON COLUMN signal_log.vehicle_id IS
  'Vehicles foreign-key value (no DB-level FK at this slot to keep the writer hot path lock-free; matches the precedent set by prompts 0030-0033).';
COMMENT ON COLUMN signal_log.ts IS
  'Wall-clock timestamp of the observation. Hypertable time dimension; chunks are 7 days wide.';
COMMENT ON COLUMN signal_log.field IS
  'Canonical proto Field name (or, for compound fields, the flatten-derived child name produced by the codec). Matches protomodel.SignalMeta.Field.';
COMMENT ON COLUMN signal_log.value_kind IS
  'protomodel.ValueKind of the row. Dictates which typed column is non-null. SMALLINT covers the entire ValueKind range without padding.';
COMMENT ON COLUMN signal_log.str_value IS
  'Populated for ValueKindString. Mutually exclusive with the other typed columns.';
COMMENT ON COLUMN signal_log.bool_value IS
  'Populated for ValueKindBool. Mutually exclusive with the other typed columns.';
COMMENT ON COLUMN signal_log.int_value IS
  'Populated for ValueKindInt32, ValueKindInt64, and ValueKindEnum (the parsed proto enum number). BIGINT widens int32 without loss and stores int64 exactly.';
COMMENT ON COLUMN signal_log.float_value IS
  'Populated for ValueKindFloat and ValueKindDouble. Stored in canonical SI units after normalize.toSI.';
COMMENT ON COLUMN signal_log.time_value IS
  'Populated for ValueKindTime (proto google.protobuf.Timestamp values).';
