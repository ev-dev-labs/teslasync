-- Phase-19/09a: Relax service CHECK to accept any non-empty string.
-- Old constraint only allowed ('tesla-fleet','geocoding','eia','ntfy','webhook')
-- but Go code writes 'tesla-api' and 'fleet-telemetry', causing silent INSERT failures.

ALTER TABLE api_call_logs DROP CONSTRAINT IF EXISTS api_call_logs_service_check;
ALTER TABLE api_call_logs ADD CONSTRAINT api_call_logs_service_check CHECK (service <> '');
