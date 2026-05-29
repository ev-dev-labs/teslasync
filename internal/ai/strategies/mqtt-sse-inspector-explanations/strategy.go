// Package mqttsseinspectorexplanations explains MQTT, SSE, and background-job
// stream state from deterministic diagnostics.
//
// The strategy must query the scoped stream-inspector window before narrating
// and may retrieve matching stream context. It never invents broker events,
// vehicle states, job runs, or root causes beyond what the typed envelope
// reports, and it refuses windows outside the request scope.
//
// The deterministic /system/streams baseline remains unchanged; this strategy
// only adds an opt-in explanation panel when the feature is enabled.
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
// PolicyChatbot wrapped through the redaction adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// This policy allows no cleartext PII; broker and stream details remain
// tagged and round-tripped where needed. PolicyChatbot's deny-by-default stance keeps
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
