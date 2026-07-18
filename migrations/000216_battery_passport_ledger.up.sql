-- Migration 216: Battery Passport provenance ledger.
--
-- Why this table exists
-- ─────────────────────
-- The Battery Passport endpoint (internal/api/batterypassport) issues a
-- certificate-style State-of-Health provenance artifact whose core immutable
-- facts are bound by a SHA-256 provenance hash. Each time the passport is
-- read the handler appends an "issued snapshot" here: the point-in-time
-- SoH, the equivalent-full-cycle count, the provenance hash, and the full
-- passport payload. That gives an append-only audit trail a prospective
-- buyer (or a regulator, per the EU Battery Passport regime) can inspect to
-- confirm the certificate was not fabricated after the fact.
--
-- Best-effort write, never a read blocker
-- ───────────────────────────────────────
-- The GET passport handler treats the INSERT as best-effort: a ledger-write
-- failure is logged + counted (battery_passport_ledger_write_failures_total)
-- but NEVER fails the read — the passport is still returned. So this table is
-- an audit convenience, not on the critical path.
--
-- Why not reuse an existing table
-- ────────────────────────────────
-- signal_log is per-field vehicle telemetry on a TimescaleDB hypertable;
-- events_outbox (000213) is a transactional outbox for domain events. Neither
-- carries a self-contained, hash-anchored certificate payload, and overloading
-- either would conflate very different semantic streams. This is a small,
-- purpose-built regular table (row count bounded by passport read frequency).
--
-- Schema notes
-- ────────────
--   * payload is jsonb so the certificate shape can evolve without a
--     migration; readers project the fields they need.
--   * provenance_hash is the lowercase hex SHA-256 that binds the snapshot;
--     it is NOT unique (the same facts on the same day reproduce the same
--     hash, and a genuine re-issue should append a fresh audit row).
--   * the (vehicle_id, issued_at DESC) index serves the only hot query:
--     "the most recent snapshots for this vehicle".

CREATE TABLE IF NOT EXISTS tesla_battery_passport_ledger (
    id                       BIGSERIAL    PRIMARY KEY,
    vehicle_id               BIGINT       NOT NULL,
    issued_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    soh_pct                  DOUBLE PRECISION,
    equivalent_full_cycles   DOUBLE PRECISION,
    provenance_hash          TEXT         NOT NULL,
    payload                  JSONB        NOT NULL,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Hot path: "most recent issued snapshots for a vehicle".
CREATE INDEX IF NOT EXISTS tesla_battery_passport_ledger_vehicle_issued_idx
    ON tesla_battery_passport_ledger (vehicle_id, issued_at DESC);

COMMENT ON TABLE tesla_battery_passport_ledger IS
    'Append-only issued-snapshot ledger for the Battery Passport provenance certificate. Written best-effort by the GET passport handler; a write failure never fails the read.';
COMMENT ON COLUMN tesla_battery_passport_ledger.provenance_hash IS
    'Lowercase hex SHA-256 over the canonical core facts (see batterypassport.CanonicalString). Not unique — same facts on the same day reproduce the same digest.';
COMMENT ON COLUMN tesla_battery_passport_ledger.payload IS
    'Full Battery Passport certificate JSON as issued (snake_case), preserved for audit.';
