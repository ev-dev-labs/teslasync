// Package signalscatalog serves the /signals/catalog + /signals/observations
// global endpoints — the routing.yaml-derived catalog spine joined with
// per-field aggregates from signal_log (mig 000186).
//
// Carved out of internal/api by phase-R2d.5. The package owns one handler:
//
//   - Handler: GET /signals/catalog returns the canonical routing.yaml
//     catalog enriched with last-seen-at / observation-count aggregates.
//     GET /signals/observations returns a paginated time-window of recent
//     signal_log rows for a specific field.
//
// Distinct from internal/api/signalinspect (R2d.4) which serves the
// per-vehicle live-inspector endpoints — catalog + observations are
// global (no vehicle scope).
//
// # Layer
//
// Layer: handler
package signalscatalog
