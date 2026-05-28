// Package charging holds the Charging aggregate-root repositories
// for charging sessions, telemetry, and AI-planned future-charge slots.
//
// Layer: adapter
//
// Carved files (Phase R4.11 — bounded-context restructure per ADR-011):
//
//   - repo.go      (was internal/database/charging_repo.go)
//     ChargingSession persistence + partial-update support; calls
//     database.BuildPartialUpdate (promoted in helpers.go) for the
//     SET-clause builder.
//   - plan_repo.go (was internal/database/charge_plan_repo.go)
//     AI-generated charge-plan rows owned by /api/v1/ai/charge-planner.
//
// Aggregate root: ChargingSession.
//
// Cross-package wiring: callers import this subpkg as `chargingdb` per
// the ADR-011 alias convention (e.g.
// `chargingdb "github.com/ev-dev-labs/teslasync/internal/database/charging"`).
//
// Helper promotion (Lesson 31 follow-on): partial-update SQL builder
// previously named buildPartialUpdate(...) was promoted to exported
// database.BuildPartialUpdate(...) so this subpkg can reuse it. The
// unexported alias is retained for in-package callers (drive_repo.go,
// helpers_test.go).
package charging
