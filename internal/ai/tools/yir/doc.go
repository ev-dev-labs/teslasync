// Package yir is the year-in-review AI tool carved out of the flat
// internal/ai/tools package per ADR-011 §3 (bounded-context subpackages)
// and the ADR-015 amendment (AI subsystem in scope for Phase R, file-move
// only, no logic or contract changes).
//
// Layer: domain
//
// Contract preservation (per ADR-015 §I12):
//   - RegisterYearReviewTools registers exactly the same set of tools under
//     exactly the same names as before the carve.
//   - YearReviewSources mirrors the prior parent-package struct verbatim.
//   - Aivet sees the same surface: "59 AI route(s), 57 feature(s) in
//     registry, 54 SPA wiring entries, TS mirror in sync".
//
// Naming: "yir" (year-in-review) avoids the longer year_review token while
// staying recognisable; matches the strategy package name
// internal/ai/strategies/yir-narration.
//
// Alias convention (ADR-011 §3): callsites that import this AND
// internal/ai/tools should alias as yiraitools when both are needed
// at the same callsite. No collision exists in the current tree
// (router.go imports both but yir.* and tools.* are visually distinct).
//
// Lesson 10 reapplied (R6.22 cycle pattern, also documented in
// internal/ai/tools/digest/doc.go): parent _test.go files that call
// RegisterYearReviewTools to assert "my tool doesn't shadow year_review"
// are stripped during this carve (4 files: anomaly, charging_diagnosis,
// drive_coaching, speed_profile). Each test's PRIMARY assertion (its OWN
// tool doesn't shadow builtins) is unaffected. Cross-tool no-shadow
// integration is deferred to a single package tools_test test at R6 end.
package yir
