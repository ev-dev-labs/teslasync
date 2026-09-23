ALTER TABLE api_call_logs
  ADD COLUMN IF NOT EXISTS request_headers jsonb,
  ADD COLUMN IF NOT EXISTS response_headers jsonb;

COMMENT ON COLUMN api_call_logs.request_headers IS 'Bounded, redacted HTTP request header snapshot; NULL for older entries.';
COMMENT ON COLUMN api_call_logs.response_headers IS 'Bounded, redacted HTTP response header snapshot; NULL for older entries or network errors.';
