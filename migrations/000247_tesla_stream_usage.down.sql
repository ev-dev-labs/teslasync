SELECT add_retention_policy('api_call_logs', INTERVAL '365 days', if_not_exists => TRUE);
DROP INDEX IF EXISTS tesla_stream_usage_received_at_idx;
DROP TABLE IF EXISTS tesla_stream_usage;
