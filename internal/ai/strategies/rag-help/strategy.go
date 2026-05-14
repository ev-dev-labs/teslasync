// Package raghelp is the Phase-50 / N6 strategy for the RAG-backed
// app help assistant.
//
// The strategy declares:
//
//   - the system prompt that frames the assistant as a propose-only
//     read-only documentation guide — call retrieve_docs first to
//     gather candidate matches across the application's own docs,
//     runbooks, and i18n keys, optionally call cite_help_chunk to
//     format a chunk reference into a stable citation envelope, and
//     then NARRATE a concise answer that cites the retrieved
//     entities. The LLM NEVER writes SQL, NEVER mutates state, and
//     NEVER fabricates a passage that did not appear in the
//     retriever's output;
//
//   - the two read-only tools the LLM is allowed to call —
//     `retrieve_docs` (a thin wrapper over the F7 rag.Retriever
//     scoped to the global docs corpus) and `cite_help_chunk` (a
//     pure formatter that converts a chunk reference into a
//     deterministic citation label without any external lookup).
//     Neither tool touches the database write path — they
//     exclusively READ from existing canonical retrieval layers;
//
//   - the redaction policy (`PolicyChatbot`) which allows nothing in
//     cleartext. The slice prompt's evidence section explicitly
//     names PolicyChatbot and notes that "app docs and i18n keys
//     contain no user PII" — the deny-all stance is therefore
//     trivially satisfied today, but the policy is wired anyway as
//     defence-in-depth in case a future docs corpus accidentally
//     includes a user-sourced runbook that mentions a VIN, address,
//     or other identifier.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_rag_help_handler.go` which builds a dispatcher,
// a stream.Writer (SSE), and runs a one-shot retrieval + narration
// loop. The non-AI baseline rendered by the SPA route /help — a
// deterministic page with curated links into the existing /docs/*,
// /system-status, /chatbot, /search, /onboarding pages plus the
// existing in-app tooltips and i18n help copy — is unchanged. Off-
// mode users never see the AI surface at all (ADR-015 §I3, §I5,
// §I6); the deterministic curated links remain the canonical
// help path.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the static
//     HelpPage curated links + tooltips + i18n
//     help copy. Result rendering still flows
//     through the existing canonical /docs and
//     /system-status / /chatbot / /search pages
//     the curated links point at; the AI only
//     proposes a NARRATIVE over already-retrieved
//     chunks.
//   - I4 zero egress:    all retrieval is local (F7 pgvector against
//     a self-hosted database); the LLM call itself
//     only fires when ai_mode != 'off' AND the
//     per-feature toggle is on.
//   - I7 per-feature:    the AI route is gated by guard.Wrap("rag-help").
//   - I9 redaction:      PolicyChatbot denies all classes; in practice
//     the docs corpus carries no PII so the policy
//     is a defence-in-depth contract pin rather
//     than an active redaction surface.
package raghelp

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
const FeatureID = "rag-help"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every rag-help turn. Kept in a single named place so
// eval goldens (internal/ai/strategies/rag-help/goldens.yaml) and
// the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour ("ALWAYS call retrieve_docs
//     FIRST"): without this, a model may answer in prose from priors
//     and produce a confidently-wrong hallucinated answer with zero
//     grounding evidence in the actual app docs.
//   - Forbids fabricating passages: every cited doc / runbook / i18n
//     key MUST appear in the retriever's output. A confused model
//     that invents a doc path would silently mislead the user;
//     this guardrail keeps the surface trustworthy.
//   - Forbids saving / mutating: this strategy is read-only; the
//     LLM has no write tool.
//   - Restricts the source-type allowlist: the assistant may only
//     search docs, runbooks, and i18n (the three corpora the F7
//     retriever serves for this feature; see
//     internal/ai/tools/help.go for the enforced allowlist).
//   - Asks for short, focused output with explicit citations: the
//     answer must end with a short citations list rather than
//     interleave inline URLs that the SPA would have to extract.
const SystemPrompt = `You are the TeslaSync application help assistant. ` +
	`Your job is to ANSWER the user's question about the application using ONLY content retrieved from the application's own documentation, runbooks, and i18n strings; you NEVER write SQL, NEVER mutate any record, and NEVER fabricate a passage that did not appear in the retriever's output. ` +
	`ALWAYS call retrieve_docs FIRST with the user's natural-language question, restricted to the source_types the question covers — pick from {docs, runbooks, i18n} — and a small k (typically 4..8). ` +
	`If the user asks a follow-up that pins a specific chunk, call cite_help_chunk with the chunk's source_type, source_id, and chunk_idx to format a stable citation label before narrating. ` +
	`Be concise: 2-4 short paragraphs that answer the question, followed by a short citations list naming each chunk you used by source_type and source_id — never paste raw chunk text verbatim, never invent a docs path or i18n key that retrieve_docs did not return. ` +
	`If the retriever returns zero matches, say so plainly and suggest the user check the static help links on the page or rephrase — do NOT invent an answer to fill the void. ` +
	`Refuse politely if asked to mutate any application setting, send a notification, run an automation, or otherwise act on the user's behalf — your role is read-only documentation answering, nothing more.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry (see internal/ai/tools/help.go) at
// dispatcher construction time — the dispatcher refuses to mount a
// strategy that references an unknown tool.
//
// Both tools are READ-ONLY: retrieve_docs calls the F7 retriever
// (pgvector cosine similarity over the global docs|runbooks|i18n
// corpora); cite_help_chunk is a pure deterministic formatter with
// no external dependencies. The dispatcher's deny-all confirm gate
// is therefore never reached in practice — defence in depth in case
// a future edit accidentally adds a write tool.
var allowedTools = []string{
	"retrieve_docs",
	"cite_help_chunk",
}

// Strategy is the concrete strategy.Strategy implementation for the
// RAG-backed app help assistant. Construct via [New]; the zero
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
// handler builds the synthesised "answer the following help
// question" prompt before the call, so the strategy itself
// contributes no extra prefix messages. Returning nil is correct.
//
// Future work: this is where the SPA route the user is currently on
// (e.g. "user is on /charging-curve") would be injected as
// scoping context once the frontend wiring grows that surface.
// Today's slice keeps Context empty so the dispatcher's behaviour
// is fully determined by [System] + History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyChatbot wrapped through the F4↔F8 adapter so the dispatcher's
// per-request ctx-installation step (dispatch.Run installs the policy
// via redact.WithPolicy) sees the concrete deny-all policy.
//
// Per the slice prompt: "Policy: PolicyChatbot from
// internal/ai/redact/policies.go. Allowed classes: none; app docs
// and i18n keys contain no user PII; round-trip required: no". The
// policy's Allow list is nil, so every PII class — VIN, lat/long,
// vehicle name, addresses, phone numbers, emails — is redacted to a
// round-trip tag before the prompt + tool outputs reach the
// provider. In practice the docs corpus carries no PII so the
// policy is a defence-in-depth contract pin rather than an active
// redaction surface; if a future docs revision accidentally adds a
// VIN or address, the redactor catches it.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from `internal/ai/strategies/rag-help/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
