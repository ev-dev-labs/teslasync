ALTER TABLE api_call_logs ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'tesla_api';
CREATE INDEX idx_api_call_logs_source ON api_call_logs (source);
