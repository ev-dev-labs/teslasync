-- Add optional request/response body columns to api_call_logs.
-- Bodies are TEXT, nullable. Truncated to 10KB on INSERT (Go side).
ALTER TABLE api_call_logs ADD COLUMN IF NOT EXISTS request_body  text;
ALTER TABLE api_call_logs ADD COLUMN IF NOT EXISTS response_body text;

COMMENT ON COLUMN api_call_logs.request_body IS
  'Outbound request payload (truncated to 10KB). NULL if no body or GET request.';
COMMENT ON COLUMN api_call_logs.response_body IS
  'Inbound response payload (truncated to 10KB). NULL if empty or timeout.';
