ALTER TABLE api_call_logs
  DROP COLUMN IF EXISTS request_headers,
  DROP COLUMN IF EXISTS response_headers;
