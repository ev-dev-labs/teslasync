CREATE TABLE IF NOT EXISTS api_call_logs (
    id BIGSERIAL PRIMARY KEY,
    method VARCHAR(10) NOT NULL,
    url TEXT NOT NULL,
    status_code INTEGER,
    request_body TEXT,
    response_body TEXT,
    duration_ms INTEGER NOT NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_call_logs_created_at ON api_call_logs (created_at DESC);
CREATE INDEX idx_api_call_logs_method ON api_call_logs (method);
CREATE INDEX idx_api_call_logs_status_code ON api_call_logs (status_code);
