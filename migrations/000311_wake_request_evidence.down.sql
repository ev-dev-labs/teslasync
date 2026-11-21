DROP INDEX idx_command_logs_wake_request_evidence;

ALTER TABLE command_logs DROP COLUMN wake_requested_at;
