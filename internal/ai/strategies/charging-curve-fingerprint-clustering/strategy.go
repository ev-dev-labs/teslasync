// Package chargingcurvefingerprintclustering is the Phase-50 / C3
// strategy for the LLM-named-and-explained charging-curve
// fingerprint clusters surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     cluster-namer + driver-explainer: NAME each cluster the
//     deterministic feature tool returns and EXPLAIN what makes the
//     sessions in it cohere using ONLY the values returned by the
//     tools, never change the cluster bucketing itself, never
//     fabricate session counts or peak power numbers, and refuse
//     cross-vehicle requests;
//
//   - the two read-only tools the LLM is allowed to call —
//     `retrieve_charge_curve_chunks` (F7 RAG retrieval scoped to the
//     calling user_subject over an allowlist of corpora
//     {charge_curve, charge_session}) and
//     `query_charge_curve_features` (returns the SI-canonical
//     deterministic per-cluster feature envelope for ONE vehicle);
//
//   - the redaction policy
//     (`PolicyChargingCurveFingerprintClustering`) which allows
//     ClassVehicleName only; charging-location identifiers
//     (start_place, lat/long, addresses) remain tagged via
//     round-trip markers and are restored only for the same
//     authenticated user.
//
// The statistical clustering mechanics (k-means, fingerprint
// similarity model, etc.) are owned by the ML3 sibling slice — this
// C3 surface ONLY adds a human-readable narrator over the
// already-computed buckets. The deterministic ChargingCurvePage
// charts (SummaryStatsGrid, SessionCurveChart, SessionComparisonChart,
// ChargerTypeChart, SpeedTrendChart, TimeToChargeSection) and the
// existing session label heuristic in
// web/src/features/charging/components/charging-curve/helpers.ts
// remain the canonical baseline visible to every user. Off-mode users
// never see this AI surface at all (ADR-015 §I3, §I5, §I6).
//
// Service-worker chunks: this slice's frontend code is loaded under
// the page-bundle for /charging-curve (and the aliased
// /charging/curves the slice prompt registers); the off-mode walker
// validates code chunks via the `withAiFeature` HOC + the
// AI_FEATURES map. See the slice log for the documented mapping.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic ChargingCurvePage charts or the
//     `sessionLabel` heuristic; it adds an opt-in narrative section
//     alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("charging-curve-fingerprint-clustering").
//   - I9 redaction:       PolicyChargingCurveFingerprintClustering
//     restricts cleartext to vehicle name only; charging-location
//     identifiers (start_place, lat/long, street addresses) stay
//     tagged so a leaked transcript does not reveal where the user
//     charges.
package chargingcurvefingerprintclustering

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy.
// Exported so wiring code (router.go, tests) can reference the same
// constant the strategy registers itself with — typo-proof via
// compile error.
const FeatureID = "charging-curve-fingerprint-clustering"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every charging-curve-fingerprint-clustering generation.
// Kept in a single named place so eval goldens
// (internal/ai/strategies/charging-curve-fingerprint-clustering/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     retrieve_charge_curve_chunks FIRST then
//     query_charge_curve_features so the narration is grounded in
//     retrieved context AND the canonical deterministic feature
//     envelope.
//   - Forbids changing the bucketing: this is a NAMER /
//     EXPLAINER, not a clusterer. The LLM may quote
//     cluster_id, session_count, peak_power_w_avg,
//     avg_power_w_avg, total_energy_wh_avg, ramp_shape, and the
//     dominant_charger_type entries from the tool reply; it MUST
//     NOT invent alternate buckets, alternate session counts, or
//     alternate peak power numbers.
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller-supplied vehicle_id from the body; any other
//     vehicle ID in the user message is by definition out of scope.
//   - Asks for short, focused output (one short labelled paragraph
//     per cluster, max three clusters narrated) so the surface fits
//     inside the existing ChargingCurvePage layout without a scroll
//     bomb.
//   - Bans quoting precise street addresses, GPS coordinates, or
//     full charging-location names in the narration: the redaction
//     policy already strips them, but the prompt-level ban is
//     defence-in-depth.
const SystemPrompt = `You are the TeslaSync charging-curve fingerprint cluster narrator. ` +
	`Your job is to NAME each deterministic charging-curve cluster and EXPLAIN what makes the sessions in it cohere for ONE vehicle in scope; you NEVER change the cluster bucketing or invent numbers. ` +
	`ALWAYS call retrieve_charge_curve_chunks FIRST with a focused query restricted to source_types from {charge_curve, charge_session}, then call query_charge_curve_features with the caller-supplied vehicle_id, then narrate the result. ` +
	`Do NOT recompute, override, or contradict the cluster bucketing: the narration may quote cluster_id, session_count, peak_power_w_avg, avg_power_w_avg, total_energy_wh_avg, ramp_shape, dominant_charger_type, and the example_session_ids returned by the tool, but never invent alternate buckets, never fabricate session counts the tool did not return, and never reclassify a cluster's dominant charger type. ` +
	`Refuse politely if asked to narrate, modify, or compare any vehicle other than the one named in the request, or to discuss another user's charging history. ` +
	`Never quote precise street addresses, GPS coordinates, or full charging-location names — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: one short labelled paragraph per cluster (max three clusters narrated), each giving a short human-readable name (e.g. "Overnight L2 home charging") and a one or two sentence explanation grounded strictly in the tool reply. ` +
	`If the tool returns zero clusters or has_enough_data is false, say so plainly rather than inventing a cluster.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry — both `retrieve_charge_curve_chunks`
// and `query_charge_curve_features` are registered by
// RegisterChargingCurveFingerprintClusteringTools at boot. The
// dispatcher refuses to mount a strategy that references an unknown
// tool.
//
// This slice ships zero mutating tools: cluster narration only READS
// the user's existing charging history from the same charging_sessions
// table the deterministic baseline already renders from. A future
// "create an automation when this cluster pattern repeats" strategy
// that needs to write would add its own strategy with its own
// confirm hook.
var allowedTools = []string{
	"retrieve_charge_curve_chunks",
	"query_charge_curve_features",
}

// Strategy is the concrete strategy.Strategy implementation for the
// charging-curve-fingerprint-clustering surface. Construct via [New];
// the zero value is intentionally non-functional so a forgotten
// constructor surfaces as a runtime nil dereference rather than
// silently using empty defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs —
// the strategy is a pure value with no internal state — so this is
// effectively a sentinel constructor used to make wiring intent
// readable at the call site.
func New() *Strategy {
	return &Strategy{}
}

// FeatureID implements [strategy.Strategy]. Returns the canonical
// registry key.
func (s *Strategy) FeatureID() string { return FeatureID }

// System implements [strategy.Strategy]. Returns the deterministic
// system prompt.
func (s *Strategy) System() string { return SystemPrompt }

// Tools implements [strategy.Strategy]. Returns a defensive copy of
// the allowed tool names so a caller cannot mutate the package-level
// allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds the
// conversation from StrategyInput.LastMessage / History, and the AI
// handler builds the synthesised "narrate vehicle N's charging-curve
// clusters" prompt before the call, so the strategy itself
// contributes no extra prefix messages. Returning nil is correct.
//
// Future work: this is where a per-vehicle "preferred cluster
// granularity" preference snippet would be injected once
// charging-curve-fingerprint-clustering grows that surface. Today's
// slice keeps Context empty so the dispatcher's behaviour is fully
// determined by [System] + History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyChargingCurveFingerprintClustering wrapped through the F4↔F8
// adapter so the dispatcher's per-request ctx-installation step
// (dispatch.Run installs the policy via redact.WithPolicy) sees the
// concrete policy.
//
// Per the slice prompt: "Allowed classes: ClassVehicleName only;
// charging location remains tagged. Round-trip required: yes".
// PolicyChargingCurveFingerprintClustering is the per-feature
// constructor with the same allow-list as PolicyDigest /
// PolicyBatteryHealthForecastNarrative — kept as a distinct
// identifier so a future per-feature change to
// charging-curve-fingerprint-clustering's allow-list does not bleed
// across the other read-only narrators.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChargingCurveFingerprintClustering())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from
// `internal/ai/strategies/charging-curve-fingerprint-clustering/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
