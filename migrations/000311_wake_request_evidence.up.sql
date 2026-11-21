ALTER TABLE command_logs ADD COLUMN wake_requested_at timestamptz;

CREATE INDEX idx_command_logs_wake_request_evidence
    ON command_logs (vehicle_id, wake_requested_at)
    WHERE wake_requested_at IS NOT NULL AND command IN ('wake','wake_up') AND status='success';
