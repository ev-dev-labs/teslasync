-- =========================================================================
-- 07 — security_events (hot hypertable; event-driven, audit-grade)
-- ADR-003: 5-year retention. Kept separate so other low-freq tables
-- aren't forced to inherit it.
-- =========================================================================

CREATE TABLE security_events (
  vehicle_id    bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts            timestamptz      NOT NULL,
  event_type    text             NOT NULL
                                 CHECK (event_type IN (
                                   'door_open','door_closed','window_open','window_closed',
                                   'lock','unlock','sentry_on','sentry_off',
                                   'user_present','user_absent','trunk_open','trunk_closed',
                                   'frunk_open','frunk_closed','sentry_alert','tonneau_change'
                                 )),
  doors_open    text,
  windows_open  text,
  locked        boolean,
  sentry_mode   boolean,
  user_present  boolean,
  detail        text,
  source        text             NOT NULL DEFAULT 'fleet_telemetry'
                                 CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts, event_type)
);

COMMENT ON TABLE  security_events IS
  'Event-driven door/lock/sentry history. 5-year audit retention per ADR-003.';
COMMENT ON COLUMN security_events.doors_open IS
  'Normalized JSON-string from compound TypeDoors signal (repo memory: signal_types normalization).';
COMMENT ON COLUMN security_events.windows_open IS
  'Normalized JSON-string from compound WindowState signal (migration 000132 normalization).';

SELECT create_hypertable('security_events', 'ts', chunk_time_interval => interval '7 days');

ALTER TABLE security_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id, event_type',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('security_events', interval '30 days');
SELECT add_retention_policy ('security_events', interval '1825 days');

CREATE INDEX idx_security_vehicle_ts   ON security_events (vehicle_id, ts DESC);
CREATE INDEX idx_security_event_type   ON security_events (event_type, ts DESC);
