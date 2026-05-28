// Phase-50 / 0064 — ML3 Charging-curve fingerprint clustering statistical model.
//
// charge_curve_clusters.go ships TWO new READ-only typed tools:
//
//   - `train_charge_curve_clusters` — recomputes the per-cluster
//     (L1 overnight / L2 workplace / DC fast / unknown) learned
//     charging-curve envelope (mean peak power plus stddev / p5 / p95
//     per cluster, mean avg power, mean total energy, mean duration,
//     mean ramp shape, dominant charger type, with explicit Source
//     label per entry) for ONE vehicle over a recent
//     `charging_sessions` window using the deterministic
//     statistical trainer at internal/ml/chargingcurves. Per-cluster
//     Source label is either "learned" (>=
//     mlchargingcurves.DefaultMinSessionsPerCluster sessions in
//     window) or "rule_label_fallback" (< MinSessions sessions ⇒
//     envelope drops back to the deterministic L1/L2/DC rule label
//     without per-cluster statistics; SessionCount remains honest).
//     NO row in `charging_sessions` is written, NO learned envelope
//     is persisted by this tool — the trainer is request-scoped
//     today; a future job-tier slice (registered as
//     JobNames=["ai_ml_charge_curve_trainer"] in the registry's
//     RouteSet) may persist the envelope per vehicle for cross-pod
//     reuse.
//
//   - `query_charge_curve_clusters` — returns the
//     CURRENTLY-effective per-vehicle envelope the deterministic
//     Charging Curve page uses today. Today, the effective envelope
//     is the rule label for EVERY cluster (this slice does not
//     persist learned envelopes); the LLM uses this tool to ground
//     its narrative in the user's CURRENTLY-effective baseline
//     before quoting the train_charge_curve_clusters output as a
//     PROPOSAL.
//
// Both tools are Mutates=false. The dispatcher's deny-all confirm
// gate (the AI handler injects a denyAllConfirm) is never reached
// in practice; defence-in-depth in case a future edit mistakenly
// flips Mutates to true.
//
// Tool-call ordering (enforced by the strategy's system prompt):
//
//  1. train_charge_curve_clusters — produces the PROPOSED learned
//     envelope per cluster, with explicit Source per entry.
//  2. query_charge_curve_clusters — produces the
//     CURRENTLY-effective envelope (today: all-rule-label).
//  3. Narrate the diff: which clusters would refine with learned
//     bounds, which fell back, which already match.
//
// The strategy's Description in goldens.yaml + system prompt MUST
// match this ordering exactly — the prompt's Action Steps list the
// tools in this order
// ("train_charge_curve_clusters;query_charge_curve_clusters").
//
// Privacy:
//
//   - vehicle_id is the only PII either tool consumes; the
//     LearnedCluster DTO surfaces only cluster IDs + numeric
//     statistics + dominant_charger_type (a free-form opaque label).
//   - PolicyChatbot (deny-all redaction) is applied on top by the
//     AI handler before the request hits the provider, so even the
//     vehicle_id is round-trip-tagged in the LLM's view.
//
// Distinction from the C3 sibling slice 0028's
// retrieve_charge_curve_clusters tool in
// internal/ai/tools/charge_curve_clustering.go:
//
//   - C3's retrieve_charge_curve_clusters is an aggregator: it
//     groups sessions by power tier and reports per-cluster
//     averages but does NOT compute stddev / p5 / p95 and does NOT
//     distinguish a learned envelope from a rule-label fallback.
//
//   - ML3's train_charge_curve_clusters (this file) is a STATISTICAL
//     trainer: it computes per-cluster mean / stddev / p5 / p95 and
//     explicitly labels Source=learned vs Source=rule_label_fallback
//     per cluster. The narrator surfaces the diff between the
//     proposed learned envelope and the rule-label baseline.
//
// Both tools coexist in the registry; a slice that consumes one
// does not interfere with the other.
//
// Design constraints:
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → Both tools delegate to
//     internal/ml/chargingcurves (Trainer.Train and
//     CurrentEffectiveClusters). The trainer uses a narrow
//     SessionSource interface; the production wiring (router.go)
//     satisfies it via a thin adapter over the existing
//     ChargingRepo. No SQL is written by these tools.
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

	mlchargingcurves "github.com/ev-dev-labs/teslasync/internal/ml/chargingcurves"
)

// chargeCurveMaxLookbackDays is the per-call upper bound on the
// trainer's lookback window. Mirrors
// mlchargingcurves.MaxLookbackDays so a typed input that exceeds
// it is rejected at the validator boundary rather than silently
// clamped inside the trainer.
const chargeCurveMaxLookbackDays = 365

// trainChargeCurveClustersInput is the typed input DTO for
// train_charge_curve_clusters. The validator + JSON-Schema pin
// every constraint: the LLM cannot smuggle a non-positive
// vehicle_id or a multi-year window past the dispatcher.
type trainChargeCurveClustersInput struct {
	// VehicleID is the per-vehicle id the trainer scopes its
	// `charging_sessions` query to. Required; > 0.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" jsonschema:"description=Per-vehicle id to compute the learned charging-cluster envelope for. Required; > 0."`

	// LookbackDays is the lookback window in days. 0 ⇒ default 90;
	// must be in [1, 365] when non-zero. Wider than the
	// range-prediction-model (30 days) because charging sessions
	// are O(0.1-1/day) per vehicle so a tight window would route
	// every cluster through the fallback in practice for the
	// typical first-month-of-data user.
	LookbackDays int `json:"lookback_days,omitempty" validate:"omitempty,gte=1,lte=365" jsonschema:"description=Lookback window in days; default 90; max 365."`
}

// queryChargeCurveClustersInput is the typed input DTO for
// query_charge_curve_clusters. The tool returns the
// CURRENTLY-effective per-vehicle envelope; today every cluster is
// the rule-label fallback. vehicle_id is required so a future
// slice that persists learned envelopes can scope the query.
type queryChargeCurveClustersInput struct {
	// VehicleID is the per-vehicle id the query scopes to.
	// Required; > 0.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" jsonschema:"description=Per-vehicle id to fetch the currently-effective charging-cluster envelope for. Required; > 0."`
}

// ---------------------------------------------------------------------------
// train_charge_curve_clusters
// ---------------------------------------------------------------------------

// trainChargeCurveClusters implements the train_charge_curve_clusters tool.
type trainChargeCurveClusters struct {
	trainer *mlchargingcurves.Trainer
}

// Name implements [Tool].
func (t *trainChargeCurveClusters) Name() string { return "train_charge_curve_clusters" }

// Description implements [Tool].
func (t *trainChargeCurveClusters) Description() string {
	return "Recompute the per-cluster (L1 overnight / L2 workplace / DC fast / unknown) LEARNED charging envelope (mean peak power plus stddev / p5 / p95 per cluster, mean avg power, mean total energy, mean duration, mean ramp shape, dominant charger type, with explicit Source label per entry) for ONE vehicle over a recent `charging_sessions` window. " +
		"Per-cluster `source` is either \"learned\" (≥ 3 sessions in the window) or \"rule_label_fallback\" (< 3 sessions ⇒ deterministic L1/L2/DC rule label is reported instead and `session_count` reports the actual observed count). " +
		"READ-only — no learned envelope is persisted; the trainer is request-scoped. " +
		"Call this FIRST, then call query_charge_curve_clusters, then narrate the diff between the proposed learned envelope and the currently-effective rule-label baseline."
}

// InputSchema implements [Tool].
func (t *trainChargeCurveClusters) InputSchema() json.RawMessage {
	return CachedSchema(trainChargeCurveClustersInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *trainChargeCurveClusters) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only.
func (t *trainChargeCurveClusters) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (t *trainChargeCurveClusters) RequiredScope() string { return "" }

// Validate implements [Tool].
func (t *trainChargeCurveClusters) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[trainChargeCurveClustersInput](raw)
}

// Execute implements [Tool]. One trainer round-trip; no SQL is
// written by this method.
func (t *trainChargeCurveClusters) Execute(ctx context.Context, in any) (any, error) {
	input, ok := in.(trainChargeCurveClustersInput)
	if !ok {
		return nil, fmt.Errorf("train_charge_curve_clusters: validator returned wrong type %T", in)
	}
	if t.trainer == nil {
		return nil, errors.New("train_charge_curve_clusters: no Trainer wired")
	}
	clusters, err := t.trainer.Train(ctx, input.VehicleID, input.LookbackDays)
	if err != nil {
		return nil, fmt.Errorf("train_charge_curve_clusters: vehicle %d: %w", input.VehicleID, err)
	}

	days := input.LookbackDays
	if days == 0 {
		days = mlchargingcurves.DefaultLookbackDays
	}
	if days > chargeCurveMaxLookbackDays {
		days = chargeCurveMaxLookbackDays
	}

	return chargeCurveClustersOutput(input.VehicleID, days, clusters), nil
}

// ---------------------------------------------------------------------------
// query_charge_curve_clusters
// ---------------------------------------------------------------------------

// queryChargeCurveClusters implements the query_charge_curve_clusters tool.
type queryChargeCurveClusters struct{}

// Name implements [Tool].
func (q *queryChargeCurveClusters) Name() string { return "query_charge_curve_clusters" }

// Description implements [Tool].
func (q *queryChargeCurveClusters) Description() string {
	return "Return the CURRENTLY-effective per-cluster charging envelope the deterministic Charging Curve page at /charging/curves uses today. " +
		"Today every cluster is the rule-label classification fallback (this slice does not persist learned envelopes). " +
		"READ-only. Call this AFTER train_charge_curve_clusters so you can narrate the diff between the proposed learned envelope and the user's current baseline."
}

// InputSchema implements [Tool].
func (q *queryChargeCurveClusters) InputSchema() json.RawMessage {
	return CachedSchema(queryChargeCurveClustersInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (q *queryChargeCurveClusters) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only.
func (q *queryChargeCurveClusters) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty.
func (q *queryChargeCurveClusters) RequiredScope() string { return "" }

// Validate implements [Tool].
func (q *queryChargeCurveClusters) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[queryChargeCurveClustersInput](raw)
}

// Execute implements [Tool]. Pure — no IO.
func (q *queryChargeCurveClusters) Execute(_ context.Context, in any) (any, error) {
	input, ok := in.(queryChargeCurveClustersInput)
	if !ok {
		return nil, fmt.Errorf("query_charge_curve_clusters: validator returned wrong type %T", in)
	}
	clusters := mlchargingcurves.CurrentEffectiveClusters()
	return chargeCurveClustersOutput(input.VehicleID, 0, clusters), nil
}

// ---------------------------------------------------------------------------
// Shared output shape
// ---------------------------------------------------------------------------

// chargeCurveClustersOutput converts a slice of LearnedCluster into
// the JSON-friendly map both tools return. days==0 is omitted (the
// query tool's window is "current effective"; the train tool's
// window is the actual lookback in days).
//
// All numeric fields are rounded to 4 decimal places so the
// envelope is deterministic across architectures (no x87 / fma
// drift) and so the goldens can pin exact values.
func chargeCurveClustersOutput(vehicleID int64, days int, clusters []mlchargingcurves.LearnedCluster) map[string]any {
	out := make([]map[string]any, 0, len(clusters))
	learnedCount := 0
	fallbackCount := 0
	for _, c := range clusters {
		entry := map[string]any{
			"cluster_id":            c.ClusterID,
			"source":                c.Source,
			"session_count":         c.SessionCount,
			"dominant_charger_type": c.DominantChargerType,
			"example_session_ids":   c.ExampleSessionIDs,
		}
		if c.Source == mlchargingcurves.SourceLearned {
			entry["peak_power_w_mean"] = roundCharge(c.PeakPowerWMean, 4)
			entry["peak_power_w_stddev"] = roundCharge(c.PeakPowerWStddev, 4)
			entry["peak_power_w_p5"] = roundCharge(c.PeakPowerWP5, 4)
			entry["peak_power_w_p95"] = roundCharge(c.PeakPowerWP95, 4)
			entry["avg_power_w_mean"] = roundCharge(c.AvgPowerWMean, 4)
			entry["avg_power_w_stddev"] = roundCharge(c.AvgPowerWStddev, 4)
			entry["total_energy_wh_mean"] = roundCharge(c.TotalEnergyWhMean, 4)
			entry["total_energy_wh_stddev"] = roundCharge(c.TotalEnergyWhStddev, 4)
			entry["duration_min_mean"] = roundCharge(c.DurationMinMean, 4)
			entry["delta_soc_pct_mean"] = roundCharge(c.DeltaSocPctMean, 4)
			entry["ramp_shape_mean"] = roundCharge(c.RampShapeMean, 4)
			learnedCount++
		} else {
			fallbackCount++
		}
		out = append(out, entry)
	}
	res := map[string]any{
		"vehicle_id":               vehicleID,
		"clusters":                 out,
		"cluster_count":            len(out),
		"learned_count":            learnedCount,
		"fallback_count":           fallbackCount,
		"min_sessions_for_learned": mlchargingcurves.DefaultMinSessionsPerCluster,
	}
	if days > 0 {
		res["lookback_days"] = days
	}
	return res
}

// roundCharge rounds v to n decimal places. Defensive against
// +/-Inf and NaN (which can occur if a future edit feeds an empty
// slice into meanStddev — the trainer guards, but this is
// defence-in-depth at the JSON boundary).
func roundCharge(v float64, n int) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	scale := math.Pow(10, float64(n))
	return math.Round(v*scale) / scale
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// ChargeCurveClustersSources bundles the narrow read interfaces
// RegisterChargeCurveClustersTools needs.
//
// Production wiring (router.go) constructs the trainer via a thin
// adapter satisfying mlchargingcurves.SessionSource over the
// existing `charging_sessions` repo; tests substitute a
// deterministic in-memory fake.
type ChargeCurveClustersSources struct {
	Trainer *mlchargingcurves.Trainer
}

// RegisterChargeCurveClustersTools installs the
// ml-charging-curve-clustering slice's tools on r.
//
// Panics on duplicate registration (Registry.Register panics).
func RegisterChargeCurveClustersTools(r *Registry, s ChargeCurveClustersSources) {
	r.Register(&trainChargeCurveClusters{trainer: s.Trainer})
	r.Register(&queryChargeCurveClusters{})
}
