// Package tripplan hosts the AI trip-planner LLM-agent tool cluster
// carved from internal/ai/tools/ in Phase R6.31.
//
// Layer: domain (per ADR-007 — AI tools sit at the domain layer because
// they expose pure capability surfaces to the AI orchestrator without
// reaching into HTTP/transport concerns).
//
// # Contents
//
//   - RegisterTripPlannerLLMAgentTools — wires query_chargers_along_route
//   - query_user_charge_dwells + draft_trip_plan into the shared
//     tools.Registry.
//   - TripPlannerLLMAgentSources — dependency bag (Chargers ChargeSource +
//     Planner TripPlanComputer).
//   - TripPlanComputer / TripPlanComputeRequest / TripPlanComputeResult /
//     TripPlanRoute / TripPlanLeg / TripPlanLocation / TripPlanChargeStop /
//     TripPlanSOCPoint — typed port + value-object set the
//     draft_trip_plan tool delegates to.
//
// # ADR-011 §3 alias convention
//
// The subpackage name `tripplan` is DISTINCT from R6.14 `trip/` (which
// hosts trip auto-name + drive-search + share-card tools). The two
// clusters are siblings; `tripplan` covers route/charger planning while
// `trip` covers trip enrichment.
//
// Callsites importing this subpkg alongside the parent tools package use
// the alias `tripplantool`:
//
//	import (
//	    "github.com/ev-dev-labs/teslasync/internal/ai/tools"
//	    tripplantool "github.com/ev-dev-labs/teslasync/internal/ai/tools/tripplan"
//	)
//
// Updated callsites: internal/api/router.go (registration) +
// internal/api/ai_trip_planner_llm_handler.go (15+ TripPlan* type
// references including the compile-time AITripPlanComputer interface
// satisfaction var) + internal/api/ai_trip_planner_llm_handler_test.go
// (interface-cast test).
//
// # ADR-015 §I12 contract
//
// The aivet contract is preserved verbatim across the carve:
// `aivet: OK — 59 AI route(s), 57 feature(s) in registry, 54 SPA wiring
// entries, TS mirror in sync` — verified after every R6 cluster.
//
// # Phase R6 lessons exercised
//
//   - Lesson 9 (`go build` after regex pass surfaces tool-specific
//     shared symbols): tools.ChargeSource was the only such symbol;
//     manually prefixed.
//   - Lesson 12 NO-NEW-PROMOTIONS: tools.Lower (R6.26) was the sole
//     shared helper called from tripplan.go; prefixed at every call
//     site. No new parent shared files created.
//   - Lesson 13 (local test fakes referenced by other parent tests
//     migrated to toolstest.* helpers): the local ptrTime / ptrStr /
//     ptrFloat64 helpers (the latter two duplicated into this file by
//     R6.28 to compensate for the route_efficiency carve) are now
//     migrated to toolstest.PtrTime / PtrString / PtrFloat64. No more
//     local ptr helpers in the parent tools package's test files.
//   - Lesson 15 (dotted-access field rename): local fakes
//     failingCharges (field `err`) and fakeTripPlanComputer (fields
//     `last`, `out`, `err`) had their fields promoted to PascalCase to
//     match access-site renames. `last` was added to the field-rename
//     allowlist mid-carve and required a follow-up regex pass.
//   - Lesson 16 (NEW): regex pass over identifier names ALSO touches
//     identical substrings inside string literals. The `\bChargeSource\b`
//     pass prefixed two errors.New(...) literals with "tools." which
//     then failed a test asserting "no ChargeSource" substring. Fixed
//     by reverting only the error-string occurrences (godoc links and
//     code types stay prefixed). Recipe addendum: AFTER each tool-
//     specific symbol prefix pass, grep `tools\.<Sym>` inside
//     `errors\.New|fmt\.Errorf|fmt\.Sprintf|strings\.Contains` literals
//     and revert if found.
package tripplan
