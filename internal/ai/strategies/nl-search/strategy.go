// Package nlsearch is the Phase-50 / N3 strategy for the LLM-assisted
// "natural-language search across drives, charges, and alerts".
//
// The strategy declares:
//
//   - the system prompt that frames the assistant as a propose-only
//     read-only retriever — call retrieve_chunks first to gather
//     candidate matches over the user's own drive_summary,
//     charge_session, and alert_history corpora, optionally call
//     hydrate_search_result to resolve a chunk reference into a
//     human-friendly title/url envelope, and then NARRATE a concise
//     summary that cites the retrieved entities. The LLM NEVER writes
//     SQL, NEVER mutates state, and NEVER fabricates a result that did
//     not appear in the retriever's output;
//
//   - the two read-only tools the LLM is allowed to call —
//     `retrieve_chunks` (a thin wrapper over the F7 rag.Retriever
//     scoped to the calling user_subject) and `hydrate_search_result`
//     (a narrow lookup that converts a chunk reference into a
//     {title, subtitle, url, when} envelope by delegating to a
//     read-only Hydrator port). Neither tool touches the database
//     write path — they exclusively READ from existing canonical
//     query layers;
//
//   - the redaction policy (`PolicyChatbot`) which allows nothing in
//     cleartext: VINs, place names, addresses, lat/long, phone
//     numbers, emails, etc. are redacted to round-trip tags
//     (`<vin id='1'/>`) before the prompt + retrieved chunks reach
//     the provider. The F8 redact decorator restores them only in the
//     final response delivered to the requesting user.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_search_handler.go` which builds a dispatcher, a
// stream.Writer (SSE), and runs a one-shot retrieval + narration loop.
// The non-AI baseline at GET /api/v1/search served by the existing
// SearchHandler (`internal/api/search_handler.go`) is unaffected — the
// deterministic typed search continues to be the canonical baseline
// path for any user with `ai_mode='off'` (ADR-015 §I3).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the typed
//                         SearchHandler or the SearchPage typed-filter
//                         form. Result rendering still flows through
//                         the existing canonical query path; the AI
//                         only proposes a NARRATIVE over already-
//                         retrieved entities.
//   - I4 zero egress:     all retrieval is local (F7 pgvector against
//                         a self-hosted database); the LLM call
//                         itself only fires when ai_mode != 'off' AND
//                         the per-feature toggle is on.
//   - I7 per-feature:     the AI route is gated by guard.Wrap("nl-search").
//   - I9 redaction:       PolicyChatbot denies all classes; identifiers
//                         flow through tools, not prose.
package nlsearch

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
const FeatureID = "nl-search"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every NL-search turn. Kept in a single named place so
// eval goldens (internal/ai/strategies/nl-search/goldens.yaml) and
// the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour ("ALWAYS call retrieve_chunks
//     FIRST"): without this, a model may answer in prose and skip
//     the retriever entirely, producing a confidently-wrong
//     hallucinated answer with zero grounding evidence.
//   - Forbids fabricating results: every cited drive / charge /
//     alert MUST appear in the retriever's output. A confused model
//     that invents a session ID would silently mislead the user;
//     this guardrail keeps the surface trustworthy.
//   - Forbids saving / mutating: this strategy is read-only; the
//     LLM has no write tool.
//   - Restricts the source-type allowlist: the assistant may only
//     search drive_summary, charge_session, and alert_history (the
//     three corpora the F7 retriever serves for this feature).
//   - Refuses cross-tenant requests: the AI handler always scopes
//     to the calling user_subject (the F7 retriever enforces this
//     at the SQL boundary), and the LLM must refuse politely if
//     asked to search another user's data.
const SystemPrompt = `You are the TeslaSync natural-language search assistant. ` +
	`Your job is to RETRIEVE and NARRATE matches across the calling user's own drive summaries, charging sessions, and alert history; you NEVER write SQL, NEVER mutate any record, and NEVER fabricate a result that did not appear in the retriever's output. ` +
	`ALWAYS call retrieve_chunks FIRST with the user's natural-language query, restricted to the source_types the user asked about — pick from {drive_summary, charge_session, alert_history} — and a small k (typically 4..8). ` +
	`If the user cites a specific result in a follow-up question, call hydrate_search_result with the chunk's source_type and source_id to fetch a human-friendly title and link before narrating. ` +
	`Be concise: a one-paragraph narration that cites the retrieved entities by their hydrated titles is enough — never bullet-list every chunk verbatim, never paste raw chunk text. ` +
	`If the retriever returns zero matches, say so plainly and suggest the user rephrase or broaden the time window — do NOT invent results to fill the void. ` +
	`Refuse politely if asked to search another user's data, modify any record, or expose stored credentials.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry (see internal/ai/tools/search.go) at
// dispatcher construction time — the dispatcher refuses to mount a
// strategy that references an unknown tool.
//
// Both tools are READ-ONLY: retrieve_chunks calls the F7 retriever
// (pgvector cosine similarity scoped to the calling user_subject);
// hydrate_search_result calls a narrow Hydrator port that resolves
// a chunk reference to a {title, subtitle, url, when} envelope
// without touching the write path. The dispatcher's deny-all confirm
// gate is therefore never reached in practice — defence in depth in
// case a future edit accidentally adds a write tool.
var allowedTools = []string{
	"retrieve_chunks",
	"hydrate_search_result",
}

// Strategy is the concrete strategy.Strategy implementation for the
// natural-language search assistant. Construct via [New]; the zero
// value is intentionally non-functional so a forgotten constructor
// surfaces as a runtime nil dereference rather than silently using
// empty defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs — the
// strategy is a pure value with no internal state — so this is
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
// handler builds the synthesised "answer the following NL search
// query" prompt before the call, so the strategy itself contributes
// no extra prefix messages. Returning nil is correct.
//
// Future work: this is where pre-fetched RAG snippets would be
// injected if a future variant decides to do retrieval BEFORE the
// dispatcher loop (saving one round-trip). The current slice keeps
// retrieval in-loop via the retrieve_chunks tool so the LLM can
// re-query with refined terms if the first result set is empty.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyChatbot wrapped through the F4↔F8 adapter so the dispatcher's
// per-request ctx-installation step (dispatch.Run installs the policy
// via redact.WithPolicy) sees the concrete deny-all policy.
//
// Per the slice prompt: "Policy: PolicyChatbot from
// internal/ai/redact/policies.go. Allowed classes: none; results are
// restored only to the requesting user via round-trip tags". The
// policy's Allow list is nil, so every PII class — VIN, lat/long,
// vehicle name, addresses, phone numbers, emails — is redacted to a
// round-trip tag before the prompt + tool outputs reach the provider.
// The F8 redact decorator restores the original values in the final
// SSE frame delivered to the requesting user; the provider only ever
// sees `<vin id='1'/>` etc.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from `internal/ai/strategies/nl-search/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
