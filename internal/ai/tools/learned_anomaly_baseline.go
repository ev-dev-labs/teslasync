// Phase-50 / 0062 — ML1 Learned per-vehicle anomaly baselines.
//
// learned_anomaly_baseline.go ships TWO new READ-only typed tools:
//
//   - `train_anomaly_baseline` — recomputes the per-signal learned
//     anomaly envelope (mean / stddev / p5 / p95 per signal, clamped
//     to the static safeRanges envelope) for ONE vehicle over a
//     recent signal_log window using the deterministic statistical
//     trainer at internal/ml/anomaly. Per-signal Source label is
//     either "learned" (>= 30 samples in window) or
//     "safe_ranges_fallback" (< 30 samples ⇒ envelope drops back to
//     the static safeRanges entry the deterministic detector also
//     uses; SampleCount remains honest). NO row in signal_log is
//     written, NO learned envelope is persisted by this tool — the
//     trainer is request-scoped today; a future job-tier slice
//     (registered as JobNames=["ai_ml_anomaly_trainer"] in the
//     registry's RouteSet) may persist the envelope per vehicle for
//     cross-pod reuse.
//
//   - `query_anomaly_baseline` — returns the CURRENTLY-effective
//     per-vehicle envelope the deterministic anomaly detector at
//     internal/api/anomaly_handler.go uses today. Today, the
//     effective envelope is the static safeRanges fallback for
//     EVERY signal (this slice does not persist learned
//     envelopes); the LLM uses this tool to ground its narrative
//     in the user's CURRENTLY-effective baseline before quoting
//     the train_anomaly_baseline output as a PROPOSAL.
//
// Both tools are Mutates=false. The dispatcher's deny-all confirm
// gate (the AI handler injects a denyAllConfirm) is never reached
// in practice; defence-in-depth in case a future edit mistakenly
// flips Mutates to true.
//
// Tool-call ordering (enforced by the strategy's system prompt):
//
//   1. train_anomaly_baseline — produces the PROPOSED learned envelope
//      per signal, with explicit Source per entry.
//   2. query_anomaly_baseline — produces the CURRENTLY-effective
//      envelope (today: all-static).
//   3. Narrate the diff: which signals would tighten with learned
//      bounds, which fell back, which already match.
//
// The strategy's Description in goldens.yaml + system prompt MUST
// match this ordering exactly — the prompt's Action Steps list
// the tools in this order ("train_anomaly_baseline;query_anomaly_baseline").
//
// Privacy:
//
//   - vehicle_id is the only PII either tool consumes; the
//     LearnedBaseline DTO surfaces only signal-name + numeric
//     statistics.
//   - PolicyChatbot (deny-all redaction) is applied on top by the
//     AI handler before the request hits the provider, so even the
//     vehicle_id is round-trip-tagged in the LLM's view.
//
// Design constraints:
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → Both tools delegate to
//     internal/ml/anomaly (Trainer.Train and CurrentEffectiveEnvelope).
//     The trainer uses a narrow SignalSampleSource interface; the
//     production wiring (router.go) satisfies it via a thin pgx
//     adapter over signal_log. No SQL is written by these tools.
//   - "the LLM never writes raw SQL" → tools have no DB handle;
//     they pass typed inputs to the trainer.
//   - "no duplicate write paths" → no save_*/update_*/delete_*
//     tool exists in this slice; both tools are read-only.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/ev-dev-labs/teslasync/internal/ml/anomaly"
)

// learnedAnomalyBaselineMaxDays is the per-call upper bound on the
// trainer's lookback window. Mirrors anomaly.MaxDays so a typed
// input that exceeds it is rejected at the validator boundary
// rather than silently clamped inside the trainer.
const learnedAnomalyBaselineMaxDays = 30

// trainAnomalyBaselineInput is the typed input DTO for
// train_anomaly_baseline. The validator + JSON-Schema pin every
// constraint: the LLM cannot smuggle a non-positive vehicle_id or
// a 365-day window past the dispatcher.
type trainAnomalyBaselineInput struct {
	// VehicleID is the per-vehicle id the trainer scopes its
	// signal_log query to. Required; > 0.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" jsonschema:"description=Per-vehicle id to compute the learned anomaly envelope for. Required; > 0."`

	// Days is the lookback window in days. 0 ⇒ default 7;
	// must be in [1, 30] when non-zero. Mirrors the deterministic
	// detector's window so the learned envelope is computed over
	// the same observation set the user already sees alerts from.
	Days int `json:"days,omitempty" validate:"omitempty,gte=1,lte=30" jsonschema:"description=Lookback window in days; default 7; max 30."`
}

// queryAnomalyBaselineInput is the typed input DTO for
// query_anomaly_baseline. The tool returns the CURRENTLY-effective
// per-vehicle envelope; today every signal is the static
// safeRanges fallback. vehicle_id is required so a future slice
// that persists learned envelopes can scope the query.
type queryAnomalyBaselineInput struct {
	// VehicleID is the per-vehicle id the query scopes to. Required; > 0.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" jsonschema:"description=Per-vehicle id to fetch the currently-effective anomaly envelope for. Required; > 0."`
}

// ---------------------------------------------------------------------------
// train_anomaly_baseline
// ---------------------------------------------------------------------------

// trainAnomalyBaseline implements the train_anomaly_baseline tool.
type trainAnomalyBaseline struct {
	trainer *anomaly.Trainer
}

// Name implements [Tool].
func (t *trainAnomalyBaseline) Name() string { return "train_anomaly_baseline" }

// Description implements [Tool].
func (t *trainAnomalyBaseline) Description() string {
	return "Recompute the per-signal LEARNED anomaly envelope (mean / stddev / p5 / p95 per signal, clamped to the static safe-range envelope) for ONE vehicle over a recent signal_log window. " +
		"Per-signal `source` is either \"learned\" (≥ 30 samples in the window) or \"safe_ranges_fallback\" (< 30 samples ⇒ static envelope is used and `sample_count` reports the actual observed count). " +
		"READ-only — no learned envelope is persisted; the trainer is request-scoped. " +
		"Call this FIRST, then call query_anomaly_baseline, then narrate the diff between the proposed learned envelope and the currently-effective baseline."
}

// InputSchema implements [Tool].
func (t *trainAnomalyBaseline) InputSchema() json.RawMessage {
	return cachedSchema(trainAnomalyBaselineInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *trainAnomalyBaseline) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only.
func (t *trainAnomalyBaseline) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *trainAnomalyBaseline) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *trainAnomalyBaseline) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[trainAnomalyBaselineInput](raw)
}

// Execute implements [Tool]. One trainer round-trip; no SQL is
// written by this method.
func (t *trainAnomalyBaseline) Execute(ctx context.Context, in any) (any, error) {
	input, ok := in.(trainAnomalyBaselineInput)
	if !ok {
		return nil, fmt.Errorf("train_anomaly_baseline: validator returned wrong type %T", in)
	}
	if t.trainer == nil {
		return nil, errors.New("train_anomaly_baseline: no Trainer wired")
	}
	baselines, err := t.trainer.Train(ctx, input.VehicleID, input.Days)
	if err != nil {
		return nil, fmt.Errorf("train_anomaly_baseline: vehicle %d: %w", input.VehicleID, err)
	}

	days := input.Days
	if days == 0 {
		days = anomaly.DefaultDays
	}
	if days > learnedAnomalyBaselineMaxDays {
		days = learnedAnomalyBaselineMaxDays
	}

	return envelopeOutput(input.VehicleID, days, baselines), nil
}

// ---------------------------------------------------------------------------
// query_anomaly_baseline
// ---------------------------------------------------------------------------

// queryAnomalyBaseline implements the query_anomaly_baseline tool.
type queryAnomalyBaseline struct{}

// Name implements [Tool].
func (q *queryAnomalyBaseline) Name() string { return "query_anomaly_baseline" }

// Description implements [Tool].
func (q *queryAnomalyBaseline) Description() string {
	return "Return the CURRENTLY-effective per-signal anomaly envelope the deterministic detector at /api/v1/vehicles/{id}/anomalies uses today. " +
		"Today every signal is the static safeRanges fallback (this slice does not persist learned envelopes). " +
		"READ-only. Call this AFTER train_anomaly_baseline so you can narrate the diff between the proposed learned envelope and the user's current baseline."
}

// InputSchema implements [Tool].
func (q *queryAnomalyBaseline) InputSchema() json.RawMessage {
	return cachedSchema(queryAnomalyBaselineInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (q *queryAnomalyBaseline) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only.
func (q *queryAnomalyBaseline) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (q *queryAnomalyBaseline) RequiredScope() string { return "" }

// Validate implements [Tool].
func (q *queryAnomalyBaseline) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[queryAnomalyBaselineInput](raw)
}

// Execute implements [Tool]. Pure — no IO.
func (q *queryAnomalyBaseline) Execute(_ context.Context, in any) (any, error) {
	input, ok := in.(queryAnomalyBaselineInput)
	if !ok {
		return nil, fmt.Errorf("query_anomaly_baseline: validator returned wrong type %T", in)
	}
	baselines := anomaly.CurrentEffectiveEnvelope()
	return envelopeOutput(input.VehicleID, 0, baselines), nil
}

// ---------------------------------------------------------------------------
// Shared output shape
// ---------------------------------------------------------------------------

// envelopeOutput converts a slice of LearnedBaseline into the
// JSON-friendly map both tools return. days==0 is omitted (the
// query tool's window is "current effective"; the train tool's
// window is the actual lookback in days).
//
// All numeric fields are rounded to 4 decimal places so the
// envelope is deterministic across architectures (no x87 / fma
// drift) and so the goldens can pin exact values.
func envelopeOutput(vehicleID int64, days int, baselines []anomaly.LearnedBaseline) map[string]any {
	signals := make([]map[string]any, 0, len(baselines))
	learnedCount := 0
	fallbackCount := 0
	for _, b := range baselines {
		entry := map[string]any{
			"signal":       b.Signal,
			"source":       b.Source,
			"lower":        roundLearned(b.Lower, 4),
			"upper":        roundLearned(b.Upper, 4),
			"sample_count": b.SampleCount,
		}
		if b.Source == anomaly.SourceLearned {
			entry["mean"] = roundLearned(b.Mean, 4)
			entry["stddev"] = roundLearned(b.Stddev, 4)
			entry["p5"] = roundLearned(b.P5, 4)
			entry["p95"] = roundLearned(b.P95, 4)
			learnedCount++
		} else {
			fallbackCount++
		}
		signals = append(signals, entry)
	}
	out := map[string]any{
		"vehicle_id":          vehicleID,
		"signals":             signals,
		"signal_count":        len(signals),
		"learned_count":       learnedCount,
		"fallback_count":      fallbackCount,
		"min_samples_for_learned": anomaly.DefaultMinSamples,
	}
	if days > 0 {
		out["lookback_days"] = days
	}
	return out
}

// roundLearned rounds v to n decimal places. Defensive against
// +/-Inf and NaN (which can occur if a future edit feeds an empty
// slice into meanStddev — the trainer guards, but this is
// defence-in-depth at the JSON boundary).
func roundLearned(v float64, n int) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	scale := math.Pow(10, float64(n))
	return math.Round(v*scale) / scale
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// LearnedAnomalyBaselineSources bundles the narrow read interfaces
// RegisterLearnedAnomalyBaselineTools needs.
//
// Production wiring (router.go) constructs the trainer via a thin
// pgx-backed SignalSampleSource over signal_log; tests substitute
// a deterministic in-memory fake.
type LearnedAnomalyBaselineSources struct {
	Trainer *anomaly.Trainer
}

// RegisterLearnedAnomalyBaselineTools installs the
// learned-per-vehicle-anomaly-baselines slice's tools on r.
//
// Panics on duplicate registration (Registry.Register panics).
func RegisterLearnedAnomalyBaselineTools(r *Registry, s LearnedAnomalyBaselineSources) {
	r.Register(&trainAnomalyBaseline{trainer: s.Trainer})
	r.Register(&queryAnomalyBaseline{})
}
