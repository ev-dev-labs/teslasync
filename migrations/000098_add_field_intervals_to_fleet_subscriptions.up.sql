ALTER TABLE fleet_telemetry_subscriptions
    ADD COLUMN IF NOT EXISTS field_intervals JSONB;

COMMENT ON COLUMN fleet_telemetry_subscriptions.field_intervals IS 'Per-signal interval overrides as JSON object {signal_name: interval_seconds}';
