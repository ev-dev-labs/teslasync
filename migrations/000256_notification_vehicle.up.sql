BEGIN;

ALTER TABLE notification_logs
  ADD COLUMN vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE SET NULL;

CREATE INDEX idx_notification_logs_vehicle_created
  ON notification_logs (vehicle_id, created_at DESC)
  WHERE vehicle_id IS NOT NULL;

COMMENT ON COLUMN notification_logs.vehicle_id IS
  'Vehicle captured by the producer at trigger time, not inferred from mutable rule scope. Legacy rows remain unknown until an explicit offline repair.';

COMMIT;
