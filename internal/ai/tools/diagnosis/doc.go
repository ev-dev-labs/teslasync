// Package diagnosis is the charging-diagnosis AI tool carved out of the
// flat internal/ai/tools package per ADR-011 §3 (bounded-context
// subpackages) and the ADR-015 amendment (AI in scope for Phase R,
// file-move only, no logic or contract changes).
//
// Layer: domain
//
// DISTINCT FROM internal/ai/tools/diagnostic (R6.15 carve, the
// general-purpose diagnostic tool family). This package is specifically
// the charging-flag-detection + cost-per-kWh + power-curve diagnosis
// AI tool registered as query_charging_diagnosis_context. The two
// subpackages are unrelated except by similar English names.
//
// Contract preservation (per ADR-015 §I12):
//   - RegisterChargingDiagnosisTools registers exactly the same set of
//     tools under exactly the same names as before the carve.
//   - ChargingDiagnosisSources mirrors the prior parent-package shape
//     verbatim.
//   - Aivet sees the same surface: "59 AI route(s), 57 feature(s) in
//     registry, 54 SPA wiring entries, TS mirror in sync".
//
// LESSON 12 reapplied (R6.25 pattern): charging_diagnosis.go originally
// defined unexported helper `lower` (ASCII-fast strings.ToLower shim)
// that automation_builder.go, schema.go, and tool.go ALSO consumed.
// Per Lesson 12, those helpers were promoted to a new parent file
// internal/ai/tools/strhelpers.go BEFORE the carve. Then `lower` was
// EXPORTED to tools.Lower because diagnosis/ subpkg also needs it
// (a parent file referencing a child symbol would be the wrong
// direction). All 4 callers updated to tools.Lower in one pass.
//
// LESSON 10 reapplied (R6.22 cycle pattern): cross-tool
// RegisterChargingDiagnosisTools(...) block stripped from 1 other
// parent test (speed_profile_test.go) + its associated
// "query_charging_diagnosis_context" expected-name list entry.
//
// LESSON 14 (NEW, R6.26): inline composite literals (single-line
// `&toolstest.FakeX{field: val}`) need a DIFFERENT regex than the
// line-anchored `(?m)^(\s+)<field>:` used in R6.25 for multi-line
// composite literals. The inline form requires
// `([{,]\s*)<field>(:)` which catches `{field:` and `, field:` start
// positions. Recipe addendum: run BOTH patterns in sequence to cover
// inline AND multi-line composite literals.
package diagnosis
