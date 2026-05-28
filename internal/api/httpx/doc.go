// Package httpx is the canonical home for the flat-shape JSON response
// helpers used by every handler under internal/api/.
//
// Layer: handler
//
// CARVED in Phase R2.0a (2026-05-28) ahead of the internal/api/ ->
// internal/api/<resource>/ subpackage migration (Phase R2). Living
// here lets sibling resource subpackages share a stable, low-churn
// dependency without re-introducing cycles back through the parent
// internal/api package.
//
// # Wire shape (DO NOT CHANGE — frontend contract)
//
// Successful responses:
//
//	{ "<your-field>": ..., "<your-other-field>": ... }
//
// Error responses:
//
//	{ "error": "<human readable>", "code": "<machine code>" }
//
// This is intentionally NOT the same as
// internal/platform/httputil.Respond, which envelopes payloads inside
// {"data": ...}. The TeslaSync SPA hooks (web/src/api/*) and every
// frontend type definition assume the flat shape; switching to the
// envelope shape would break every consumer in lockstep and is a
// dedicated future phase, not a refactor side-effect.
//
// # Transitional contract during R2 waves
//
// The parent internal/api package retains lowercase wrappers
// (writeJSON, writeError, writeErrorCode, httpStatusCode,
// writeTeslaTokenExpired) that delegate to the exported functions
// here. As each R2 wave moves a handler from internal/api/<file>.go
// into internal/api/<resource>/, that wave rewrites the moved
// handler's calls to use httpx.WriteJSON/WriteError/... directly.
//
// Once internal/api/ is fully drained (Phase D), the parent wrappers
// have zero callers and can be deleted.
//
// # What does NOT live here
//
//   - internal/api.AppError + the Err* catalog stay in the parent
//     internal/api package for R2.0a. They have parent-bound
//     dependencies (the APIErrors Prometheus metric and the
//     ErrorTracker). A dedicated future carve (currently scoped as a
//     follow-on, not part of R2.0) is expected to land them in
//     internal/api/apierr.
//   - internal/api.ErrCodeAuthModeOpen stays in the parent because it
//     has many callers across the api package AND is mirrored by
//     internal/auth.AuthModeOpenCode. It is not tied to a single
//     helper, unlike ErrCodeTeslaTokenExpired which lives here.
package httpx
