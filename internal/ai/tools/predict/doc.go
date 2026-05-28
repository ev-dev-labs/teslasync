// Package predict carves the "learn-from-history → predict future numbers"
// narration-tool family out of the parent internal/ai/tools/ flat package
// per ADR-011 §3 (bounded-context subpackages) + ADR-015-amend (AI subsystem
// in scope for Phase R, file-move-only).
//
// All three tools follow the same shape: a Train* tool walks historical
// signal_log windows to fit a per-vehicle baseline/model, a Query* tool
// reads the most-recently-trained model and returns it as a JSON envelope
// the LLM narrates over. The shape preserves ADR-015 §I12 (AI-Off
// Contract) verbatim — same tool names, same JSON tags, same Execute
// payloads as the pre-R6.9 parent-pkg versions.
//
//	battery_health.go     — RegisterBatteryHealthForecastNarrativeTools + BatteryHealth*
//	range.go              — RegisterRangePredictorTools + RangePredictorSources (trains via internal/ai/mlrange)
//	anomaly_baseline.go   — RegisterLearnedAnomalyBaselineTools + LearnedAnomalyBaselineSources (trains via internal/ai/anomaly)
//
// Unexported helpers (rangeEnvelopeOutput/roundRange in range.go,
// envelopeOutput/roundLearned in anomaly_baseline.go) keep their original
// names — they were named distinctly in the parent pkg precisely because
// the two trainer/query pairs lived side-by-side, so no collision arises
// from the carve.
//
// Alias convention (ADR-011 §3): callsites importing this package alongside
// other clusters MAY alias as `predictaitools` to disambiguate. The single
// composition root in internal/api/router.go imports without alias.
//
// Layer: domain
package predict
