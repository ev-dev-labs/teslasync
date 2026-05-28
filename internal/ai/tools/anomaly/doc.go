// Package anomaly is the anomaly-context AI tool carved out of the flat
// internal/ai/tools package per ADR-011 §3 (bounded-context subpackages)
// and the ADR-015 amendment (AI subsystem in scope for Phase R, file-move
// only, no logic or contract changes).
//
// Layer: domain
//
// Contract preservation (per ADR-015 §I12):
//   - RegisterAnomalyTools registers exactly the same set of tools under
//     exactly the same names (query_anomaly_context) as before the carve.
//   - AnomalySources, AnomalySource port, AnomalyContextResult, and
//     AnomalyContextEntry types mirror the prior parent-package shapes
//     verbatim.
//   - Aivet sees the same surface: "59 AI route(s), 57 feature(s) in
//     registry, 54 SPA wiring entries, TS mirror in sync".
//
// Alias convention (ADR-011 §3): callsites that ALSO import
// internal/ml/anomaly MUST alias this package as `anomalytool` to avoid
// the bare `anomaly` collision. Currently applied at
// internal/api/router.go. Single-import callsites (anomaly_handler.go,
// anomaly_handler_test.go) use the bare name.
//
// Lesson 10 reapplied (R6.22 cycle pattern): cross-tool
// RegisterAnomalyTools(...) blocks were stripped from 3 OTHER parent
// tests (charging_diagnosis, drive_coaching, speed_profile) plus their
// associated "query_anomaly_context" expected-name list entries. Each
// stripped test's PRIMARY assertion (its OWN tool doesn't shadow
// builtins) is unaffected. Cross-tool no-shadow integration is deferred
// to a single package tools_test test at R6 end.
//
// FakeAnomalySource (the local test fake at anomaly_test.go line 22) was
// NOT lifted into internal/ai/tools/toolstest because it depends on
// anomaly.AnomalyContextResult — that would create a cycle. The fake
// stays local to anomaly_test.go and is fine because only anomaly_test
// itself needs it now (the cross-tool registration blocks that used it
// from other parent tests were stripped per Lesson 10).
package anomaly
