// Package ailogtrace hosts the log and trace summarization AI handler.
//
// # Layer
//
// Layer: handler
//
// # Why a subpackage
//
// Carved in Phase R2d.147 from the flat internal/api parent to isolate the
// log-trace-summarization HTTP surface. The package depends only on AI
// orchestration primitives and shared API infrastructure; it MUST NOT import its
// parent api package.
//
// # Scope
//
// In-scope (lives here):
//   - Handler for POST /api/v1/ai/system/logs/summarize.
//   - NewHandler constructor used by router wiring.
//   - TraceWindowSource adapter used by summary.RegisterLogTraceSummarizerTools.
//
// Out-of-scope (remains in parent api): AIHandlers aggregation and route
// registration in ai_routes.go.
package ailogtrace
