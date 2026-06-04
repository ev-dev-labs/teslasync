-- Phase 2 / Prompt 01 (Contract C, storage) — raw_signal: the append-only
-- provider-native system of record for every decoded reading.
--
-- Repo adaptation note
-- ────────────────────
-- The source prompt targets a Gradle/Flyway repo
-- (packages/contract-storage/sql/V0NN__*.sql, UUID vehicle keys,
-- VendorValueType). This repository is golang-migrate over TimescaleDB,
-- so the shape below is adapted to verified local conventions:
--   * golang-migrate slot 000214 (next free after 000213_events_outbox);
--   * vehicle_id is BIGINT referencing the real vehicles(id) identity
--     column (see 000142_baseline_typed), NOT a UUID;
--   * textual columns are TEXT (house style — see signal_log.field,
--     events_outbox.event_type), not VARCHAR(n);
--   * value_type mirrors protomodel.ValueKind — the discriminator this
--     repo already uses in signal_log.value_kind (000186) — so the raw
--     layer agrees with the cold-path change feed.
-- The semantics, append-only guarantee, and idempotency contract are
-- exactly as the prompt specifies.
--
-- H17 — APPEND-ONLY. raw_signal is the replay substrate and is NEVER
-- mutated: there are no UPDATE/DELETE paths in the writer, and a
-- correction is expressed as a NEW row (a later observed_at for the same
-- vehicle/provider_kind), never an in-place edit. This preserves a
-- faithful, ordered history of exactly what the provider emitted, which
-- the canonical layer (prompt 02) is derived from and can be rebuilt
-- from at any time.
--
-- H13 — NO SI-IMPLYING NUMERIC COLUMN. raw_value is opaque TEXT and the
-- companion value_type SMALLINT discriminates how to interpret it
-- (number / string / bool, mirroring protomodel.ValueKind). The raw
-- layer stores the provider-native value verbatim with provider-native
-- units; it deliberately does NOT carry a typed/numeric column that would
-- imply an SI normalization. Normalization to SI happens downstream when
-- the canonical layer is populated, not here.
--
-- H24 — IDEMPOTENT AT-LEAST-ONCE WRITES. The composite primary key
-- (vehicle_id, observed_at, provider_kind) makes a re-delivery of the same
-- decoded reading a no-op: the writer uses
--   INSERT ... ON CONFLICT (vehicle_id, observed_at, provider_kind) DO NOTHING
-- so a duplicate MQTT redelivery (at-least-once transport) silently
-- collapses to the row already on disk instead of erroring or
-- double-counting.
--
-- H35 / privacy — every row is stamped with privacy_class, sourced from
-- the SignalDescriptor (phase-1-adrs/04 / ADR-0331), so retention,
-- redaction, and export tooling can reason about sensitivity without
-- re-deriving it from provider_kind.
--
-- HYPERTABLE-COMPATIBLE. observed_at participates in the primary key, so
-- a future `SELECT create_hypertable('raw_signal', 'observed_at', ...)`
-- is a pure metadata change (TimescaleDB requires the time column in any
-- unique/primary key). No chunk-hostile defaults are used here. The
-- create_hypertable call is intentionally deferred to a later operational
-- prompt, mirroring how 000186_signal_log and 000182-000185 deferred
-- compression/retention policy decisions.
--
-- ROLLBACK. 000214_create_raw_signals.down.sql drops the two indexes and
-- the table. Because the table is append-only and not yet read by any
-- shipped code path at this slot, the rollback is non-destructive to
-- other tables (no shared objects, FK is owned by raw_signal).

CREATE TABLE raw_signal (
    vehicle_id    BIGINT      NOT NULL,
    observed_at   TIMESTAMPTZ NOT NULL,
    provider_kind TEXT        NOT NULL,   -- provider-native field name (e.g. "BatteryLevel" or "vendor.tesla.*")
    value_type    SMALLINT    NOT NULL,   -- discriminator: number / string / bool (mirrors protomodel.ValueKind)
    raw_value     TEXT        NOT NULL,   -- opaque provider-native value; never an SI-implying numeric column (H13)
    brand         TEXT        NOT NULL,
    privacy_class SMALLINT    NOT NULL,   -- stamped from SignalDescriptor (phase-1-adrs/04 / ADR-0331)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_raw_signal PRIMARY KEY (vehicle_id, observed_at, provider_kind),
    CONSTRAINT fk_raw_signal_vehicle
        FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
);

CREATE INDEX idx_raw_signal_observed_at
    ON raw_signal (observed_at DESC);

CREATE INDEX idx_raw_signal_vehicle_kind_observed_at
    ON raw_signal (vehicle_id, provider_kind, observed_at DESC);

COMMENT ON TABLE raw_signal IS
    'Append-only provider-native system of record for every decoded reading '
    '(canonical-mapped and vendor). H17: never mutated, corrections are new '
    'rows. Replay substrate for the canonical layer. Hypertable-compatible.';

COMMENT ON COLUMN raw_signal.vehicle_id IS
    'FK to vehicles(id). ON DELETE CASCADE: a removed vehicle takes its raw history with it.';
COMMENT ON COLUMN raw_signal.observed_at IS
    'Provider-reported observation time. Intended hypertable time dimension; part of the PK.';
COMMENT ON COLUMN raw_signal.provider_kind IS
    'Provider-native field name, verbatim (e.g. "BatteryLevel" or "vendor.tesla.*"). Never renamed to a canonical signal here.';
COMMENT ON COLUMN raw_signal.value_type IS
    'Value discriminator mirroring protomodel.ValueKind (number / string / bool). Tells readers how to parse raw_value.';
COMMENT ON COLUMN raw_signal.raw_value IS
    'Opaque provider-native value as TEXT with provider-native units (H13). No SI normalization is applied at the raw layer.';
COMMENT ON COLUMN raw_signal.brand IS
    'Provider/brand that emitted the reading (e.g. tesla), so multi-provider data shares one raw substrate.';
COMMENT ON COLUMN raw_signal.privacy_class IS
    'Sensitivity class stamped from the SignalDescriptor (ADR-0331), driving retention/redaction without re-deriving from provider_kind.';
COMMENT ON COLUMN raw_signal.created_at IS
    'Server-side ingest timestamp (DEFAULT now()). Forensic/lag metric only; ordering and identity use observed_at.';
