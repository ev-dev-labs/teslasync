// Package api provides TeslaSync's legacy HTTP handler layer.
// It owns the chi /api/v1 router, cross-cutting middleware, and SSE EventHub
// while the ADR-009 migration drains new endpoints into internal/handler/v1.
//
// Layer: handler
//
// FROZEN per ADR-009 (.github/ARCHITECTURE.md, phase-47/06):
//   - No new .go files may be added to this directory.
//   - Existing files may be edited (bug fixes, dependency updates).
//   - New endpoints belong in internal/handler/v1.
//   - Test files (_test.go) for existing sources remain permitted —
//     tests must live in the same Go package as the code under test.
//
// Migration of these 223 files to internal/handler/v1 is tracked under
// phase-48+ and is explicitly out of scope of phase-47.
package api
