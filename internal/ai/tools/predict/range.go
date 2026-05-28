// Phase-50 / 0063 — ML2 Range-prediction model.
//
// range_predictor.go ships TWO new READ-only typed tools:
//
//   - `train_range_model` — recomputes the per-bucket
//     (temp_bucket × speed_bucket) learned range envelope (mean
//     Wh/km plus stddev / p5 / p95 per bucket, with explicit Source
//     label per entry) for ONE vehicle over a recent `drives`
//     window using the deterministic statistical trainer at
//     internal/ml/range. Per-bucket Source label is either
//     "learned" (>= mlrange.DefaultMinSamplesPerBucket drives in
//     window) or "linear_fallback" (< MinSamples drives ⇒ envelope
//     drops back to the static HeuristicWhPerKm curve the
//     deterministic Projected Range page also uses; SampleCount
//     remains honest). NO row in `drives` is written, NO learned
//     envelope is persisted by this tool — the trainer is
//     request-scoped today; a future job-tier slice (registered as
//     JobNames=["ai_ml_range_trainer"] in the registry's RouteSet)
//     may persist the envelope per vehicle for cross-pod reuse.
//
//   - `query_range_prediction` — returns the CURRENTLY-effective
//     per-vehicle envelope the deterministic projection at
//     internal/api/range_projection_handler.go uses today. Today,
//     the effective envelope is the static HeuristicWhPerKm curve
//     for EVERY bucket (this slice does not persist learned
//     envelopes); the LLM uses this tool to ground its narrative
//     in the user's CURRENTLY-effective baseline before quoting
//     the train_range_model output as a PROPOSAL.
//
// Both tools are Mutates=false. The dispatcher's deny-all confirm
// gate (the AI handler injects a denyAllConfirm) is never reached
// in practice; defence-in-depth in case a future edit mistakenly
// flips Mutates to true.
//
// Tool-call ordering (enforced by the strategy's system prompt):
//
//  1. train_range_model — produces the PROPOSED learned envelope
//     per bucket, with explicit Source per entry.
//  2. query_range_prediction — produces the CURRENTLY-effective
//     envelope (today: all-static).
//  3. Narrate the diff: which buckets would refine with learned
//     bounds, which fell back, which already match.
//
// The strategy's Description in goldens.yaml + system prompt MUST
// match this ordering exactly — the prompt's Action Steps list the
// tools in this order ("train_range_model;query_range_prediction").
//
// Privacy:
//
//   - vehicle_id is the only PII either tool consumes; the
//     LearnedBucket DTO surfaces only bucket names + numeric
//     statistics.
//   - PolicyChatbot (deny-all redaction) is applied on top by the
//     AI handler before the request hits the provider, so even the
//     vehicle_id is round-trip-tagged in the LLM's view.
//
// Design constraints:
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → Both tools delegate to
//     internal/ml/range (Trainer.Train and CurrentEffectiveBuckets).
//     The trainer uses a narrow DriveStatsSource interface; the
//     production wiring (router.go) satisfies it via a thin pgx
//     adapter over the `drives` table. No SQL is written by these
//     tools.
//   - "the LLM never writes raw SQL" → tools have no DB handle;
//     they pass typed inputs to the trainer.
//   - "no duplicate write paths" → no save_*/update_*/delete_*
//     tool exists in this slice; both tools are read-only.

package predict

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	mlrange "github.com/ev-dev-labs/teslasync/internal/ml/range"
)

// rangeModelMaxDays is the per-call upper bound on the trainer's
// lookback window. Mirrors mlrange.MaxDays so a typed input that
// exceeds it is rejected at the validator boundary rather than
// silently clamped inside the trainer.
const rangeModelMaxDays = 30

// trainRangeModelInput is the typed input DTO for train_range_model.
// The validator + JSON-Schema pin every constraint: the LLM cannot
// smuggle a non-positive vehicle_id or a 365-day window past the
// dispatcher.
type trainRangeModelInput struct {
	// VehicleID is the per-vehicle id the trainer scopes its
	// `drives` query to. Required; > 0.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" jsonschema:"description=Per-vehicle id to compute the learned range envelope for. Required; > 0."`

	// Days is the lookback window in days. 0 ⇒ default 14;
	// must be in [1, 30] when non-zero. Mirrors the deterministic
	// projection's "based on N drives" window so the learned
	// envelope is computed over the same drive set the user
	// already sees range estimates from.
	Days int `json:"days,omitempty" validate:"omitempty,gte=1,lte=30" jsonschema:"description=Lookback window in days; default 14; max 30."`
}

// queryRangePredictionInput is the typed input DTO for
// query_range_prediction. The tool returns the CURRENTLY-effective
// per-vehicle envelope; today every bucket is the static heuristic
// fallback. vehicle_id is required so a future slice that persists
// learned envelopes can scope the query.
type queryRangePredictionInput struct {
	// VehicleID is the per-vehicle id the query scopes to. Required; > 0.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" jsonschema:"description=Per-vehicle id to fetch the currently-effective range envelope for. Required; > 0."`
}

// ---------------------------------------------------------------------------
// train_range_model
// ---------------------------------------------------------------------------

// trainRangeModel implements the train_range_model tool.
type trainRangeModel struct {
	trainer *mlrange.Trainer
}

// Name implements [Tool].
func (t *trainRangeModel) Name() string { return "train_range_model" }

// Description implements [Tool].
func (t *trainRangeModel) Description() string {
	return "Recompute the per-bucket (temp_bucket × speed_bucket) LEARNED range envelope (mean Wh/km plus stddev / p5 / p95 per bucket, with explicit Source label per entry) for ONE vehicle over a recent `drives` window. " +
		"Per-bucket `source` is either \"learned\" (≥ 5 drives in the window) or \"linear_fallback\" (< 5 drives ⇒ static heuristic Wh/km curve is used and `sample_count` reports the actual observed count). " +
		"READ-only — no learned envelope is persisted; the trainer is request-scoped. " +
		"Call this FIRST, then call query_range_prediction, then narrate the diff between the proposed learned envelope and the currently-effective heuristic baseline."
}

// InputSchema implements [Tool].
func (t *trainRangeModel) InputSchema() json.RawMessage {
	return tools.CachedSchema(trainRangeModelInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *trainRangeModel) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only.
func (t *trainRangeModel) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *trainRangeModel) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *trainRangeModel) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[trainRangeModelInput](raw)
}

// Execute implements [Tool]. One trainer round-trip; no SQL is
// written by this method.
func (t *trainRangeModel) Execute(ctx context.Context, in any) (any, error) {
	input, ok := in.(trainRangeModelInput)
	if !ok {
		return nil, fmt.Errorf("train_range_model: validator returned wrong type %T", in)
	}
	if t.trainer == nil {
		return nil, errors.New("train_range_model: no Trainer wired")
	}
	buckets, err := t.trainer.Train(ctx, input.VehicleID, input.Days)
	if err != nil {
		return nil, fmt.Errorf("train_range_model: vehicle %d: %w", input.VehicleID, err)
	}

	days := input.Days
	if days == 0 {
		days = mlrange.DefaultDays
	}
	if days > rangeModelMaxDays {
		days = rangeModelMaxDays
	}

	return rangeEnvelopeOutput(input.VehicleID, days, buckets), nil
}

// ---------------------------------------------------------------------------
// query_range_prediction
// ---------------------------------------------------------------------------

// queryRangePrediction implements the query_range_prediction tool.
type queryRangePrediction struct{}

// Name implements [Tool].
func (q *queryRangePrediction) Name() string { return "query_range_prediction" }

// Description implements [Tool].
func (q *queryRangePrediction) Description() string {
	return "Return the CURRENTLY-effective per-bucket range envelope the deterministic Projected Range page at /api/v1/vehicles/{id}/range/projection uses today. " +
		"Today every bucket is the static HeuristicWhPerKm curve fallback (this slice does not persist learned envelopes). " +
		"READ-only. Call this AFTER train_range_model so you can narrate the diff between the proposed learned envelope and the user's current baseline."
}

// InputSchema implements [Tool].
func (q *queryRangePrediction) InputSchema() json.RawMessage {
	return tools.CachedSchema(queryRangePredictionInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (q *queryRangePrediction) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only.
func (q *queryRangePrediction) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (q *queryRangePrediction) RequiredScope() string { return "" }

// Validate implements [Tool].
func (q *queryRangePrediction) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[queryRangePredictionInput](raw)
}

// Execute implements [Tool]. Pure — no IO.
func (q *queryRangePrediction) Execute(_ context.Context, in any) (any, error) {
	input, ok := in.(queryRangePredictionInput)
	if !ok {
		return nil, fmt.Errorf("query_range_prediction: validator returned wrong type %T", in)
	}
	buckets := mlrange.CurrentEffectiveBuckets()
	return rangeEnvelopeOutput(input.VehicleID, 0, buckets), nil
}

// ---------------------------------------------------------------------------
// Shared output shape
// ---------------------------------------------------------------------------

// rangeEnvelopeOutput converts a slice of LearnedBucket into the
// JSON-friendly map both tools return. days==0 is omitted (the
// query tool's window is "current effective"; the train tool's
// window is the actual lookback in days).
//
// All numeric fields are rounded to 4 decimal places so the
// envelope is deterministic across architectures (no x87 / fma
// drift) and so the goldens can pin exact values.
func rangeEnvelopeOutput(vehicleID int64, days int, buckets []mlrange.LearnedBucket) map[string]any {
	out := make([]map[string]any, 0, len(buckets))
	learnedCount := 0
	fallbackCount := 0
	for _, b := range buckets {
		entry := map[string]any{
			"temp_bucket":  b.TempBucket,
			"speed_bucket": b.SpeedBucket,
			"source":       b.Source,
			"wh_per_km":    roundRange(b.WhPerKm, 4),
			"sample_count": b.SampleCount,
		}
		if b.Source == mlrange.SourceLearned {
			entry["mean"] = roundRange(b.WhPerKm, 4)
			entry["stddev"] = roundRange(b.Stddev, 4)
			entry["p5"] = roundRange(b.P5, 4)
			entry["p95"] = roundRange(b.P95, 4)
			learnedCount++
		} else {
			fallbackCount++
		}
		out = append(out, entry)
	}
	res := map[string]any{
		"vehicle_id":              vehicleID,
		"buckets":                 out,
		"bucket_count":            len(out),
		"learned_count":           learnedCount,
		"fallback_count":          fallbackCount,
		"min_samples_for_learned": mlrange.DefaultMinSamplesPerBucket,
	}
	if days > 0 {
		res["lookback_days"] = days
	}
	return res
}

// roundRange rounds v to n decimal places. Defensive against
// +/-Inf and NaN (which can occur if a future edit feeds an empty
// slice into meanStddev — the trainer guards, but this is
// defence-in-depth at the JSON boundary).
func roundRange(v float64, n int) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	scale := math.Pow(10, float64(n))
	return math.Round(v*scale) / scale
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// RangePredictorSources bundles the narrow read interfaces
// RegisterRangePredictorTools needs.
//
// Production wiring (router.go) constructs the trainer via a thin
// pgx-backed DriveStatsSource over the `drives` table; tests
// substitute a deterministic in-memory fake.
type RangePredictorSources struct {
	Trainer *mlrange.Trainer
}

// RegisterRangePredictorTools installs the range-prediction-model
// slice's tools on r.
//
// Panics on duplicate registration (Registry.Register panics).
func RegisterRangePredictorTools(r *tools.Registry, s RangePredictorSources) {
	r.Register(&trainRangeModel{trainer: s.Trainer})
	r.Register(&queryRangePrediction{})
}
