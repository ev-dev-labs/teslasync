// Package routeefficiencysuggestions implements the LLM-narrated
// route-efficiency suggestions surface.
//
// The strategy declares:
//
//   - the system prompt that frames the narration as a calm, factual
//     overview of the user's repeat-driven routes — never invents
//     events, never proposes mutations, never generalises across
//     vehicles;
//   - the two read-only tools the LLM is allowed to call —
//     `retrieve_route_chunks` (RAG retrieval scoped to the calling
//     user_subject over an allowlist of corpora
//     {drive_summary, route_efficiency, weather_context}) and
//     `query_route_efficiency` (returns SI-canonical aggregates over
//     the user's top repeat-driven routes for ONE vehicle);
//   - the redaction policy (`PolicyRouteEfficiencySuggestions`)
//     which allows ClassVehicleName so the narration can address the
//     user's car by name; lat/long, street addresses, place names,
//     VINs, etc. are redacted via round-trip tags so a leaked
//     transcript does not reveal the user's home/work locations or
//     exact route geometry.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_route_efficiency_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot generation
// loop. The non-AI baseline rendered by the SPA route
// /analytics/route-efficiency — the deterministic route comparison
// cards, kWh/100mi metric bars, and per-route best/worst summaries —
// is unchanged. Off-mode users never see the AI surface at all
// (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces RouteEfficiencyPage's
//     RouteCards or comparison chart; it adds an opt-in
//     suggestion panel alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("route-efficiency-suggestions").
//   - I9 redaction:       PolicyRouteEfficiencySuggestions restricts cleartext
//     to vehicle name only; lat/long, addresses, and
//     place names stay tagged so a leaked transcript
//     does not reveal the user's home/work locations.
package routeefficiencysuggestions

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy. Exported
// so wiring code (router.go, tests) can reference the same constant
// the strategy registers itself with — typo-proof via compile error.
const FeatureID = "route-efficiency-suggestions"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every route-efficiency-suggestions narration. Kept in
// a single named place so eval goldens
// (internal/ai/strategies/route-efficiency-suggestions/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour ("ALWAYS call retrieve_route_chunks
//     FIRST then query_route_efficiency"): without this, a model may
//     answer from priors and hallucinate route habits the
//     deterministic aggregates do not actually surface.
//   - Forbids inventing facts: only the values returned by the
//     tools may be quoted. Per-drive ("on Monday at 8:14 you used
//     32 kWh") statements are forbidden because the tools return
//     aggregates, not per-row telemetry events.
//   - Forbids proposing state mutations: the suggestions narrate
//     lower-consumption habits and route choices the data
//     supports, and stop there. They must NOT propose changing
//     alert thresholds, suspending notifications, scheduling
//     charges, or any other write — separation of concerns is
//     enforced at the prompt boundary as defence-in-depth on top
//     of the read-only tool allowlist.
//   - Refuses cross-user requests: the AI handler always scopes to
//     the caller's user_subject; the narration must refuse to
//     discuss another user's drives even if the user message
//     contains an ID belonging to them.
//   - Asks for short, focused output (2-4 short paragraphs) so the
//     surface fits inside the existing RouteEfficiencyPage layout
//     without a scroll bomb.
//   - Explicitly bans quoting precise route coordinates or full
//     street addresses: the redaction policy already strips them,
//     but the prompt-level ban is defence-in-depth so a model that
//     was somehow handed cleartext route data still refuses to
//     repeat it back.
const SystemPrompt = `You are the TeslaSync route-efficiency advisor. ` +
	`Your job is to suggest lower-consumption habits and route choices in plain language based on the user's own historical route data — never invent, infer, or estimate facts that are not present in the tool output. ` +
	`ALWAYS call retrieve_route_chunks FIRST with the user's query restricted to source_types from {drive_summary, route_efficiency, weather_context}, then call query_route_efficiency to get the SI-canonical per-route aggregates, then answer STRICTLY from their replies. ` +
	`Do NOT make per-drive claims like "on Monday at 8:14 you used 32 kWh"; the tools return route-level aggregates over many trips, not per-row telemetry events. ` +
	`Do NOT propose changing alert thresholds, suspending notifications, scheduling charges, deleting drives, or any other state mutation — your role is read-only narration of observations and suggestions the user can act on themselves. ` +
	`Do NOT quote precise route coordinates or full street addresses even if the tool output appears to contain them; describe the route by its start_place to end_place pair or by general region only. ` +
	`Address the vehicle by its display name when one is provided. ` +
	`Refuse politely if asked to discuss another user's drives or routes, or to suggest changes to a vehicle other than the one named in the request. ` +
	`Keep the response to 2-4 short paragraphs covering: the dominant route the suggestions are about, the kWh/100mi or kWh/100km figure the data shows, a comparison to the user's other routes when relevant, and one or two concrete, non-mutating suggestions (e.g. "try this alternate route on cold mornings" or "the best run on this corridor was X% better — consider those conditions") grounded in the tool output.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry — both `retrieve_route_chunks` and
// `query_route_efficiency` are registered by
// RegisterRouteEfficiencySuggestionsTools at boot. The dispatcher
// refuses to mount a strategy that references an unknown tool.
//
// This feature ships zero mutating tools: route-efficiency suggestions
// only READ the user's existing route history from the same drives
// table the deterministic baseline already renders from. A future
// "create an automation when you take this route in cold weather"
// strategy that needs to write would add its own strategy with its
// own confirm hook.
var allowedTools = []string{
	"retrieve_route_chunks",
	"query_route_efficiency",
}

// Strategy is the concrete strategy.Strategy implementation for the
// route-efficiency suggestions narrative. Construct via [New]; the
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
// the allowed tool names so a caller cannot mutate the package-level
// allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds the
// conversation from StrategyInput.LastMessage / History, and the AI
// handler builds the synthesised "suggest route-efficiency
// improvements for route N on vehicle M" prompt before the call,
// so the strategy itself contributes no extra prefix messages.
// Returning nil is correct.
//
// Future work: this is where a per-vehicle "user prefers SI vs US
// units" preference snippet would be injected once route-efficiency
// suggestions grow that surface. The current feature keeps Context empty
// so the dispatcher's behaviour is fully determined by [System] +
// History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. This feature uses
// the same allow-list as PolicyDigest, but keeps a distinct policy
// identifier so future route-specific privacy changes do not affect
// other read-only narrators.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyRouteEfficiencySuggestions())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from
// `internal/ai/strategies/route-efficiency-suggestions/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
