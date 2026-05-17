// TelemetryError is the UI-normalised shape after extractTelemetryErrors
// has unwrapped Tesla's response envelope. Tesla's per-vehicle endpoint
// (GET /api/1/vehicles/{vin}/fleet_telemetry_errors) returns
// {"response": {"errors": [{"vin", "error_code", "error_message",
// "reported_at"}, ...]}}; the partner endpoint returns the same shape.
// Different Tesla firmwares and proxy layers have been observed to omit
// the envelope or rename fields, so the extractor is defensive.
export interface TelemetryError {
  // Stable composite key for DataTable.keyExtractor — Tesla errors do
  // NOT carry an `id`, so the key combines all observable identifiers
  // plus the row index from the wire to keep collisions impossible
  // when the same error repeats at the same instant.
  rowKey: string
  timestamp: string
  code: string
  message: string
}
