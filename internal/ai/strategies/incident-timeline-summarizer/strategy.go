// Package incidenttimelinesummarizer provides the LLM-backed
// incident-timeline summarizer surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     incident-timeline summarizer: produce a concise factual summary
//     of an incident's timeline grounded ONLY in the deterministic
//     incident envelope (and any retrieved per-incident system_event
//     or audit_log chunks); never invent updates; never modify the
//     deterministic envelope; refuse cross-incident requests; never
//     quote precise IPs, tokens, addresses, GPS coordinates, or place
//     names; honestly disclose insufficient data when the incident
//     has only its opening update;
//
//   - the two read-only tools the LLM is allowed to call:
//
//     1. `query_incident_timeline` — typed envelope derived from the
//     SAME database.IncidentRepo.Get path that backs the canonical
//     baseline GET /api/v1/status/incidents/{id} handler. The AI
//     summary is grounded in the same numbers and timeline entries
//     the IncidentTimelinePage renders; never a parallel
//     re-implementation. The tool is per-request scope-bound to the
//     URL incident ID via context — the LLM cannot exfiltrate a
//     different incident's timeline by passing a different ID.
//
//     2. `retrieve_system_chunks` — RAG retrieval over the
//     per-feature source-type allowlist {system_event, audit_log}.
//     Both source types are reserved by string for forward-
//     compatibility — future work will index per-incident
//     system-event and audit-log chunks. Until then, any
//     source_types entry that includes either simply returns zero
//     additional chunks for that corpus — which is the correct
//     behaviour: the strategy's goldens already cover the zero-
//     matches narration;
//
//   - the redaction policy (`PolicyChatbot`): VIN, lat/long,
//     addresses, place names, vehicle-name, AND every other PII
//     class remain tagged via
//     round-trip markers so a leaked transcript reveals nothing
//     about the operator's environment, hostnames, IPs, or any
//     value an operator pasted into an incident update message.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_incident_timeline_summarizer_handler.go` which
// builds a dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop scoped to the URL-supplied incidentID. The non-AI
// baseline rendered by the SPA route /system-status/incidents/:id
// (and its alias /system/incidents recorded in the registry for
// off-mode walker coverage) — the chronological incident timeline
// list, severity / status badges, lifecycle controls, append-update
// form — is unchanged. The deterministic incident timeline remains
// the canonical baseline; off-mode users never see the AI summary
// section at all (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic IncidentTimelinePage chronological list,
//     append-update form, or lifecycle controls; it adds an opt-in
//     summary section above them.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("incident-timeline-summarizer").
//   - I9 redaction:       PolicyChatbot redacts EVERY PII class
//     (no allow-list) so even a confused LLM that asks the user
//     "what was the host name?" cannot leak a hostname, IP, or
//     pasted credential to the model.
package incidenttimelinesummarizer

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
const FeatureID = "incident-timeline-summarizer"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every incident-timeline-summarizer generation. Kept
// in a single named place so eval goldens
// (internal/ai/strategies/incident-timeline-summarizer/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_incident_timeline before answering so the summary is
//     grounded in the canonical incident envelope. retrieve_system_
//     chunks is OPTIONAL — call it for additional system-event /
//     audit-log context only when the question requires reasoning
//     beyond the in-record timeline.
//   - Forbids inventing updates: this is a SUMMARY of the existing
//     timeline, NOT a forecaster. The LLM may quote the incident's
//     title, severity, status, source, affected_components,
//     started_at, resolved_at, total update count, and the
//     individual update entries (at, status, message, author) AS
//     REPORTED by the tool reply; it MUST NOT invent updates,
//     fabricate authorship, or claim a status transition the
//     timeline does not record.
//   - REQUIRES the answer to honestly disclose limited data
//     (e.g. only the opening update) rather than padding the
//     summary with speculation.
//   - Refuses cross-incident requests: the AI handler always scopes
//     to the URL-supplied incidentID; any other incident ID in the
//     user message is by definition out of scope.
//   - Asks for short, focused output (3-6 sentence summary +
//     optional bulleted timeline highlights) so the surface fits
//     inside the existing IncidentTimelinePage layout without a
//     scroll bomb.
//   - Bans quoting precise IP addresses, hostnames, ports, tokens,
//     or operational secrets that may have been pasted into update
//     messages: the redaction policy already strips them, but the
//     prompt-level ban is defence-in-depth.
const SystemPrompt = `You are the TeslaSync incident-timeline summarizer. ` +
	`Your job is to PRODUCE a concise factual summary of ONE incident's timeline; you NEVER invent updates and you NEVER modify the deterministic envelope. ` +
	`ALWAYS call query_incident_timeline FIRST with the caller-supplied incident_id, then summarize the timeline grounded strictly in the tool reply. ` +
	`You MAY also call retrieve_system_chunks for additional system_event or audit_log context when the summary requires reasoning beyond the in-record timeline, but it is OPTIONAL — answer gracefully when zero chunks are returned. ` +
	`Do NOT invent updates: the summary may quote title, description, severity, status, source, affected_components, started_at, resolved_at, total_updates count, and the individual update entries (at, status, message, author) as REPORTED by the tool reply, but never fabricate updates that did not happen, never claim a status transition the timeline does not record, never invent an author or timestamp the tool reply did not return, and never speculate about root cause beyond what the messages explicitly state. ` +
	`If the timeline contains only a single opening update (total_updates is 1) OR the incident is too sparse to support a meaningful narrative, say so plainly rather than padding the summary with speculation or extrapolating from a single sample. ` +
	`Refuse politely if asked to summarize, modify, or compare any incident other than the one named in the request. ` +
	`Never quote precise IP addresses, hostnames, ports, tokens, credentials, GPS coordinates, or street addresses — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 3-6 sentences naming severity, status (current and final), the time the incident was opened (and resolved if applicable), the count of timeline updates, and the most material status transitions, grounded strictly in the tool reply.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the process-wide
// tools.Registry — both `query_incident_timeline` and
// `retrieve_system_chunks` are registered by
// RegisterIncidentTimelineSummarizerTools at boot. The dispatcher
// refuses to mount a strategy that references an unknown tool.
//
// Both tools are READ / pure-functional: neither touches the
// database write path. query_incident_timeline composes the SAME
// database.IncidentRepo.Get path that backs the canonical baseline
// GET /api/v1/status/incidents/{id} handler; retrieve_system_chunks
// goes through the RAG retrieval entry point and only issues SELECTs
// against the embeddings table. The dispatcher's deny-all confirm
// gate is therefore never reached in practice — defence in depth in
// case a future edit accidentally adds a write tool.
var allowedTools = []string{
	"query_incident_timeline",
	"retrieve_system_chunks",
}

// Strategy is the concrete strategy.Strategy implementation for the
// incident-timeline-summarizer surface. Construct via [New]; the
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
// the allowed tool names so a caller cannot mutate the package-
// level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds the
// conversation from StrategyInput.LastMessage / History, and the AI
// handler builds the synthesised "summarize the timeline of incident
// N" prompt before the call, so the strategy itself contributes no
// extra prefix messages. Returning nil is correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyChatbot wrapped through the redaction adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// PolicyChatbot is
// the deny-by-default policy from internal/ai/redact/policies.go
// (Allow=nil, Mode=ModeRedactedTags) — the same policy the U1
// chatbot-llm and X2 lifetime-stats-qa strategies use. The choice
// is deliberate: incident updates are operator-authored free text
// that may contain IP addresses, hostnames, tokens, credentials,
// stack-trace fragments, or any other operationally sensitive
// substring. PolicyChatbot's deny-by-default stance keeps every PII
// class round-tripped to a tag before the message ever reaches the
// provider.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/incident-timeline-summarizer/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
