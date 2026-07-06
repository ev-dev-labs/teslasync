// TelemetryError is the UI-normalised shape after extractTelemetryErrors
// has unwrapped Tesla's response envelope. Tesla's per-vehicle endpoint
// (GET /api/1/vehicles/{vin}/fleet_telemetry_errors) returns
// {"response": {"errors": [{"vin", "error_code", "error_message",
// "reported_at"}, ...]}}; the partner endpoint returns the same shape.
// Different Tesla firmwares and proxy layers have been observed to omit
// the envelope or rename fields, so the extractor is defensive.
//
// Fields are `readonly`: a TelemetryError is an immutable projection built
// once by extractTelemetryErrors from the (react-query-cached) Tesla payload
// and only ever read by DataTable / Column renderers. Marking them readonly
// documents that contract and statically blocks accidental in-place mutation
// of cached query data.
export interface TelemetryError {
  // Stable composite key for DataTable.keyExtractor — Tesla errors do
  // NOT carry an `id`, so the key combines all observable identifiers
  // plus the row index from the wire to keep collisions impossible
  // when the same error repeats at the same instant.
  readonly rowKey: string
  readonly timestamp: string
  readonly code: string
  readonly message: string
}
