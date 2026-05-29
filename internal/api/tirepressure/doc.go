// Package tirepressure serves GET /api/v1/tire-pressure and
// GET /api/v1/tire-pressure/latest using the canonical signal state
// readers introduced by ADR-002.
//
// The AI tire-pressure trend narration handler intentionally remains in
// the parent api package; this package owns only the TPMS HTTP resource
// endpoints and their direct tests.
//
// Layer: handler
package tirepressure
