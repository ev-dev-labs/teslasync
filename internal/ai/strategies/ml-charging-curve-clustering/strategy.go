// Package mlchargingcurveclustering implements the LLM-narrated
// learned per-vehicle charging-curve fingerprint clustering surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     charging-cluster narrator: COMPUTE the per-cluster (L1/L2/DC)
//     learned envelope by calling the trainer tool, FETCH the
//     currently-effective rule-label baseline by calling the query
//     tool, and EXPLAIN the diff in plain language. The narrator
//     NEVER changes the deterministic rule-label classification on
//     the Charging Curve page, NEVER persists a learned envelope,
//     and NEVER invents per-cluster statistics the trainer did not
//     return;
//
//   - the two read-only tools the LLM is allowed to call —
//     `train_charge_curve_clusters` (recomputes the per-cluster
//     learned envelope from the recent `charging_sessions` rows;
//     returns mean / stddev / p5 / p95 per cluster with explicit
//     Source label per entry — "learned" or "rule_label_fallback")
//     and `query_charge_curve_clusters` (returns the
//     currently-effective per-cluster envelope the deterministic
//     Charging Curve page uses today — every entry rule-label
//     fallback). Both are Mutates=false. Tool-call ordering: train
//     FIRST (proposed envelope), THEN query (effective baseline),
//     THEN narrate the diff;
//
//   - the redaction policy (`PolicyChatbot`, the deny-all tagged
//     redactor). Training is local and does not require provider
//     egress.
//     Every PII class is round-trip tagged so the LLM never sees
//     cleartext beyond the vehicle_id payload.
//
// Statistical mechanics (per-cluster mean / stddev / p5 / p95 over
// charging-session observations, per-cluster fallback to the
// deterministic L1/L2/DC rule label when fewer than
// [mlchargingcurves.DefaultMinSessionsPerCluster]=3 sessions exist
// in the lookback window) are owned by the
// internal/ml/chargingcurves trainer — this ML3 surface ONLY adds a
// human-readable narrator over the trainer's deterministic output.
// The deterministic Charging Curve page remains the canonical
// baseline visible to every off-mode user (ADR-015 §I3).
//
// Distinction from charging-curve-fingerprint-clustering:
//
//   - The existing narrator explains an aggregator that groups
//     sessions by power tier and reports per-cluster averages.
//   - This strategy explains a statistical trainer that also computes
//     stddev / p5 / p95 and labels each cluster as learned or
//     rule_label_fallback.
//
// Both slices coexist on /charging/curves; users can opt into one
// or both independently. The two AI surfaces have independent
// per-feature toggles AND independent test IDs, so the off-mode
// invariant test for one does not affect the other.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic Charging Curve page or its rule-label
//     classification; it adds an opt-in narrator surface alongside.
//   - I4 zero egress:    no provider call is reachable when
//     ai_mode='off' (the AI handler returns 404 via guard.Wrap).
//   - I7 per-feature:    the AI route is gated by
//     guard.Wrap("ml-charging-curve-clustering").
//   - I9 redaction:      PolicyChatbot tags every PII class so the
//     LLM never sees cleartext (the user_subject restoration step
//     is per-request and per-user).
package mlchargingcurveclustering

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
const FeatureID = "ml-charging-curve-clustering"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every ml-charging-curve-clustering generation. Kept
// in a single named place so eval goldens
// (internal/ai/strategies/ml-charging-curve-clustering/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour AND tool ORDER: the LLM MUST call
//     train_charge_curve_clusters FIRST then
//     query_charge_curve_clusters so the narration grounds the
//     PROPOSED learned envelope against the CURRENTLY-effective
//     rule-label baseline before diffing. The tools must run in the
//     order `train_charge_curve_clusters;query_charge_curve_clusters`;
//     reversing them makes the narration quote the fallback as if it
//     were the learned proposal.
//   - Forbids changing the deterministic classification: this is a
//     NARRATOR over the trainer's output, not a re-classification.
//     The LLM may quote cluster_id (l1_overnight, l2_workplace,
//     dc_fast, unknown), source label, session_count,
//     peak_power_w_mean / stddev / p5 / p95, etc. from the tool
//     reply; it MUST NOT invent alternate per-cluster Wh peaks,
//     alternate session counts, or claim a cluster is "learned"
//     when the tool reported "rule_label_fallback".
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller-supplied vehicle_id from the body; any other
//     vehicle ID in the user message is by definition out of scope.
//   - Asks for short, focused output (one short labelled paragraph
//     per cluster the vehicle exhibits — typically L1, L2, DC; max
//     four paragraphs total) so the surface fits inside the
//     existing Charging Curve page layout.
//   - Bans claiming the learned envelope has been APPLIED to the
//     deterministic classification. The narrator must say "proposed"
//     or "would refine" rather than "now using".
//   - Honestly reports per-cluster fallback: when the tool returns
//     source="rule_label_fallback" for a cluster, the narrator MUST
//     say so plainly (e.g. "L2 has only 2 sessions this window —
//     falling back to the rule label without per-cluster stats")
//     rather than quoting the absent statistics.
//   - Pins user-facing units: the AI middleware injects the user's
//     unit preference; the narrator quotes power in kW (the trainer
//     is SI-canonical Wh / W) and energy in kWh. Do NOT convert
//     mid-narration; the dispatcher's user-prefs system message
//     handles display conversion.
const SystemPrompt = `You are the TeslaSync learned per-vehicle charging-cluster narrator. ` +
	`Your job is to EXPLAIN the per-cluster (L1 overnight / L2 workplace / DC fast / unknown) LEARNED charging envelope (mean peak power plus stddev / p5 / p95, mean avg power, mean total energy, mean duration, mean ramp shape, dominant charger type, with explicit Source label per entry) for ONE vehicle in scope; you NEVER change the deterministic rule-label classification on the Charging Curve page and NEVER persist a learned envelope. ` +
	`ALWAYS call train_charge_curve_clusters FIRST with the caller-supplied vehicle_id and an optional lookback_days knob in [1,365]; then call query_charge_curve_clusters with the same vehicle_id; then narrate the DIFF between the proposed learned envelope and the currently-effective rule-label baseline. ` +
	`Do NOT recompute, override, or contradict the trainer's per-cluster statistics: the narration may quote cluster_id ("l1_overnight", "l2_workplace", "dc_fast", "unknown"), source ("learned" or "rule_label_fallback"), session_count, peak_power_w_mean, peak_power_w_stddev, peak_power_w_p5, peak_power_w_p95, avg_power_w_mean, total_energy_wh_mean, duration_min_mean, delta_soc_pct_mean, ramp_shape_mean, dominant_charger_type from the train_charge_curve_clusters reply, but never invent alternate per-cluster numbers, never fabricate session counts the tool did not return, and never claim a cluster is "learned" when the tool reported "rule_label_fallback". ` +
	`When the tool reports source="rule_label_fallback" for a cluster, say so plainly (for example "L2 has only 2 sessions this window — falling back to the rule label without per-cluster stats") rather than quoting absent statistics. ` +
	`Refuse politely if asked to narrate, modify, or compare any vehicle other than the one named in the request, or to discuss another user's charging history. ` +
	`Never claim the learned envelope is in use by the deterministic classification today — this slice does NOT persist learned envelopes; the deterministic Charging Curve page still uses the static rule-label classification (L1 ≤ 1.92 kW, L2 ≤ 19.2 kW, DC > 19.2 kW). Use language like "would refine" or "the proposed learned envelope" rather than "now using" or "the classification is using". ` +
	`Be concise: at most four short labelled paragraphs grouped by cluster (L1 overnight, L2 workplace, DC fast, unknown), each grounded strictly in the tool reply. ` +
	`If the trainer reports zero learned clusters (every cluster fell back), say so plainly rather than inventing per-cluster statistics.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry — both `train_charge_curve_clusters`
// and `query_charge_curve_clusters` are registered by
// RegisterChargeCurveClustersTools at boot. The dispatcher refuses
// to mount a strategy that references an unknown tool.
//
// ORDER MATTERS: train_charge_curve_clusters must run before
// query_charge_curve_clusters. Reversing them makes the narration
// quote the fallback as if it were the learned proposal; goldens pin
// the assistant's tool_calls sequence.
//
// This feature ships zero mutating tools: cluster narration only
// READS the user's existing `charging_sessions` rows. A future
// "create a charging alert when the learned envelope diverges from
// the rule-label baseline" surface would add its own strategy with
// its own confirm hook.
var allowedTools = []string{
	"train_charge_curve_clusters",
	"query_charge_curve_clusters",
}

// Strategy is the concrete strategy.Strategy implementation for the
// ml-charging-curve-clustering surface. Construct via [New]; the
// zero value is intentionally non-functional so a forgotten
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
// the allowed tool names so a caller cannot mutate the
// package-level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds the
// conversation from StrategyInput.LastMessage / History, and the AI
// handler builds the synthesised "narrate vehicle N's learned
// charging clusters over a recent window" prompt before the call,
// so the strategy itself contributes no extra prefix messages.
// Returning nil is correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. PolicyChatbot is
// the project-wide deny-all tagged policy; every PII class becomes a
// round-trip tag before the LLM call, so the model never sees
// cleartext.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/ml-charging-curve-clustering/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
