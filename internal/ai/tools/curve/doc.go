// Package curve is the charging-curve-fingerprint clustering AI tool
// carved out of the flat internal/ai/tools package per ADR-011 §3
// (bounded-context subpackages) and the ADR-015 amendment (AI in
// scope for Phase R, file-move only, no logic or contract changes).
//
// Layer: domain
//
// Contract preservation (per ADR-015 §I12):
//   - RegisterChargingCurveFingerprintClusteringTools registers exactly
//     the same set of tools under exactly the same names as before the
//     carve.
//   - ChargingCurveFingerprintClusteringSources, AllowedChargeCurveSourceTypes
//     mirror the prior parent-package shapes verbatim.
//   - Aivet sees the same surface: "59 AI route(s), 57 feature(s) in
//     registry, 54 SPA wiring entries, TS mirror in sync".
//
// Naming: "curve" — shortest unambiguous noun for the bounded context;
// the only sibling with similar meaning is internal/ai/tools/charge
// (R6.18) which covers charge-session basics; this curve subpkg covers
// the higher-level clustering analysis over many sessions.
//
// LESSON 15 (NEW, R6.27): subpkg test files consuming toolstest fakes
// need a THIRD regex pass beyond Lessons 9, 14: FIELD ACCESS
// (`ret.subjects`, `f.out`) — used on the right-hand-side of
// assertions, not as struct-literal field labels. Pattern
// `(\b\w+\.)<field>\b` catches dotted-access. Without this, every
// test that READS back a captured-call slice on a Fake* type fails
// vet with "type ... has no field or method <field>". Recipe addendum:
// run all THREE patterns in sequence: line-anchored, inline-literal,
// AND dotted-access.
//
// curve_test.go ALSO migrated 4 ptr-helpers to toolstest exports:
//
//	ptrFloat64/ptrInt16/ptrString/ptrTime →
//	  toolstest.PtrFloat64/PtrInt16/PtrString/PtrTime
//
// The unexported parent versions (in route_efficiency_test.go,
// test_helpers_test.go, trip_planner_llm_agent_test.go) stay put;
// only the carved test needs to call the exported toolstest variants.
//
// (No Lesson 10 cycle stripping was required for this carve — no
// parent _test.go calls RegisterChargingCurveFingerprintClusteringTools.)
package curve
