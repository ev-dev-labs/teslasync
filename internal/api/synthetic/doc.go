// Package synthetic serves the synthetic-monitoring board read endpoint at
// GET /api/v1/admin/observability/synthetic (ADR-009 exception).
//
// The handler returns a snapshot of every registered probe — name,
// last_run_at, duration, status, current success/failure streak, and
// lifetime totals — by delegating to the *synthetic.Runner instance from
// the synthetic package. When no runner is wired (e.g. SYNTHETIC_ENABLED
// is false in this deployment) the handler returns 503
// SUBSYSTEM_NOT_CONFIGURED so the SPA can render a "synthetic monitoring
// not running on this deployment" message instead of an empty board.
//
// The handler is intentionally tiny — it owns no state of its own and
// performs no business logic; the synthetic.Runner package is the source
// of truth for probe results.
//
// Layer: handler
package synthetic
