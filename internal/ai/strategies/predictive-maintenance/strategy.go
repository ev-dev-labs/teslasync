// Package predictivemaintenance defines the LLM-backed predictive-maintenance strategy.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     maintenance risk narrator: produce a 3-6 sentence factual
//     advisory by routing through query_maintenance_context FIRST
//     (the deterministic typed envelope describing the in-scope
//     vehicle's maintenance items, recent service records, and
//     summary counts), then OPTIONALLY retrieve_maintenance_chunks
//     (F7 retrieval restricted to {maintenance_event,
//     vehicle_state, ml_anomaly} source types) for per-event
//     context. The advisory MUST be grounded strictly in the tool
//     reply; the LLM never invents items, never claims an item is
//     overdue when the envelope reports it healthy, and never
//     speculates about root cause beyond what the envelope
//     explicitly states.
//
//   - the two read-only tools the LLM is allowed to call:
//
//     1. `query_maintenance_context` — accept a typed
//     {vehicle_id} input and return the deterministic
//     [maintenance.MaintenancePredictionContextEnvelope] (vehicle id,
//     current_mileage, items with derived status/due dates/due
//     mileage/intervals, recent service records, and a summary
//     count breakdown). The tool is per-request scope-bound to
//     the vehicle_id the handler installed via
//     maintenance.WithScopedMaintenancePredictionWindow; the LLM
//     CANNOT query a different vehicle. Defence-in-depth
//     against prompt injection in operator-authored
//     service-record description / provider strings.
//
//     2. `retrieve_maintenance_chunks` — a thin wrapper over the
//     F7 rag.Retriever scoped to the calling user_subject,
//     restricted to this feature's source-type allowlist
//     {maintenance_event, vehicle_state, ml_anomaly}.
//     All three source types are reserved by string for
//     forward-compatibility — future indexers will add
//     per-service-event, per-state-summary, and per-ML-anomaly
//     chunks. Until then, retrieve_maintenance_chunks called
//     with any of those source types simply returns zero chunks
//     for that corpus — which is the correct behaviour: the
//     strategy's goldens already cover the zero-matches
//     narration and the system prompt instructs the LLM to
//     answer gracefully when zero chunks are returned.
//
//   - the redaction policy (`PolicyDigest`): vehicle-name is
//     allowed so the narration can
//     address the user's car by name; VIN, lat/long, addresses,
//     place names, IPs, emails, phone numbers, and MAC addresses
//     remain tagged via round-trip markers so a leaked
//     transcript reveals nothing about the operator's
//     identifiers or coordinates.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_predictive_maintenance_handler.go` which
// builds a dispatcher, a stream.Writer (SSE), and runs a
// one-shot generation loop scoped to the per-request vehicle_id.
// The non-AI baseline rendered by the SPA route /maintenance
// (the canonical MaintenancePage with its items grid, summary
// cards, service records table, and due-soon / overdue badges)
// is unchanged. Off-mode users never see the AI section at all
// (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic MaintenancePage items grid, summary cards,
//     service records table, or due-soon / overdue badges.
//   - I7 per-feature:    the AI route is gated by
//     guard.Wrap("predictive-maintenance").
//   - I9 redaction:      PolicyDigest allows ONLY ClassVehicleName
//     so a confused LLM cannot leak a VIN, address, coordinate,
//     or place name into a transcript.
package predictivemaintenance

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy.
// Exported so wiring code (router.go, the AI HTTP handler, tests)
// can reference the same constant the strategy registers itself
// with — typo-proof via compile error.
const FeatureID = "predictive-maintenance"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every predictive-maintenance generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/predictive-maintenance/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_maintenance_context FIRST with the in-scope
//     vehicle_id the user message lists, then OPTIONALLY call
//     retrieve_maintenance_chunks (with allowed source_types)
//     for per-event context.
//   - Forbids inventing items / overdue states / service events:
//     the advisory is grounded STRICTLY in the envelope.
//   - Forbids cross-vehicle requests: the per-request scope
//     binding refuses any vehicle outside the in-scope one. The
//     prompt-level ban is defence-in-depth.
//   - Asks for short, focused output (3-6 sentences) so the
//     surface fits inside the existing MaintenancePage layout
//     without a scroll bomb.
//   - Bans speculation about root cause beyond what the envelope
//     explicitly states.
//   - Requires graceful handling of degenerate envelopes (zero
//     items, zero records): say so plainly rather than padding
//     the advisory with speculation.
const SystemPrompt = `You are the TeslaSync predictive-maintenance agent. ` +
	`Your job is to produce a 3-6 sentence FACTUAL maintenance risk advisory for the in-scope vehicle the user message names. ` +
	`ALWAYS call query_maintenance_context FIRST with vehicle_id matching the in-scope vehicle the user message lists; the per-request scope binding will refuse any other vehicle_id, but you should refuse it first with a polite explanation. ` +
	`OPTIONALLY call retrieve_maintenance_chunks AFTER query_maintenance_context with the most salient overdue or due-soon item name as the natural-language query, restricted to allowed source_types (maintenance_event, vehicle_state, ml_anomaly). When zero chunks are returned, say so plainly — DO NOT fabricate a service-event, vehicle-state summary, or anomaly excerpt to fill the void. ` +
	`Your advisory MUST be grounded STRICTLY in the envelope: name the summary counts (total, overdue, due_soon, completed), the highest-priority overdue or due-soon items by name and category, the due_date / due_mileage values as the envelope reports them, and recent service records relevant to the at-risk items. ` +
	`Never invent a maintenance item, never claim an item is overdue when the envelope reports it healthy, never invent a service event, and never speculate about root cause beyond what the envelope explicitly states. ` +
	`If the envelope is degenerate (zero items or zero overdue / due_soon items), say so plainly — DO NOT pad the advisory with speculation about future risk. ` +
	`If current_mileage is null (the odometer is unknown), say so plainly and prefer time-based reasoning over mileage-based reasoning for that response. ` +
	`Refuse politely if asked to advise on a different vehicle than the in-scope one, including vehicles belonging to other operators. ` +
	`Be concise: 3-6 sentences total — the user reviews the advisory in the AI panel and continues to use the deterministic items grid, service records table, and summary cards above for the canonical maintenance overview.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the process-
// wide tools.Registry — both `query_maintenance_context` and
// `retrieve_maintenance_chunks` are registered by
// RegisterPredictiveMaintenanceTools at boot. The dispatcher
// refuses to mount a strategy that references an unknown tool.
//
// Both tools are READ-only: the dispatcher's deny-all confirm
// gate is therefore never reached in practice — defence in depth
// in case a future edit accidentally adds a write tool.
var allowedTools = []string{
	"query_maintenance_context",
	"retrieve_maintenance_chunks",
}

// Strategy is the concrete strategy.Strategy implementation for
// the predictive-maintenance surface. Construct via [New]; the
// zero value is intentionally non-functional so a forgotten
// constructor surfaces as a runtime nil dereference rather than
// silently using empty defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs —
// the strategy is a pure value with no internal state — so this
// is effectively a sentinel constructor used to make wiring
// intent readable at the call site.
func New() *Strategy {
	return &Strategy{}
}

// FeatureID returns the canonical registry key.
func (s *Strategy) FeatureID() string { return FeatureID }

// System returns the deterministic system prompt.
func (s *Strategy) System() string { return SystemPrompt }

// Tools returns a defensive copy of the allowed tool names so callers
// cannot mutate the package-level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context relies on the dispatcher seeding
// the conversation from StrategyInput.LastMessage / History, and
// the AI handler builds the synthesised "advise on the in-scope
// vehicle's maintenance risk" prompt before the call, so the
// strategy itself contributes no extra prefix messages.
// Returning nil is correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy returns
// PolicyDigest wrapped through the F4↔F8 adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// PolicyDigest allows vehicle-name so the advisory can address
// the user's car by name; every other PII class is
// round-tripped to a tag before the message ever reaches the
// provider.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyDigest())
}

// EvalGoldens stays nil because the eval harness
// loads goldens from
// `internal/ai/strategies/predictive-maintenance/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
