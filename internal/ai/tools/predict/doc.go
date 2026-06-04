// Package predict contains the "learn-from-history → predict future numbers"
// narration-tool family, kept in its own bounded-context subpackage per
// ADR-011 §3 and ADR-015-amend.
//
// All three tools follow the same shape: a Train* tool walks historical
// signal_log windows to fit a per-vehicle baseline/model, a Query* tool
// reads the most-recently-trained model and returns it as a JSON envelope
// the LLM narrates over. The shape preserves ADR-015 §I12 (AI-Off
// Contract) verbatim: same tool names, JSON tags, and Execute payloads.
//
//	battery_health.go     — RegisterBatteryHealthForecastNarrativeTools + BatteryHealth*
//	range.go              — RegisterRangePredictorTools + RangePredictorSources (trains via internal/ai/mlrange)
//	anomaly_baseline.go   — RegisterLearnedAnomalyBaselineTools + LearnedAnomalyBaselineSources (trains via internal/ai/anomaly)
//
// Unexported helpers (rangeEnvelopeOutput/roundRange in range.go,
// envelopeOutput/roundLearned in anomaly_baseline.go) keep their original
// names; the two trainer/query pairs still live side-by-side, so the
// distinct names avoid collisions.
//
// Alias convention (ADR-011 §3): callsites importing this package alongside
// other clusters MAY alias as `predictaitools` to disambiguate. The single
// composition root in internal/api/router.go imports without alias.
//
// Layer: domain
package predict
