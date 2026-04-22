-- =========================================================================
-- 000142 down — drops every object the up created.
-- ADR-008: this is NOT a restore of legacy schema. Production rollback
-- restores from PG backup (rollback/99-rollback.prompt.md).
-- Extensions intentionally retained.
-- =========================================================================

-- CAGGs (drop before underlying hypertables)
DROP MATERIALIZED VIEW IF EXISTS cagg_signal_hourly        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_charging_summary     CASCADE;
DROP MATERIALIZED VIEW IF EXISTS cagg_fleet_stats          CASCADE;

-- system tables (CASCADE clears any closed FKs)
DROP TABLE IF EXISTS embeddings              CASCADE;
DROP TABLE IF EXISTS fsm_transitions         CASCADE;
DROP TABLE IF EXISTS command_executions      CASCADE;
DROP TABLE IF EXISTS audit_logs              CASCADE;
DROP TABLE IF EXISTS gas_prices              CASCADE;
DROP TABLE IF EXISTS electricity_cost        CASCADE;
DROP TABLE IF EXISTS geofences               CASCADE;
DROP TABLE IF EXISTS places                  CASCADE;
DROP TABLE IF EXISTS polling_config          CASCADE;
DROP TABLE IF EXISTS settings                CASCADE;

-- tesla integration
DROP TABLE IF EXISTS api_call_logs           CASCADE;
DROP TABLE IF EXISTS tesla_tokens            CASCADE;

-- notifications stack (children -> parents)
DROP TABLE IF EXISTS notification_digests                CASCADE;
DROP TABLE IF EXISTS notification_quiet_hours            CASCADE;
DROP TABLE IF EXISTS notification_cooldowns              CASCADE;
DROP TABLE IF EXISTS notifications                       CASCADE;
DROP TABLE IF EXISTS notification_channel_pushover       CASCADE;
DROP TABLE IF EXISTS notification_channel_ntfy           CASCADE;
DROP TABLE IF EXISTS notification_channel_webhook        CASCADE;
DROP TABLE IF EXISTS notification_channel_email          CASCADE;
DROP TABLE IF EXISTS notification_channel_telegram       CASCADE;
DROP TABLE IF EXISTS notification_channel_slack          CASCADE;
DROP TABLE IF EXISTS notification_channel_discord        CASCADE;
DROP TABLE IF EXISTS notification_channels               CASCADE;
DROP TYPE  IF EXISTS notification_channel_kind           CASCADE;
DROP TABLE IF EXISTS alert_rules                         CASCADE;

-- automations tree (children before parent)
DROP TABLE IF EXISTS automation_step_action_call_automation     CASCADE;
DROP TABLE IF EXISTS automation_step_action_set_setting         CASCADE;
DROP TABLE IF EXISTS automation_step_action_notify              CASCADE;
DROP TABLE IF EXISTS automation_step_trigger_event              CASCADE;
DROP TABLE IF EXISTS automation_step_trigger_schedule           CASCADE;
DROP TABLE IF EXISTS automation_step_trigger_geofence           CASCADE;
DROP TABLE IF EXISTS automation_step_trigger_signal             CASCADE;
DROP TABLE IF EXISTS automation_actions                         CASCADE;
DROP TABLE IF EXISTS automation_step_condition_other_automation CASCADE;
DROP TABLE IF EXISTS automation_step_condition_geofence         CASCADE;
DROP TABLE IF EXISTS automation_step_condition_time_window      CASCADE;
DROP TABLE IF EXISTS automation_step_condition_signal           CASCADE;
DROP TABLE IF EXISTS automation_tags                            CASCADE;
DROP TABLE IF EXISTS automation_steps                           CASCADE;
DROP TABLE IF EXISTS automations                                CASCADE;
DROP TYPE  IF EXISTS automation_step_kind                       CASCADE;

-- drives / sessions / trips
DROP TABLE IF EXISTS trip_drives             CASCADE;
DROP TABLE IF EXISTS trips                   CASCADE;
DROP TABLE IF EXISTS charging_sessions       CASCADE;
DROP TABLE IF EXISTS drives                  CASCADE;

-- hot snapshot hypertables
DROP TABLE IF EXISTS vehicle_meta_snapshots  CASCADE;
DROP TABLE IF EXISTS signal_observations     CASCADE;
DROP TABLE IF EXISTS security_events         CASCADE;
DROP TABLE IF EXISTS motor_snapshots         CASCADE;
DROP TABLE IF EXISTS climate_snapshots       CASCADE;
DROP TABLE IF EXISTS charging_telemetry      CASCADE;
DROP TABLE IF EXISTS positions               CASCADE;
DROP TABLE IF EXISTS vehicle_live_state      CASCADE;

-- catalog + entity
DROP TABLE IF EXISTS signal_catalog          CASCADE;
DROP TABLE IF EXISTS vehicles                CASCADE;

-- shared trigger function
DROP FUNCTION IF EXISTS set_updated_at()     CASCADE;

-- NOTE: extensions (timescaledb, pgcrypto, vector, etc.) intentionally retained.
