// Package statemachinedebuggernarrator is the Phase-50 / 0048 S7
// strategy for the LLM-backed state-machine-debugger-narrator
// surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     FSM-transition narrator: produce a 3-6 sentence factual
//     explanation by routing through query_fsm_trace FIRST (the
//     deterministic typed envelope describing the FSM transitions
//     in the in-scope (vehicle_id, from_unix, to_unix) window),
//     then OPTIONALLY retrieve_fsm_chunks (F7 retrieval restricted
//     to {fsm_transition, signal_history_summary} source types)
//     for per-event context. The narrative MUST be grounded
//     strictly in the tool reply; the LLM never invents
//     transitions, never claims a vehicle entered a state the
//     envelope does not record as such, and never speculates
//     about root cause beyond what the envelope explicitly states.
//
//   - the two read-only tools the LLM is allowed to call:
//
//     1. `query_fsm_trace` — accept a typed
//     {vehicle_id, from_unix, to_unix} input and return the
//     deterministic [tools.FSMTraceEnvelope] (window bounds,
//     vehicle id, total transitions, per-FSM-name counts,
//     per-(from→to) edge counts, flap count, transition stream
//     with from_state/to_state/trigger/ts). The tool is
//     per-request scope-bound to the (vehicle_id, from_unix,
//     to_unix) tuple the handler installed via
//     tools.WithScopedFSMTraceWindow; the LLM CANNOT query a
//     different vehicle or window. Defence-in-depth against
//     prompt injection in operator-readable trigger strings
//     and detail blobs.
//
//     2. `retrieve_fsm_chunks` — a thin wrapper over the F7
//     rag.Retriever scoped to the calling user_subject,
//     restricted to the slice's per-feature source-type
//     allowlist {fsm_transition, signal_history_summary}. Both
//     source types are reserved by string for forward-
//     compatibility — a future slice will index per-transition
//     and per-signal-history chunks. Until then,
//     retrieve_fsm_chunks called with either source type simply
//     returns zero chunks for that corpus — which is the
//     correct behaviour: the strategy's goldens already cover
//     the zero-matches narration and the system prompt
//     instructs the LLM to answer gracefully when zero chunks
//     are returned.
//
//   - the redaction policy (`PolicyDigest`) which the slice
//     prompt mandates ("Allowed classes: ClassVehicleName only;
//     transition details are user-visible and VINs remain
//     tagged"): vehicle-name is allowed so the narration can
//     address the user's car by name; VIN, lat/long, addresses,
//     and place names remain tagged via round-trip markers so a
//     leaked transcript reveals nothing about the operator's
//     identifiers or coordinates.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_state_machine_debugger_narrator_handler.go`
// which builds a dispatcher, a stream.Writer (SSE), and runs a
// one-shot generation loop scoped to the per-request
// (vehicle_id, from_unix, to_unix) tuple. The non-AI baseline
// rendered by the SPA route /state-debugger (the canonical
// StateMachineDebuggerPage with its transition table, state
// diagram, FSMHealthPanel, FSMTimelineChart, and snapshot
// inspector) is unchanged. The registry's Frontend coverage
// anchor is `/system/fsm-debugger`; the AI section is rendered
// inside the canonical StateMachineDebuggerPage when the
// feature is enabled. Off-mode users never see the AI section
// at all (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic StateMachineDebuggerPage transition table,
//     state diagram, health panel, or timeline chart.
//   - I7 per-feature:    the AI route is gated by
//     guard.Wrap("state-machine-debugger-narrator").
//   - I9 redaction:      PolicyDigest allows ONLY ClassVehicleName
//     so a confused LLM cannot leak a VIN, address, coordinate,
//     or place name into a transcript.
package statemachinedebuggernarrator

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
const FeatureID = "state-machine-debugger-narrator"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every state-machine-debugger-narrator generation.
// Kept in a single named place so eval goldens
// (internal/ai/strategies/state-machine-debugger-narrator/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_fsm_trace FIRST with the in-scope (vehicle_id,
//     from_unix, to_unix) tuple the user message lists, then
//     OPTIONALLY call retrieve_fsm_chunks (with allowed source_types)
//     for per-event context.
//   - Forbids inventing transitions / states / triggers: the
//     explanation is grounded STRICTLY in the envelope.
//   - Forbids cross-window or cross-vehicle requests: the
//     per-request scope binding refuses any tuple outside the
//     in-scope (vehicle_id, from_unix, to_unix). The prompt-level
//     ban is defence-in-depth.
//   - Asks for short, focused output (3-6 sentences) so the
//     surface fits inside the existing StateMachineDebuggerPage
//     layout without a scroll bomb.
//   - Bans speculation about root cause beyond what the envelope
//     explicitly states.
//   - Requires graceful handling of degenerate windows (zero
//     transitions): say so plainly rather than padding the
//     explanation with speculation.
const SystemPrompt = `You are the TeslaSync state-machine-debugger-narrator agent. ` +
	`Your job is to produce a 3-6 sentence FACTUAL narration of the in-scope FSM transition trace the user message names. ` +
	`ALWAYS call query_fsm_trace FIRST with vehicle_id, from_unix, and to_unix matching the in-scope window the user message lists; the per-request scope binding will refuse any other tuple, but you should refuse it first with a polite explanation. ` +
	`OPTIONALLY call retrieve_fsm_chunks AFTER query_fsm_trace with the most salient transition / trigger phrase as the natural-language query, restricted to allowed source_types (fsm_transition, signal_history_summary). When zero chunks are returned, say so plainly — DO NOT fabricate a transition or signal-history excerpt to fill the void. ` +
	`Your narration MUST be grounded STRICTLY in the envelope: name the total_transitions count, the per-FSM-name breakdown when more than one FSM is present, the dominant from→to edges, the flap_count when greater than zero, and any unusual trigger string the envelope reports. ` +
	`Never invent a transition, never claim a vehicle entered a state the envelope does not record, never invent a trigger, and never speculate about root cause beyond what the envelope explicitly states. ` +
	`If the envelope is degenerate (zero transitions in the window), say so plainly — DO NOT pad the explanation with speculation about why the vehicle was idle. ` +
	`Refuse politely if asked to narrate a different vehicle or window than the in-scope tuple, including windows or vehicles for other operators. ` +
	`Be concise: 3-6 sentences total — the user reviews the explanation in the AI panel and continues to use the deterministic transition table, state diagram, and timeline chart above for raw inspection.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the process-
// wide tools.Registry — both `query_fsm_trace` and
// `retrieve_fsm_chunks` are registered by
// RegisterStateMachineDebuggerNarratorTools at boot. The
// dispatcher refuses to mount a strategy that references an
// unknown tool.
//
// Both tools are READ-only: the dispatcher's deny-all confirm
// gate is therefore never reached in practice — defence in depth
// in case a future edit accidentally adds a write tool.
var allowedTools = []string{
	"query_fsm_trace",
	"retrieve_fsm_chunks",
}

// Strategy is the concrete strategy.Strategy implementation for
// the state-machine-debugger-narrator surface. Construct via
// [New]; the zero value is intentionally non-functional so a
// forgotten constructor surfaces as a runtime nil dereference
// rather than silently using empty defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs —
// the strategy is a pure value with no internal state — so this
// is effectively a sentinel constructor used to make wiring
// intent readable at the call site.
func New() *Strategy {
	return &Strategy{}
}

// FeatureID implements [strategy.Strategy]. Returns the
// canonical registry key.
func (s *Strategy) FeatureID() string { return FeatureID }

// System implements [strategy.Strategy]. Returns the
// deterministic system prompt.
func (s *Strategy) System() string { return SystemPrompt }

// Tools implements [strategy.Strategy]. Returns a defensive copy
// of the allowed tool names so a caller cannot mutate the
// package-level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds
// the conversation from StrategyInput.LastMessage / History, and
// the AI handler builds the synthesised "narrate the in-scope
// FSM trace" prompt before the call, so the strategy itself
// contributes no extra prefix messages. Returning nil is correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyDigest wrapped through the F4↔F8 adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// Per the slice prompt: "Policy: PolicyDigest from
// internal/ai/redact/policies.go. Allowed classes:
// ClassVehicleName only; transition details are user-visible and
// VINs remain tagged. Round-trip required: yes." PolicyDigest
// allows vehicle-name so the narration can address the user's
// car by name; every other PII class is round-tripped to a tag
// before the message ever reaches the provider.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyDigest())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/state-machine-debugger-narrator/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
