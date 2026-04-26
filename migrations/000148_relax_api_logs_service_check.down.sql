-- Phase-19/09a rollback: Restore strict service enum CHECK constraint.

ALTER TABLE api_call_logs DROP CONSTRAINT IF EXISTS api_call_logs_service_check;
ALTER TABLE api_call_logs ADD CONSTRAINT api_call_logs_service_check
  CHECK (service IN ('tesla-api','fleet-telemetry','geocoding','eia','ntfy','webhook'));
