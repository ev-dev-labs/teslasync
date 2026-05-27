DROP INDEX IF EXISTS events_outbox_vehicle_created_idx;
DROP INDEX IF EXISTS events_outbox_status_created_idx;
DROP INDEX IF EXISTS events_outbox_stale_lease_idx;
DROP INDEX IF EXISTS events_outbox_pending_due_idx;
DROP TABLE IF EXISTS events_outbox;
