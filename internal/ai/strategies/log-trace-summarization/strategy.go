// Package logtracesummarization is the Phase-50 / 0045 S4 strategy
// for the LLM-backed log-trace-summarization surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     log/trace-window summarizer: produce a 3-6 sentence factual
//     summary by routing through query_trace_window FIRST (the
//     deterministic typed envelope for the in-scope window), then
//     OPTIONALLY retrieve_log_chunks (F7 retrieval restricted to
//     {log_event, trace_span} source types) for per-event context.
//     The narrative MUST be grounded strictly in the tool reply;
//     the LLM never invents events, never claims a recurring
//     template the envelope does not record, and never speculates
//     about root cause beyond what the messages explicitly state.
//
//   - the two read-only tools the LLM is allowed to call:
//
//     1. `query_trace_window` — accept a typed
//     {from_unix, to_unix, vehicle_id?} input and return the
//     deterministic [tools.TraceWindowEnvelope] (window bounds,
//     log-event counts by level, top recurring log-event templates
//     with counts, trace-span count, top trace-span operations
//     with mean duration). The tool is per-request scope-bound to
//     the (from_unix, to_unix, vehicle_id?) tuple the handler
//     installed via tools.WithScopedLogTraceWindow; the LLM CANNOT
//     query a window outside that scope. Defence-in-depth against
//     prompt injection in operator-authored log messages.
//
//     2. `retrieve_log_chunks` — a thin wrapper over the F7
//     rag.Retriever scoped to the calling user_subject, restricted
//     to the slice's per-feature source-type allowlist
//     {log_event, trace_span}. Both source types are reserved by
//     string for forward-compatibility — a future slice will index
//     per-window log-event and trace-span chunks. Until then,
//     retrieve_log_chunks called with either source type simply
//     returns zero chunks for that corpus — which is the correct
//     behaviour: the strategy's goldens already cover the
//     zero-matches narration and the system prompt instructs the
//     LLM to answer gracefully when zero chunks are returned.
//
//   - the redaction policy (`PolicyChatbot`) which the slice
//     prompt mandates ("Allowed classes: none; logs are
//     structurally redacted before any provider call"): VIN,
//     lat/long, addresses, place names, vehicle-name, AND every
//     other PII class remain tagged via round-trip markers so a
//     leaked transcript reveals nothing about IPs, hostnames,
//     ports, tokens, or any value zerolog wrote into a structured
//     field.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_log_trace_summarization_handler.go` which
// builds a dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop scoped to the per-request (from_unix, to_unix,
// vehicle_id?) tuple. The non-AI baseline rendered by the SPA
// route /live-logs (and the operator-facing canonical
// LiveLogsPage) — the deterministic SSE-backed log tail with
// manual level + grep + vehicle filters — is unchanged. The
// registry's Frontend coverage anchor is `/system/logs`; the AI
// section is rendered inside the canonical LiveLogsPage when the
// feature is enabled. Off-mode users never see the AI section at
// all (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic SSE-backed log tail or its level/grep/vehicle
//     filters.
//   - I7 per-feature:    the AI route is gated by
//     guard.Wrap("log-trace-summarization").
//   - I9 redaction:      PolicyChatbot redacts EVERY PII class so
//     a confused LLM cannot leak a hostname, IP, VIN, or any
//     pasted value to the model.
package logtracesummarization

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
const FeatureID = "log-trace-summarization"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every log-trace-summarization generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/log-trace-summarization/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_trace_window FIRST with the in-scope window the user
//     message lists, then OPTIONALLY call retrieve_log_chunks
//     (with allowed source_types) for per-event context.
//   - Forbids inventing events / templates / counts / operations:
//     the summary is grounded STRICTLY in the tool reply.
//   - Forbids cross-window requests: the per-request scope binding
//     refuses any window outside the in-scope (from_unix, to_unix,
//     vehicle_id?) tuple. The prompt-level ban is defence-in-depth.
//   - Asks for short, focused output (3-6 sentences) so the
//     surface fits inside the existing LiveLogsPage layout without
//     a scroll bomb.
//   - Bans speculation about root cause beyond what the messages
//     explicitly state.
//   - Requires graceful handling of degenerate windows (zero log
//     events / zero trace spans): say so plainly rather than
//     padding the summary with speculation.
const SystemPrompt = `You are the TeslaSync log-trace-summarization agent. ` +
	`Your job is to produce a 3-6 sentence FACTUAL summary of the in-scope log/trace window the user message names. ` +
	`ALWAYS call query_trace_window FIRST with from_unix, to_unix, and (when supplied) vehicle_id matching the in-scope window the user message lists; the per-request scope binding will refuse any other window, but you should refuse it first with a polite explanation. ` +
	`OPTIONALLY call retrieve_log_chunks AFTER query_trace_window with the most salient log-template phrase or operation name as the natural-language query, restricted to allowed source_types (log_event, trace_span). When zero chunks are returned, say so plainly — DO NOT fabricate a log line or trace span to fill the void. ` +
	`Your narration MUST be grounded STRICTLY in the tool reply: name the level breakdown (debug/info/warn/error counts), the top recurring log template(s) with their counts, the trace-span count, and the top trace-span operation(s) with their mean duration when present. ` +
	`Never invent a log line, never claim a recurring template the envelope does not record, never invent a trace operation, and never speculate about root cause beyond what the messages explicitly state. ` +
	`If the window is degenerate (zero log events AND zero trace spans), say so plainly — DO NOT pad the summary with speculation. ` +
	`Refuse politely if asked to summarize a different window than the in-scope tuple, including windows for other vehicles. ` +
	`Be concise: 3-6 sentences total — the user reviews the summary in the AI panel and continues to use the deterministic SSE log tail below for raw inspection.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the process-wide
// tools.Registry — both `query_trace_window` and
// `retrieve_log_chunks` are registered by
// RegisterLogTraceSummarizerTools at boot. The dispatcher refuses
// to mount a strategy that references an unknown tool.
//
// Both tools are READ-only: the dispatcher's deny-all confirm gate
// is therefore never reached in practice — defence in depth in case
// a future edit accidentally adds a write tool.
var allowedTools = []string{
	"query_trace_window",
	"retrieve_log_chunks",
}

// Strategy is the concrete strategy.Strategy implementation for the
// log-trace-summarization surface. Construct via [New]; the zero
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
// the allowed tool names so a caller cannot mutate the package-
// level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds the
// conversation from StrategyInput.LastMessage / History, and the AI
// handler builds the synthesised "summarize the in-scope log window"
// prompt before the call, so the strategy itself contributes no
// extra prefix messages. Returning nil is correct.
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
// internal/ai/redact/policies.go. Allowed classes: none; logs are
// structurally redacted before any provider call. Round-trip
// required: yes." PolicyChatbot's deny-by-default stance keeps
// every PII class round-tripped to a tag before the message ever
// reaches the provider.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/log-trace-summarization/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
