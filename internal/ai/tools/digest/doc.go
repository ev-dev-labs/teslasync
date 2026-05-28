// Package digest carves the weekly-digest AI tool out of the parent
// internal/ai/tools/ flat package per ADR-011 §3 (bounded-context
// subpackages) + ADR-015-amend (AI subsystem in scope for Phase R,
// file-move-only). Single-tool cluster:
//
//	digest.go — RegisterDigestTools + DigestSources port +
//	            queryWeeklyDigestContext tool
//
// Second toolstest consumer (R6.22, after paint at R6.21). digest_test.go
// uses toolstest.FakeVehicles/FakeState/.../FakeRules/FakeNotif/FakeFences
// for full builtin-registration coverage AND demonstrates the
// canonical &toolstest.FakeDrives{} / &toolstest.FakeCharges{}
// composite-literal pattern carved subpkg tests will use.
//
// IMPORT-CYCLE RESOLUTION (R6.22 lesson, NEW): the parent's
// cross-tool "does not shadow builtins" tests (anomaly_test.go,
// charging_diagnosis_test.go, drive_coaching_test.go,
// speed_profile_test.go, year_review_test.go) previously called
// RegisterDigestTools to assert digest survives a sibling tool's
// registration. That created a cycle (parent test → digest pkg →
// parent pkg). The cross-digest registration calls + the
// "query_weekly_digest_context" expected-name check were REMOVED
// from those parent tests because (a) each test's primary assertion
// (its OWN tool doesn't shadow builtins) is unaffected by what other
// tools are registered, and (b) a future R6-end cross-tool integration
// test in package tools_test (using toolstest fakes) will assert the
// cross-tool no-shadow property once.
//
// Cross-cluster contract preserved verbatim per ADR-015 §I12 (AI-Off
// Contract): every exported type/interface/function name, JSON tag,
// schema field name, and Execute payload shape is identical to the
// pre-R6.22 parent-pkg version. ai-vet + aigen mirror at
// web/src/ai/features.ts verify this at gate time.
//
// Layer: domain
package digest
