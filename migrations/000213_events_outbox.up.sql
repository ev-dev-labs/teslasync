-- Phase-52 / cdc-outbox — transactional outbox for domain events.
--
-- Why this table exists
-- ─────────────────────
-- The existing events.Bus.Publish (internal/events/events.go) writes
-- directly to MQTT and silently drops events when the broker is down
-- ("event: MQTT unavailable, event logged only"). That is fine for the
-- in-process notification worker which subscribes from the same broker,
-- but every EXTERNAL integration (Zapier, n8n, Splunk, Home Assistant,
-- bespoke automations) loses every event published while the broker is
-- partitioned, restarting, or backpressured.
--
-- The classic transactional outbox pattern fixes this without giving up
-- the at-most-once-delivery guarantee Mosquitto provides: domain
-- writers INSERT into this table inside the SAME transaction that
-- mutates their domain row, and a background dispatcher claims pending
-- rows and re-publishes them with exponential backoff. Once the
-- dispatcher confirms the publish (synchronous WaitTimeout) the row is
-- marked 'published' and aged out on a 14-day retention.
--
-- Why we do not reuse signal_log or alerts.outbox
-- ────────────────────────────────────────────────
-- signal_log is per-field telemetry on a TimescaleDB hypertable; rows
-- there are ingest events from the vehicle, not domain events we
-- emitted. Reusing it would conflate two very different semantic
-- streams and break the existing CAGGs that summarise signal_log.
-- alerts.outbox does not exist; alerts use a fan-out worker that reads
-- from notifications_logs directly.
--
-- Schema notes
-- ────────────
--   * status is a closed enum: 'pending' | 'in_flight' | 'published'
--     | 'failed' | 'discarded'. 'in_flight' is the claim lease; the
--     dispatcher MUST update to 'published' or back to 'pending'
--     within lease_until or another dispatcher will steal the row.
--   * payload is jsonb so a future schema bump can add fields without
--     a migration; the dispatcher emits the bytes as-is to MQTT.
--   * partial index on (status='pending', next_attempt_at) is the only
--     hot path query so the index stays small even with 14d of
--     'published' rows behind it.

CREATE TABLE IF NOT EXISTS events_outbox (
    id                BIGSERIAL PRIMARY KEY,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type        TEXT        NOT NULL,             -- mirrors events.go const (drive.ended, charge.completed, ...)
    vehicle_id        BIGINT,                            -- optional; system events have no vehicle
    vin               TEXT,                              -- optional; denormalised for downstream filtering
    payload           JSONB       NOT NULL,             -- the full events.Event JSON encoded body
    headers           JSONB,                             -- optional MQTT user properties (trace_id, source, etc.)
    status            TEXT        NOT NULL DEFAULT 'pending',
    attempts          INT         NOT NULL DEFAULT 0,
    next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_until       TIMESTAMPTZ,                       -- only set while status='in_flight'
    lease_holder      TEXT,                              -- pod hostname / dispatcher id for forensics
    published_at      TIMESTAMPTZ,
    last_error        TEXT,
    trace_id          TEXT,                              -- propagated from the producing span
    CONSTRAINT events_outbox_status_check
        CHECK (status IN ('pending', 'in_flight', 'published', 'failed', 'discarded'))
);

-- Hot path: dispatcher polls "what's due now?"
CREATE INDEX IF NOT EXISTS events_outbox_pending_due_idx
    ON events_outbox (next_attempt_at, id)
    WHERE status = 'pending';

-- Stale lease recovery: dispatcher scans for in_flight rows whose lease expired
CREATE INDEX IF NOT EXISTS events_outbox_stale_lease_idx
    ON events_outbox (lease_until)
    WHERE status = 'in_flight';

-- Operator queries: "show me the last 100 failed events"
CREATE INDEX IF NOT EXISTS events_outbox_status_created_idx
    ON events_outbox (status, created_at DESC);

-- Vehicle-scoped filtering for the admin UI
CREATE INDEX IF NOT EXISTS events_outbox_vehicle_created_idx
    ON events_outbox (vehicle_id, created_at DESC)
    WHERE vehicle_id IS NOT NULL;
