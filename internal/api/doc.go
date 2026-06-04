// Package api provides TeslaSync's legacy HTTP handler layer.
// It owns the chi /api/v1 router, cross-cutting middleware, and SSE EventHub
// while the ADR-009 migration drains new endpoints into internal/handler/v1.
//
// Layer: handler
//
// FROZEN per ADR-009 (.github/ARCHITECTURE.md):
//   - No new .go files may be added to this directory.
//   - Existing files may be edited (bug fixes, dependency updates).
//   - New endpoints belong in internal/handler/v1.
//   - Test files (_test.go) for existing sources remain permitted —
//     tests must live in the same Go package as the code under test.
//
// Migration of these 223 files to internal/handler/v1 is tracked separately
// and is explicitly out of scope here.
package api
