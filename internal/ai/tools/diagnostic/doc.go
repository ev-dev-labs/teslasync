// Package diagnostic groups the data-repair-suggestions,
// mqtt-sse-inspector-explanations, and cross-rule-conflict-detection tool
// family from the flat internal/ai/tools package. The three tools share a
// "diagnose problems across the system" theme and a strict Layer: domain
// charter:
//
//	data_repair.go       — RegisterDataRepairSuggestionsTools + DataRepair*
//	stream_inspector.go  — RegisterMqttSseInspectorExplanationsTools +
//	                       StreamInspector* (MQTT + SSE stream chunks)
//	cross_rule.go        — RegisterCrossRuleConflictDetectionTools +
//	                       DetectRuleConflicts + RuleConflict*
//
// Cross-cluster contract preserved verbatim per ADR-015 §I12 (AI-Off Contract):
// every exported type/interface/function name, JSON tag, schema field name,
// and Execute payload shape is identical to the previous parent-pkg version.
// ai-vet + aigen mirror at web/src/ai/features.ts verify this at gate time.
//
// Alias convention (ADR-011 §3): callsites importing this package alongside
// other clusters MAY alias as `diagnosticaitools` to disambiguate. The
// composition root in internal/api/router.go imports it without alias
// because no collision exists there.
//
// Layer: domain
package diagnostic
