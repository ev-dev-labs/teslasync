// Package apitest provides shared HTTP test helpers used across the
// internal/api package and its R2a-R2e wave subpackages.
//
// Layer: handler
//
// (Test helpers for the handler layer — the arch test enforces a closed
// set of layer names {domain, port, adapter, app, handler, platform,
// cmd-internal, tool}; "handler-test" is not in the set, and the cleanest
// classification for a pure-test helper package whose only purpose is to
// support handler tests is "handler".)
//
// # Why this subpackage exists
//
// Before Phase R2.0b (2026-05-28) these helpers lived as unexported
// lowercase functions in internal/api/api_test.go (assertStatus /
// assertJSON / assertContentType / doRequest). With ~16 + 8 + 5 + 11
// call sites already spread across api_test.go + acceptance_test.go,
// and with the R2a-R2e waves about to extract ~20 handler subpackages
// that will each want the same assertion + request scaffolding, we
// promoted them to a shared subpackage with exported names BEFORE the
// waves begin. That way each wave subpkg imports
//
//	"github.com/ev-dev-labs/teslasync/internal/api/apitest"
//
// and calls apitest.AssertStatus(...), apitest.DoRequest(...) etc.
// instead of redefining the same six lines per file.
//
// # What belongs here
//
// Only helpers that are GENUINELY cross-cutting:
//   - HTTP-response assertions that any handler test wants
//     (status / content-type / JSON body)
//   - Generic request scaffolding that doesn't bake in a handler's
//     URL shape or chi route-param wiring
//
// # What does NOT belong here
//
// Per-handler scaffolding stays WITH the handler when it migrates in
// R2a-R2e:
//   - newAlertRuleRequest / newBatteryReportRequest /
//     newDriveDetailRequest / etc. (handler-URL-shaped)
//   - newFakeAlertRuleRepo / newFakeDashboardLayoutRepo / etc. (per-handler
//     in-memory fakes)
//   - newAlertHandlerForTest / newDashboardLayoutHandlerForTest / etc.
//     (per-handler constructors that wire fake repos)
//
// These travel with their handler and become package-private inside
// the wave subpkg.
//
// # Wire-shape contract
//
// AssertJSON only handles JSON bodies that decode into
// map[string]interface{} (the flat wire shape that internal/api/httpx
// produces). Tests that need to decode into a typed struct (or assert
// on arrays/scalars) should decode locally — adding a generic typed
// decoder here would just push tests toward stringly-typed assertions
// on map["field"] when they could be t.Fatalf on the typed struct.
//
// # Stability
//
// Exported surface area is intentionally tiny (4 functions). Resist
// the urge to grow this — every helper here is a coupling point that
// every R2a-R2e wave subpkg test inherits. If you need a one-off
// assertion in 1-2 places, just inline it.
package apitest

// Layer: handler
