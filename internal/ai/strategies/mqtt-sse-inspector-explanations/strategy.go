// Package mqttsseinspectorexplanations is the Phase-50 / 0047 S6
// strategy for the LLM-backed mqtt-sse-inspector-explanations
// surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     stream-state explainer: produce a 3-6 sentence factual
//     explanation by routing through query_stream_inspector FIRST
//     (the deterministic typed envelope for the in-scope window),
//     then OPTIONALLY retrieve_stream_chunks (F7 retrieval
//     restricted to {mqtt_status, sse_status, job_status} source
//     types) for per-event context. The narrative MUST be grounded
//     strictly in the tool reply; the LLM never invents broker
//     events, never claims a vehicle is online the envelope does
//     not record as such, and never speculates about root cause
//     beyond what the envelope explicitly states.
//
//   - the two read-only tools the LLM is allowed to call:
//
//     1. `query_stream_inspector` — accept a typed
//     {from_unix, to_unix} input and return the deterministic
//     [diagnostic.StreamInspectorEnvelope] (window bounds, broker
//     connectivity + uptime + topic patterns, per-vehicle stream
//     stats with stale flag, SSE hub state, background-job
//     freshness). The tool is per-request scope-bound to the
//     (from_unix, to_unix) tuple the handler installed via
//     diagnostic.WithScopedStreamInspectorWindow; the LLM CANNOT
//     query a window outside that scope. Defence-in-depth
//     against prompt injection in operator-readable VINs / topic
//     names / broker hostnames.
//
//     2. `retrieve_stream_chunks` — a thin wrapper over the F7
//     rag.Retriever scoped to the calling user_subject,
//     restricted to the slice's per-feature source-type
//     allowlist {mqtt_status, sse_status, job_status}. All three
//     source types are reserved by string for forward-
//     compatibility — a future slice will index per-window
//     broker / SSE-hub / job chunks. Until then,
//     retrieve_stream_chunks called with any of these source
//     types simply returns zero chunks for that corpus — which
//     is the correct behaviour: the strategy's goldens already
//     cover the zero-matches narration and the system prompt
//     instructs the LLM to answer gracefully when zero chunks
//     are returned.
//
//   - the redaction policy (`PolicyChatbot`) which the slice
//     prompt mandates ("Allowed classes: none; broker and stream
//     details are redacted where needed"): VIN, lat/long,
//     addresses, place names, vehicle-name, AND every other PII
//     class remain tagged via round-trip markers so a leaked
//     transcript reveals nothing about broker hostnames, ports,
//     SSE client identifiers, or VINs.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_mqtt_sse_inspector_explanations_handler.go`
// which builds a dispatcher, a stream.Writer (SSE), and runs a
// one-shot generation loop scoped to the per-request (from_unix,
// to_unix) tuple. The non-AI baseline rendered by the SPA route
// /mqtt-inspector — the deterministic broker-status snapshot
// table — is unchanged. The registry's Frontend coverage anchor
// is `/system/streams`; the AI section is rendered inside the
// canonical MQTTInspectorPage when the feature is enabled.
// Off-mode users never see the AI section at all (ADR-015 §I3,
// §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic MQTT broker-status snapshot or its per-vehicle
//     table.
//   - I7 per-feature:    the AI route is gated by
//     guard.Wrap("mqtt-sse-inspector-explanations").
//   - I9 redaction:      PolicyChatbot redacts EVERY PII class so
//     a confused LLM cannot leak a hostname, IP, VIN, or any
//     pasted value to the model.
package mqttsseinspectorexplanations

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
const FeatureID = "mqtt-sse-inspector-explanations"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every mqtt-sse-inspector-explanations generation.
// Kept in a single named place so eval goldens
// (internal/ai/strategies/mqtt-sse-inspector-explanations/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_stream_inspector FIRST with the in-scope window the
//     user message lists, then OPTIONALLY call
//     retrieve_stream_chunks (with allowed source_types) for
//     per-event context.
//   - Forbids inventing broker events / vehicle states / job
//     statuses: the explanation is grounded STRICTLY in the
//     envelope.
//   - Forbids cross-window requests: the per-request scope binding
//     refuses any window outside the in-scope (from_unix, to_unix)
//     tuple. The prompt-level ban is defence-in-depth.
//   - Asks for short, focused output (3-6 sentences) so the
//     surface fits inside the existing MQTTInspectorPage layout
//     without a scroll bomb.
//   - Bans speculation about root cause beyond what the envelope
//     explicitly states.
//   - Requires graceful handling of degenerate windows (zero
//     vehicles known / disconnected broker / no jobs wired): say
//     so plainly rather than padding the explanation with
//     speculation.
const SystemPrompt = `You are the TeslaSync mqtt-sse-inspector-explanations agent. ` +
	`Your job is to produce a 3-6 sentence FACTUAL explanation of the in-scope MQTT/SSE/background-job state the user message names. ` +
	`ALWAYS call query_stream_inspector FIRST with from_unix and to_unix matching the in-scope window the user message lists; the per-request scope binding will refuse any other window, but you should refuse it first with a polite explanation. ` +
	`OPTIONALLY call retrieve_stream_chunks AFTER query_stream_inspector with the most salient broker / SSE / job phrase as the natural-language query, restricted to allowed source_types (mqtt_status, sse_status, job_status). When zero chunks are returned, say so plainly — DO NOT fabricate a broker event or job run to fill the void. ` +
	`Your narration MUST be grounded STRICTLY in the envelope: name whether the broker is connected, the vehicle_count and stale_vehicle_count, the aggregate_signals_per_second when present, the SSE connected_clients and dropped_frames, and any background_jobs whose last_status is not "ok". ` +
	`Never invent a vehicle state, never claim a broker event the envelope does not record, never invent a background job, and never speculate about root cause beyond what the envelope explicitly states. ` +
	`If the envelope is degenerate (broker disconnected AND zero vehicles AND zero jobs), say so plainly — DO NOT pad the explanation with speculation. ` +
	`Refuse politely if asked to explain a different window than the in-scope tuple, including windows for other operators. ` +
	`Be concise: 3-6 sentences total — the user reviews the explanation in the AI panel and continues to use the deterministic broker-status snapshot above for raw inspection.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the process-
// wide tools.Registry — both `query_stream_inspector` and
// `retrieve_stream_chunks` are registered by
// RegisterMqttSseInspectorExplanationsTools at boot. The
// dispatcher refuses to mount a strategy that references an
// unknown tool.
//
// Both tools are READ-only: the dispatcher's deny-all confirm
// gate is therefore never reached in practice — defence in depth
// in case a future edit accidentally adds a write tool.
var allowedTools = []string{
	"query_stream_inspector",
	"retrieve_stream_chunks",
}

// Strategy is the concrete strategy.Strategy implementation for
// the mqtt-sse-inspector-explanations surface. Construct via
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
// the AI handler builds the synthesised "explain the in-scope
// stream window" prompt before the call, so the strategy itself
// contributes no extra prefix messages. Returning nil is correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyChatbot wrapped through the F4↔F8 adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// Per the slice prompt: "Policy: PolicyChatbot from
// internal/ai/redact/policies.go. Allowed classes: none; broker
// and stream details are redacted where needed. Round-trip
// required: yes." PolicyChatbot's deny-by-default stance keeps
// every PII class round-tripped to a tag before the message ever
// reaches the provider.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/mqtt-sse-inspector-explanations/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
