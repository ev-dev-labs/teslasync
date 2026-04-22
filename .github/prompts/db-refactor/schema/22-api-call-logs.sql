-- =========================================================================
-- 22 — api_call_logs (append-only hypertable, audit/observability)
-- ADR-005: no raw_json. Bodies excluded by default; only URL/status/duration.
-- =========================================================================

CREATE TABLE api_call_logs (
  id              bigint           GENERATED ALWAYS AS IDENTITY,
  ts              timestamptz      NOT NULL DEFAULT now(),
  vehicle_id      bigint           REFERENCES vehicles(id) ON DELETE SET NULL,
  service         text             NOT NULL DEFAULT 'tesla-fleet'
                                   CHECK (service IN ('tesla-fleet','geocoding','eia','ntfy','webhook')),
  http_method     text             NOT NULL CHECK (http_method IN ('GET','POST','PUT','PATCH','DELETE')),
  endpoint        text             NOT NULL,
  status_code     smallint         NOT NULL,
  duration_ms     integer          NOT NULL CHECK (duration_ms >= 0),
  error_message   text,
  rate_limited    boolean          NOT NULL DEFAULT false,
  PRIMARY KEY (ts, id)
);

COMMENT ON TABLE  api_call_logs IS
  'Append-only outbound API call log. ADR-005: no raw_json bodies; URL+status+duration only.';
COMMENT ON COLUMN api_call_logs.endpoint IS
  'URL path only (no query string). Strip identifiers from path before insert if PII risk.';

SELECT create_hypertable('api_call_logs', 'ts', chunk_time_interval => interval '7 days');

ALTER TABLE api_call_logs SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'service',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('api_call_logs', interval '30 days');
SELECT add_retention_policy ('api_call_logs', interval '365 days');

CREATE INDEX idx_api_logs_service_ts ON api_call_logs (service, ts DESC);
CREATE INDEX idx_api_logs_failures   ON api_call_logs (ts DESC) WHERE status_code >= 400;
CREATE INDEX idx_api_logs_rate_limited ON api_call_logs (ts DESC) WHERE rate_limited = true;
