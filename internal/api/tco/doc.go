// Package tco serves GET /api/v1/analytics/tco (the deterministic
// True-Cost-of-Ownership endpoint consumed by the SPA's TrueCostPage
// chart) AND exports the SHARED pure helper [ComputeTCOSummary] +
// [TCOSummary] envelope that the AI narration adapter
// (api.AITCOSummarizer in ai_tco_narration_handler.go) consumes.
//
// Wire-shape stability: the canonical /api/v1/analytics/tco JSON shape
// is BYTE-IDENTICAL with the pre-refactor inline literal. A contract
// test (summary_test.go::TestComputeTCOSummary_StructFieldsPinWireShape)
// pins the JSON field list so any future drift breaks loudly — the
// React unit tests use hand-rolled fixtures and would not catch a
// renamed wire key.
//
// All math.Round + safeF guards live inside ComputeTCOSummary, NOT in
// the handler, so the chart and the AI envelope see the SAME rounded
// numbers (the LLM cannot be handed an unrounded float that disagrees
// with what the user sees on the chart).
//
// Layer: handler
package tco
