// Package diagnostic carves the data-repair-suggestions,
// mqtt-sse-inspector-explanations, and cross-rule-conflict-detection tool
// family out of the parent internal/ai/tools/ flat package per ADR-011 §3
// (bounded-context subpackages) + ADR-015-amend (AI subsystem in scope for
// Phase R, file-move-only). The three tools share a "diagnose problems
// across the system" theme and a strict Layer: domain charter:
//
//	data_repair.go       — RegisterDataRepairSuggestionsTools + DataRepair*
//	stream_inspector.go  — RegisterMqttSseInspectorExplanationsTools +
//	                       StreamInspector* (MQTT + SSE stream chunks)
//	cross_rule.go        — RegisterCrossRuleConflictDetectionTools +
//	                       DetectRuleConflicts + RuleConflict*
//
// Cross-cluster contract preserved verbatim per ADR-015 §I12 (AI-Off Contract):
// every exported type/interface/function name, JSON tag, schema field name,
// and Execute payload shape is identical to the pre-R6.15 parent-pkg version.
// ai-vet + aigen mirror at web/src/ai/features.ts verify this at gate time.
//
// Alias convention (ADR-011 §3): callsites importing this package alongside
// other clusters MAY alias as `diagnosticaitools` to disambiguate. The
// composition root in internal/api/router.go imports it without alias
// because no collision exists there.
//
// Layer: domain
package diagnostic
