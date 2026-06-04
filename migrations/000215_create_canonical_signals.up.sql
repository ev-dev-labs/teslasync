-- Phase 2 / Prompt 02 (Contract C, storage) — canonical_signal: the SI-united,
-- taxonomy-aligned query layer that dashboards, alerts, and automations read.
--
-- Repo adaptation note
-- ────────────────────
-- The source prompt targets a Gradle/Flyway repo
-- (packages/contract-storage/sql/V0NN__*.sql, UUID vehicle keys,
-- VARCHAR(n) columns). This repository is golang-migrate over TimescaleDB,
-- so the shape below is adapted to verified local conventions, mirroring the
-- adaptation already made for the raw layer in 000214_create_raw_signals:
--   * golang-migrate slot 000215 (next free after 000214_create_raw_signals);
--   * vehicle_id is BIGINT referencing the real vehicles(id) identity column
--     (see 000142_baseline_typed), NOT a UUID;
--   * textual columns are TEXT (house style — see signal_log.field,
--     events_outbox.event_type, raw_signal.provider_kind), not VARCHAR(n);
--   * value_type mirrors protomodel.ValueKind — the same discriminator used by
--     raw_signal.value_type (000214) and signal_log.value_kind (000186) — so
--     the canonical layer agrees with both the raw substrate and the cold-path
--     change feed.
-- The semantics — SI-united typed values, taxonomy-permanent canonical_kind,
-- and the query-surface index shape — are exactly as the prompt specifies.
--
-- H13 — num_value IS SI-CANONICAL. The numeric value column carries the value
-- already normalized to SI; the unit is IMPLIED by the canonical_kind suffix
-- (e.g. ".._mps" = metres per second, ".._pct" = percent, ".._wh" = watt-hours)
-- and is NEVER re-converted downstream. Whereas raw_signal.raw_value (000214)
-- is opaque provider-native TEXT with provider-native units, canonical_signal
-- is the layer where SI normalization has already happened. Readers
-- (dashboards/alerts/automations) consume num_value verbatim and apply only a
-- display-unit preference at the render boundary — they do NOT normalize.
--
-- H14 — canonical_kind VALUES ARE PERMANENT TAXONOMY NAMES. A canonical_kind
-- such as 'vehicle.battery.state_of_charge_pct' is a stable, append-only
-- taxonomy identifier: once minted it is never renamed or repurposed, so
-- historical rows remain queryable under the same name forever and a single
-- key works across providers/brands. Provider-native renames live in
-- raw_signal.provider_kind, not here.
--
-- INDEX RATIONALE (doc-15 §3 query shapes):
--   * idx_canonical_signal_vehicle_kind_observed_at (vehicle_id, canonical_kind,
--     observed_at DESC) serves Q1 — the single-vehicle time-series chart:
--     "give me kind K for vehicle V over a window, newest first". The leading
--     (vehicle_id, canonical_kind) prefix narrows to one series and the DESC
--     time ordering makes range scans and LIMIT-tail reads index-only.
--   * idx_canonical_signal_kind_observed_at (canonical_kind, observed_at DESC)
--     serves Q3 — the last-15-min alert hot path: "for kind K across ALL
--     vehicles, what are the most recent values?". Leading with canonical_kind
--     (vehicle_id absent) lets the alert evaluator sweep one kind fleet-wide
--     without per-vehicle fan-out, and the DESC time ordering keeps the
--     recent-window slice at the front of the index.
--
-- H35 / privacy — every row is stamped with privacy_class, sourced from the
-- SignalDescriptor (phase-1-adrs/04 / ADR-0331), so retention, redaction, and
-- export tooling reason about sensitivity directly off the canonical row
-- without re-deriving it from canonical_kind.
--
-- H24 — IDEMPOTENT AT-LEAST-ONCE WRITES. The composite primary key
-- (vehicle_id, observed_at, canonical_kind) makes a re-delivery of the same
-- derived reading a no-op for the canonical writer (Phase 5), which upserts
-- via ON CONFLICT (vehicle_id, observed_at, canonical_kind) — so a duplicate
-- redelivery from the at-least-once raw substrate collapses onto the row
-- already on disk instead of double-writing.
--
-- HYPERTABLE-COMPATIBLE. observed_at participates in the primary key, so a
-- future SELECT create_hypertable('canonical_signal', 'observed_at', ...) is a
-- pure metadata change (TimescaleDB requires the time column in any
-- unique/primary key). The create_hypertable call is intentionally deferred to
-- a later operational prompt, mirroring 000214_create_raw_signals and
-- 000182-000186.
--
-- STORAGE-SHAPE CONSEQUENCE. With this layer in place the per-signal typed
-- tables (vehicle_battery_sample, vehicle_speed_sample, …) become DERIVED
-- PROJECTIONS of canonical_signal. This migration deliberately does NOT drop
-- them; the double-write vs back-fill decision belongs to Phase 5 (the
-- canonical writer).
--
-- ROLLBACK. 000215_create_canonical_signals.down.sql drops the two indexes and
-- the table. canonical_signal owns its FK and both indexes and is a fresh,
-- not-yet-read object at this slot, so the rollback is non-destructive to other
-- tables (no shared objects).

CREATE TABLE canonical_signal (
    vehicle_id     BIGINT           NOT NULL,
    observed_at    TIMESTAMPTZ      NOT NULL,
    canonical_kind TEXT             NOT NULL,   -- permanent canonical taxonomy name, e.g. vehicle.battery.state_of_charge_pct (H14)
    value_type     SMALLINT         NOT NULL,   -- discriminator: number / string / bool (mirrors protomodel.ValueKind)
    num_value      DOUBLE PRECISION,            -- SI-canonical numeric (H13); unit implied by canonical_kind suffix; NULL unless value_type=number
    str_value      TEXT,                        -- NULL unless value_type=string
    bool_value     BOOLEAN,                     -- NULL unless value_type=bool
    brand          TEXT             NOT NULL,
    privacy_class  SMALLINT         NOT NULL,   -- stamped from SignalDescriptor (phase-1-adrs/04 / ADR-0331)
    created_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),
    CONSTRAINT pk_canonical_signal PRIMARY KEY (vehicle_id, observed_at, canonical_kind),
    CONSTRAINT fk_canonical_signal_vehicle
        FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE,
    CONSTRAINT chk_canonical_signal_value_present
        CHECK (num_value IS NOT NULL OR str_value IS NOT NULL OR bool_value IS NOT NULL)
);

CREATE INDEX idx_canonical_signal_kind_observed_at
    ON canonical_signal (canonical_kind, observed_at DESC);

CREATE INDEX idx_canonical_signal_vehicle_kind_observed_at
    ON canonical_signal (vehicle_id, canonical_kind, observed_at DESC);

COMMENT ON TABLE canonical_signal IS
    'SI-united, taxonomy-aligned query layer read by dashboards/alerts/automations. '
    'H13: num_value is SI-canonical, unit implied by canonical_kind suffix, never '
    're-converted downstream. H14: canonical_kind values are permanent taxonomy names. '
    'Derived from raw_signal; the per-signal typed sample tables are projections of this. '
    'Hypertable-compatible.';

COMMENT ON COLUMN canonical_signal.vehicle_id IS
    'FK to vehicles(id). ON DELETE CASCADE: a removed vehicle takes its canonical history with it.';
COMMENT ON COLUMN canonical_signal.observed_at IS
    'Provider-reported observation time. Intended hypertable time dimension; part of the PK.';
COMMENT ON COLUMN canonical_signal.canonical_kind IS
    'Permanent canonical taxonomy name (e.g. vehicle.battery.state_of_charge_pct). Never renamed (H14); the SI unit is implied by its suffix.';
COMMENT ON COLUMN canonical_signal.value_type IS
    'Value discriminator mirroring protomodel.ValueKind (number / string / bool). Selects which typed value column is populated.';
COMMENT ON COLUMN canonical_signal.num_value IS
    'SI-canonical numeric value (H13). Unit implied by canonical_kind suffix; consumed verbatim, never normalized downstream. NULL unless value_type=number.';
COMMENT ON COLUMN canonical_signal.str_value IS
    'String value. NULL unless value_type=string.';
COMMENT ON COLUMN canonical_signal.bool_value IS
    'Boolean value. NULL unless value_type=bool.';
COMMENT ON COLUMN canonical_signal.brand IS
    'Provider/brand that produced the underlying reading (e.g. tesla), so multi-provider data shares one canonical query surface.';
COMMENT ON COLUMN canonical_signal.privacy_class IS
    'Sensitivity class stamped from the SignalDescriptor (ADR-0331), driving retention/redaction without re-deriving from canonical_kind.';
COMMENT ON COLUMN canonical_signal.created_at IS
    'Server-side write timestamp (DEFAULT now()). Forensic/lag metric only; ordering and identity use observed_at.';
