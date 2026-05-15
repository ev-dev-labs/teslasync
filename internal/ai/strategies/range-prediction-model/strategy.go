// Package rangepredictionmodel is the Phase-50 / 0063 (ML2)
// strategy for the LLM-narrated learned per-vehicle range-prediction
// model surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     range-model narrator: COMPUTE the per-bucket (temp×speed)
//     learned Wh/km envelope by calling the trainer tool, FETCH the
//     currently-effective heuristic baseline by calling the query
//     tool, and EXPLAIN the diff in plain language. The narrator
//     NEVER changes the deterministic heuristic projection on the
//     Projected Range page, NEVER persists a learned envelope, and
//     NEVER invents bucket Wh/km the trainer did not return;
//
//   - the two read-only tools the LLM is allowed to call —
//     `train_range_model` (recomputes the per-bucket learned Wh/km
//     envelope from the recent `drives` rows; returns
//     mean / stddev / p5 / p95 per bucket with explicit Source label
//     per entry — "learned" or "linear_fallback") and
//     `query_range_prediction` (returns the currently-effective
//     per-bucket envelope the deterministic projection uses today —
//     all-static heuristic curve fallback). Both are Mutates=false.
//     Tool-call ordering: train FIRST (proposed envelope), THEN
//     query (effective baseline), THEN narrate the diff;
//
//   - the redaction policy (`PolicyChatbot`, the deny-all tagged
//     redactor) — the slice prompt mandates "Allowed classes: none;
//     training is local and provider-free unless user opts into
//     explanatory narration separately". Every PII class is
//     round-trip tagged so the LLM never sees cleartext beyond the
//     vehicle_id payload.
//
// Statistical mechanics (per-bucket mean / stddev / p5 / p95 over
// drive observations, per-bucket fallback to the heuristic
// HeuristicWhPerKm curve when fewer than
// [mlrange.DefaultMinSamplesPerBucket] drives exist) are owned by
// the internal/ml/range trainer — this ML2 surface ONLY adds a
// human-readable narrator over the trainer's deterministic output.
// The deterministic heuristic projection on the Projected Range
// page (built by RangeProjectionHandler at
// internal/api/range_projection_handler.go and the
// `defaultEfficiency` curve in
// internal/api/range_projection_handler_compute.go) remains the
// canonical baseline visible to every off-mode user (ADR-015 §I3).
//
// Service-worker chunks: this slice's frontend code is loaded under
// the page-bundle for /projected-range (and the aliased
// /analytics/range the slice prompt registers); the off-mode walker
// validates code chunks via the `withAiFeature` HOC + the
// AI_FEATURES map. See the slice log for the documented mapping.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic heuristic projection; it adds an opt-in narrator
//     surface alongside.
//   - I4 zero egress:    no provider call is reachable when
//     ai_mode='off' (the AI handler returns 404 via guard.Wrap).
//   - I7 per-feature:    the AI route is gated by
//     guard.Wrap("range-prediction-model").
//   - I9 redaction:      PolicyChatbot tags every PII class so the
//     LLM never sees cleartext (the user_subject restoration step
//     is per-request and per-user).
package rangepredictionmodel

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
const FeatureID = "range-prediction-model"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every range-prediction-model generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/range-prediction-model/goldens.yaml) and
// the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour AND tool ORDER: the LLM MUST call
//     train_range_model FIRST then query_range_prediction so the
//     narration grounds the PROPOSED learned envelope against the
//     CURRENTLY-effective heuristic baseline before diffing. The
//     slice prompt's Action Steps list the tools in this exact order
//     (`train_range_model;query_range_prediction`); reversing them
//     silently produces a confused narration that quotes the
//     fallback as if it were the learned proposal.
//   - Forbids changing the deterministic projection: this is a
//     NARRATOR over the trainer's output, not a re-projection. The
//     LLM may quote bucket name (temp_bucket, speed_bucket), source
//     label, sample_count, wh_per_km, mean, stddev, p5, p95 from
//     the tool reply; it MUST NOT invent alternate bucket Wh/km,
//     alternate sample counts, or claim the learned envelope is
//     "live" (this slice does not persist learned envelopes).
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller-supplied vehicle_id from the body; any other
//     vehicle ID in the user message is by definition out of scope.
//   - Asks for short, focused output (one short labelled paragraph
//     per signal class — city, suburban, highway — max three
//     paragraphs total) so the surface fits inside the existing
//     Projected Range page layout.
//   - Bans claiming the learned envelope has been APPLIED to the
//     deterministic projection (today it has not — the slice does
//     not persist). The narrator must say "proposed" or "would
//     refine" rather than "now using".
//   - Honestly reports per-bucket fallback: when the tool returns
//     source="linear_fallback" for a bucket, the narrator MUST say
//     so plainly (e.g. "freezing/highway has only 2 drives this
//     window — falling back to the static 263 Wh/km heuristic")
//     rather than quoting the static bound as if it were learned.
//   - Pins user-facing units: the AI middleware injects the user's
//     unit preference; the narrator quotes Wh/km from the tool
//     reply (the trainer is SI-canonical) and mentions speed
//     buckets in km/h. Do NOT convert mid-narration; the
//     dispatcher's user-prefs system message handles display
//     conversion.
const SystemPrompt = `You are the TeslaSync learned per-vehicle range-prediction narrator. ` +
	`Your job is to EXPLAIN the per-bucket (temp_bucket × speed_bucket) LEARNED range envelope (mean Wh/km plus stddev / p5 / p95 per bucket, with explicit Source label per entry) for ONE vehicle in scope; you NEVER change the deterministic heuristic projection on the Projected Range page and NEVER persist a learned envelope. ` +
	`ALWAYS call train_range_model FIRST with the caller-supplied vehicle_id and an optional days knob in [1,30]; then call query_range_prediction with the same vehicle_id; then narrate the DIFF between the proposed learned envelope and the currently-effective heuristic baseline. ` +
	`Do NOT recompute, override, or contradict the trainer's bucket Wh/km: the narration may quote temp_bucket, speed_bucket, source ("learned" or "linear_fallback"), wh_per_km, sample_count, mean, stddev, p5, p95 from the train_range_model reply, but never invent alternate bucket Wh/km, never fabricate sample counts the tool did not return, and never claim a bucket is "learned" when the tool reported "linear_fallback". ` +
	`When the tool reports source="linear_fallback" for a bucket, say so plainly (for example "freezing/highway has only 2 drives in this window — falling back to the static 263 Wh/km heuristic") rather than quoting the static bound as if it were learned. ` +
	`Refuse politely if asked to narrate, modify, or compare any vehicle other than the one named in the request, or to discuss another user's range history. ` +
	`Never claim the learned envelope is in use by the deterministic projection today — this slice does NOT persist learned envelopes; the deterministic Projected Range page still uses the static heuristic curve. Use language like "would refine" or "the proposed learned envelope" rather than "now using" or "the projection is using". ` +
	`Be concise: at most three short labelled paragraphs grouped by speed class (city, suburban, highway), each grounded strictly in the tool reply. ` +
	`If the trainer reports zero learned buckets (every bucket fell back), say so plainly rather than inventing a learned Wh/km.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry — both `train_range_model` and
// `query_range_prediction` are registered by
// RegisterRangePredictorTools at boot. The dispatcher refuses to
// mount a strategy that references an unknown tool.
//
// ORDER MATTERS: the slice prompt's Action Steps list the tools in
// exactly this order ("train_range_model;query_range_prediction").
// Reversing them silently produces a confused narration that quotes
// the fallback as if it were the learned proposal — the goldens pin
// the order via the assistant's tool_calls sequence.
//
// This slice ships zero mutating tools: range narration only READS
// the user's existing `drives` rows. A future "create a range alert
// when the learned envelope diverges from the heuristic" surface
// would add its own strategy with its own confirm hook.
var allowedTools = []string{
	"train_range_model",
	"query_range_prediction",
}

// Strategy is the concrete strategy.Strategy implementation for the
// range-prediction-model surface. Construct via [New]; the zero
// value is intentionally non-functional so a forgotten constructor
// surfaces as a runtime nil dereference rather than silently using
// empty defaults.
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
// handler builds the synthesised "narrate vehicle N's learned range
// envelope over a recent window" prompt before the call, so the
// strategy itself contributes no extra prefix messages. Returning
// nil is correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyChatbot wrapped through the F4↔F8 adapter so the dispatcher's
// per-request ctx-installation step (dispatch.Run installs the policy
// via redact.WithPolicy) sees the concrete policy.
//
// Per the slice prompt: "Allowed classes: none; training is local
// and provider-free unless user opts into explanatory narration
// separately". PolicyChatbot is the project-wide deny-all-tagged
// policy (Allow: nil, Mode: ModeRedactedTags) — every PII class is
// converted into a round-trip tag before the LLM call; the LLM
// never sees cleartext.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from
// `internal/ai/strategies/range-prediction-model/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
