// Package route hosts the route-efficiency AI tool cluster carved from
// internal/ai/tools/ in Phase R6.28.
//
// Layer: domain (per ADR-007 — AI tools sit at the domain layer because
// they expose pure capability surfaces to the AI orchestrator without
// reaching into HTTP/transport concerns).
//
// # Contents
//
//   - RegisterRouteEfficiencySuggestionsTools — wires the route_chunks
//     retriever + the route-efficiency aggregator into the shared
//     tools.Registry.
//   - RouteEfficiencySuggestionsSources — the dependency bag this
//     subpackage requires (drives repo + RAG retriever scoped to
//     route-efficiency subjects).
//   - AllowedRouteEfficiencySourceTypes — source-type allowlist used by
//     the retriever's Validate step.
//
// # ADR-011 §3 alias convention
//
// Callers importing this package alongside the parent tools package use
// the alias `routetool`:
//
//	import (
//	    "github.com/ev-dev-labs/teslasync/internal/ai/tools"
//	    routetool "github.com/ev-dev-labs/teslasync/internal/ai/tools/route"
//	)
//
// # ADR-015 §I12 contract
//
// The aivet contract is preserved verbatim across the carve:
// `aivet: OK — 59 AI route(s), 57 feature(s) in registry, 54 SPA wiring
// entries, TS mirror in sync` — verified after every R6 cluster.
//
// # Phase R6 lessons exercised
//
//   - Lesson 13 (test-file fake duplication across parent peers):
//     route_efficiency_test.go originally defined ptrStr/ptrInt16/ptrFloat64
//     helpers also consumed by trip_planner_llm_agent_test.go. The carve
//     migrated the consumers in this file to toolstest.PtrString /
//     PtrInt16 / PtrFloat64 and duplicated ptrStr+ptrFloat64 into
//     trip_planner_llm_agent_test.go so the next carve (R6.31) inherits a
//     working parent test file.
//   - Lesson 15 (dotted-access field rename): the regex pass capitalized
//     `f.err -> f.Err` on the local `failingByVehicleDrives` fake. That
//     fake's `err` field was promoted to `Err` to match — it embeds
//     toolstest.FakeDrives which is already capitalized, so the type is
//     internally consistent.
package route
