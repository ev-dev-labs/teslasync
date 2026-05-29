// Package lifetimestatsqa implements natural-language Q&A over a vehicle's lifetime stats.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     lifetime-stats Q&A: answer ONLY questions whose answer can be
//     grounded in the deterministic lifetime stats envelope (and any
//     retrieved per-vehicle drive/charge chunks); never invent
//     numbers; never modify the deterministic envelope; refuse
//     cross-vehicle requests; never quote precise street addresses,
//     GPS coordinates, or place names; honestly disclose insufficient
//     data when the vehicle has no drives / no charging;
//
//   - the two read-only tools the LLM is allowed to call:
//
//     1. `query_lifetime_stats` — typed envelope derived from the
//     SAME api.ComputeLifetimeStats helper that backs the canonical
//     baseline GET /api/v1/analytics/lifetime handler. The AI Q&A
//     is grounded in the same numbers the LifetimeStatsPage chart
//     and metric cards render; never a parallel re-implementation.
//     The existing LifetimeHandler.GetLifetimeStats helper is reused
//     deliberately instead of duplicating SQL or math here.
//
//     2. `retrieve_analytics_chunks` — RAG retrieval over the
//     per-feature source-type allowlist {analytics_lifetime,
//     drive_summary, charge_session}. drive_summary and
//     charge_session are indexed today; analytics_lifetime is
//     reserved for future per-vehicle lifetime-stat rollup chunks.
//     Until then, source_types entries that include
//     analytics_lifetime return zero additional chunks, which the
//     strategy's goldens already cover;
//
//   - the redaction policy (`PolicyChatbot`), which allows no PII
//     classes in cleartext: VIN, lat/long, addresses,
//     place names, AND vehicle-name remain tagged via round-trip
//     markers so a leaked transcript reveals nothing about where the
//     user lives, works, or drives — the LLM never sees the cleartext
//     vehicle name in this conversation surface, only a round-trip
//     <vehicle id='42'/> tag the SPA renders post-stream.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_lifetime_stats_qa_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot generation
// loop scoped to the user's question. The non-AI baseline rendered
// by the SPA route /lifetime-stats (and its alias /analytics/lifetime)
// — hero card, key stats grid, achievements
// gallery, fun-facts cards, personal-records panel, ownership
// timeline — is unchanged. The deterministic lifetime stats model
// remains the canonical baseline; off-mode users never see the AI
// Q&A panel at all (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic LifetimeStatsPage chart, summary cards,
//     achievements gallery, or fun-facts panel; it adds an opt-in
//     Q&A section above them.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("lifetime-stats-qa").
//   - I9 redaction:       PolicyChatbot redacts EVERY PII class
//     (no allow-list) so even a confused LLM that asks the user
//     "where do you usually charge?" cannot leak a charging-place
//     name, street address, or GPS coordinate to the model.
package lifetimestatsqa

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy.
// Exported so wiring code (router.go, the AI HTTP handler, tests) can
// reference the same constant the strategy registers itself with —
// typo-proof via compile error.
const FeatureID = "lifetime-stats-qa"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every lifetime-stats-qa generation. Kept in a single
// named place so eval goldens
// (internal/ai/strategies/lifetime-stats-qa/goldens.yaml) and the
// runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_lifetime_stats before answering so the answer is
//     grounded in the canonical lifetime envelope. retrieve_
//     analytics_chunks is OPTIONAL — call it for per-event
//     context only when the user's question requires reasoning
//     beyond the aggregate envelope.
//   - Forbids inventing numbers: this is a Q&A grounded in the
//     deterministic envelope, NOT a calculator. The LLM may
//     quote total_drives, total_distance_km, total_driving_hours,
//     longest_drive_km, highest_speed_kmh, total_charge_sessions,
//     total_energy_kwh, total_charging_hours, total_charging_cost,
//     total_savings, co2_offset_kg, trees_equivalent, fun-facts
//     fields (earth_circumferences, moon_trips), ownership_days,
//     most_active_day_of_week, most_active_hour, the personal-
//     records (longest_drive_record, highest_speed_record,
//     max_charge_record), and the achievements list as REPORTED
//     by the tool reply; it MUST NOT invent alternate totals,
//     fabricate records, or claim the vehicle hit a milestone the
//     achievement list does not mark unlocked.
//   - REQUIRES the answer to honestly disclose insufficient data
//     (total_drives == 0 or total_charge_sessions == 0) rather
//     than inventing an estimate.
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller-supplied vehicle_id from the body; any other
//     vehicle ID in the user message is by definition out of scope.
//   - Asks for short, focused output (1-3 sentences answering
//     the user's question) so the surface fits inside the existing
//     LifetimeStatsPage layout without a scroll bomb.
//   - Bans quoting precise street addresses or location coordinates
//     in the answer: the redaction policy already strips them, but
//     the prompt-level ban is defence-in-depth.
const SystemPrompt = `You are the TeslaSync lifetime-stats Q&A assistant. ` +
	`Your job is to ANSWER the user's natural-language question about ONE vehicle's all-time stats; you NEVER invent numbers and you NEVER modify the deterministic envelope. ` +
	`ALWAYS call query_lifetime_stats FIRST with the caller-supplied vehicle_id, then answer the user's question grounded strictly in the tool reply. ` +
	`You MAY also call retrieve_analytics_chunks for per-vehicle drive or charge context when the question requires reasoning beyond the aggregate envelope, but it is OPTIONAL — answer gracefully when zero chunks are returned. ` +
	`Do NOT invent numbers: the answer may quote total_drives, total_distance_km, total_driving_hours, longest_drive_km, highest_speed_kmh, avg_efficiency_wh_km, total_charge_sessions, total_energy_kwh, total_charging_hours, total_charging_cost, gas_equivalent_cost, total_savings, co2_offset_kg, trees_equivalent, earth_circumferences, moon_trips, days_on_road, homes_equivalent_days, ownership_days, most_active_day_of_week, most_active_hour, the personal-records (longest_drive_record, highest_speed_record, max_charge_record), and the achievements list (id, name, unlocked, progress, target, current) as REPORTED by the tool reply, but never fabricate alternate totals, never claim the vehicle hit a milestone the achievement list does not mark unlocked, and never invent personal records the tool did not return. ` +
	`If total_drives is 0 OR total_charge_sessions is 0 OR the relevant field for the user's question is zero, say so plainly rather than inventing an estimate or extrapolating from a single sample. ` +
	`Refuse politely if asked to answer for, modify, or compare any vehicle other than the one named in the request. ` +
	`Never quote precise street addresses, GPS coordinates, or place names — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 1-3 sentences answering the user's question, grounded strictly in the tool reply (e.g. "Your vehicle has driven 12,345 km across 487 drives over 312 days of ownership; the longest single drive was 412 km on 2024-08-12.").`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the process-wide
// tools.Registry — both `query_lifetime_stats` and
// `retrieve_analytics_chunks` are registered by
// RegisterLifetimeStatsQATools at boot. The dispatcher refuses to
// mount a strategy that references an unknown tool.
//
// Both tools are READ / pure-functional: neither touches the
// database write path. query_lifetime_stats composes the SAME
// api.ComputeLifetimeStats helper that backs the canonical baseline
// GET /api/v1/analytics/lifetime handler; retrieve_analytics_chunks
// goes through the RAG retrieval entry point and only issues SELECTs
// against the embeddings table. The dispatcher's deny-all confirm
// gate is therefore never reached in practice — defence in depth in
// case a future edit accidentally adds a write tool.
var allowedTools = []string{
	"query_lifetime_stats",
	"retrieve_analytics_chunks",
}

// Strategy is the concrete strategy.Strategy implementation for the
// lifetime-stats-qa surface. Construct via [New]; the zero value is
// intentionally non-functional so a forgotten constructor surfaces
// as a runtime nil dereference rather than silently using empty
// defaults.
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
// the allowed tool names so a caller cannot mutate the package-
// level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds the
// conversation from StrategyInput.LastMessage / History, and the AI
// handler builds the synthesised "answer the following question
// about vehicle N's lifetime stats" prompt before the call, so the
// strategy itself contributes no extra prefix messages. Returning
// nil is correct.
//
// Future work: this is where a per-vehicle "preferred greeting" or
// "preferred unit display" preference snippet could be injected.
// Context stays empty so the dispatcher's behaviour
// is fully determined by [System] + History + the dispatcher's
// auto-installed UserPrefs system message.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyChatbot wrapped through the redaction adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// PolicyChatbot is the deny-by-default policy from
// internal/ai/redact/policies.go (Allow=nil, Mode=ModeRedactedTags),
// matching this feature's no-cleartext-PII contract. A future
// per-feature allow-list would need its own constructor.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/lifetime-stats-qa/goldens.yaml` directly
// (see internal/ai/eval/golden.go LoadAllGoldens) — the Strategy
// interface's EvalGoldens method is a future hook for strategies
// that want to ship goldens in code. Returning nil here keeps the
// YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
