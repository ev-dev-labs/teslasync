// Package forecast carves the cost/period/temperature-impact narration tool
// family out of the parent internal/ai/tools/ flat package per ADR-011 §3
// (bounded-context subpackages) + ADR-015-amend (AI subsystem in scope for
// Phase R, file-move-only). The three tools share a "compose deterministic
// analytics → typed envelope → LLM narrates over it" pattern and a strict
// Layer: domain charter:
//
//	cost.go               — RegisterCostForecastNarrationTools + CostForecast*
//	period_compare.go     — RegisterPeriodCompareNarrationTools + PeriodCompare*
//	temperature_impact.go — RegisterCabinTemperatureImpactNarrativeTools + TemperatureImpact*
//
// Cross-cluster contract preserved verbatim per ADR-015 §I12 (AI-Off Contract):
// every exported type/interface/function name, JSON tag, schema field name,
// and Execute payload shape is identical to the pre-R6.8 parent-pkg version.
// ai-vet + aigen mirror at web/src/ai/features.ts verify this at gate time.
//
// Alias convention (ADR-011 §3): callsites importing this package alongside
// other clusters MAY alias as `forecastaitools` to disambiguate from other
// "forecast" packages elsewhere in the tree. The composition root in
// internal/api/router.go imports it without alias because no collision
// exists there. Local-variable shadowing (e.g. `forecast := make(...)`) is
// avoided by renaming the local to `forecastMonths` in
// ai_cost_forecast_narration_handler.go.
//
// Layer: domain
package forecast
