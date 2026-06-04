// Package maintenance carves the predictive-maintenance and
// tire-pressure-trend-reasoning tool family out of the parent
// internal/ai/tools/ flat package per ADR-011 §3 (bounded-context
// subpackages) + ADR-015-amend (AI subsystem in scope for Phase R,
// file-move-only). The two tools share a "predict / reason about
// vehicle maintenance signals" theme and a strict Layer: domain
// charter:
//
//	predictive.go    — RegisterPredictiveMaintenanceTools +
//	                   MaintenancePrediction*
//	tire_pressure.go — RegisterTirePressureTrendReasoningTools +
//	                   TirePressure* + TireOutsideTempSummary
//
// Cross-cluster contract preserved verbatim per ADR-015 §I12 (AI-Off
// Contract): every exported type/interface/function name, JSON tag,
// schema field name, and Execute payload shape is identical to the
// pre-R6.17 parent-pkg version. ai-vet + aigen mirror at
// web/src/ai/features.ts verify this at gate time.
//
// Alias convention (ADR-011 §3): callsites importing this package
// alongside other clusters MAY alias as `maintenanceaitools` to
// disambiguate. The composition root in internal/api/router.go
// imports it without alias because no collision exists there.
//
// Layer: domain
package maintenance
