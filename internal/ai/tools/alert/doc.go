// Package alert hosts the AI tool implementations for alert-rule
// management: drafting new rules from natural-language prompts and
// tuning existing rules based on firing history.
//
// Two tools:
//   - alert_builder: drafts an AlertRule from a NL goal, then a
//     companion validate tool runs the canonical validator
//     before persistence.
//   - alert_tuning: proposes a patch to an existing rule based on
//     its recent firing history (false-positive reduction or
//     sensitivity boost).
//
// They share `*alertmodel.AlertRule` plus the validate-then-draft
// two-step pattern, so they live together in this subpkg per
// ADR-011 §2 — bounded-context grouping wins over per-tool
// granularity when tools share non-trivial helper surface.
//
// Carved out of internal/ai/tools (R6.7). The exported symbols
// (AlertRuleValidator, AlertRuleFiringHistory, AlertRulePatchProposal,
// AlertTuningSource, AlertBuilderSources, AlertTuningSuggestionsSources,
// RegisterAlertBuilderTools, RegisterAlertTuningSuggestionsTools) keep
// their verbatim names for git bisectability — only the import path
// moved.
//
// Layer: adapter (per ADR-007 — the ai-tools layer is the adapter
// implementation of internal/port/ai for the strategy dispatcher;
// it is consumed by the AI guard chain in internal/api).
//
// ADR-011 §3 alias convention: callers importing this package
// alongside the parent ai/tools should use the alias `alertaitools`.
// At single-import callsites no alias is required.
//
// ADR-015 §I12 contract preservation: FILE-MOVE-ONLY refactor. No
// AI strategy or tool logic changed. Both /api/v1/ai/alert-builder
// and /api/v1/ai/alert-tuning-suggestions routes still re-check
// ai_mode + per-feature toggles on every tick and still return
// {Skipped: 1} with zero side effects when AI is off. Verified by
// `make ai-vet` (PASS) at the cluster commit.
//
// Test-helper note: a tiny `ptrFloat64(v) *float64` helper was
// inlined into tuning_test.go (was previously shared in the parent
// package's route_efficiency_test.go). When the next shared-fixture
// cluster carve hits (automation/charging/drive/digest tests use
// Register12Builtins + fakeVehicles + fakeState + ...), promote the
// shared helpers to a proper `internal/ai/tools/toolstest` exported
// fixture package rather than inlining.
package alert
