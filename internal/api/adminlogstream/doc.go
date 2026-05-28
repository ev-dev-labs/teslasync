// Package adminlogstream serves GET /api/v1/admin/logs/stream as the
// live admin log-tail SSE endpoint consumed by the admin UI.
//
// The handler owns request validation, SSE framing, client backpressure
// reporting, and the operator-facing grep/level filters. The zerolog
// tap itself remains wired in internal/api/router.go so process-global
// logger mutation stays in the composition root.
//
// Layer: handler
package adminlogstream
