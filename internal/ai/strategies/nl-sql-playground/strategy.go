// Package nlsqlplayground is the Phase-50 / 0057 PU1 strategy for
// the LLM-backed nl-sql-playground surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     read-only SQL drafter: produce a typed ReadonlySQLDraft DTO via
//     the F4 tools constrained to the per-request scope-bound
//     curated schema catalog the handler installs server-side; never
//     execute the SQL itself; refuse cross-table requests; refuse to
//     propose a table name that is not in the in-scope catalog;
//     refuse any DML or DDL keyword;
//
//   - the two propose-only tools the LLM is allowed to call:
//
//     1. `draft_readonly_sql`    — accept a typed
//     {prompt, sql, rationale} input and return a normalised +
//     validated ReadonlySQLDraft envelope. The tool is per-request
//     scope-bound to the curated schema catalog the handler installed
//     via tools.WithScopedSchemaCatalog; the LLM CANNOT propose a
//     table name that is not in the catalog. Defence-in-depth
//     against prompt injection in operator-authored prompts.
//
//     2. `validate_readonly_sql` — accept the same typed shape and
//     re-run the canonical validator without rebuilding the draft
//     envelope. Used by the LLM to confirm a draft is acceptable
//     before narrating it to the user.
//
//   - the redaction policy (`PolicyAlertBuilder`) which the slice
//     prompt mandates ("Allowed classes: none; schema metadata only,
//     no raw telemetry in prompt"): VIN, lat/long, addresses, place
//     names, vehicle-name, AND every other PII class remain tagged
//     via round-trip markers so a leaked transcript reveals nothing
//     about the operator's environment, vehicle identifiers, or any
//     value an operator pasted into the request prose.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_nl_sql_playground_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot generation
// loop scoped to the curated schema catalog visible at request time.
// The non-AI baseline rendered by the SPA route /power/sql (the
// deterministic manual SQL textarea + curated schema catalog viewer
// + Run button) is unchanged. Off-mode users never see the AI
// section at all (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic manual SQL editor, the curated schema catalog
//     viewer, or the canonical Run button at /power/sql. The AI
//     proposes a typed ReadonlySQLDraft; the user explicitly clicks
//     "Apply to editor" to copy the draft into the baseline form,
//     then clicks the canonical Run button to execute.
//   - I7 per-feature:    the AI route is gated by
//     guard.Wrap("nl-sql-playground").
//   - I9 redaction:      PolicyAlertBuilder redacts EVERY PII class
//     so a confused LLM cannot leak a hostname, IP, VIN, or any
//     pasted value to the model. Schema metadata (table + column
//     names + descriptions) is the only data that crosses the
//     prompt boundary by construction.
package nlsqlplayground

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
const FeatureID = "nl-sql-playground"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every nl-sql-playground generation. Kept in a single
// named place so eval goldens
// (internal/ai/strategies/nl-sql-playground/goldens.yaml) and the
// runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     draft_readonly_sql with the typed {prompt, sql, rationale} it
//     proposes given the curated schema catalog the handler
//     synthesises into the user message. Then it MUST call
//     validate_readonly_sql on the proposed draft to confirm it
//     satisfies the read-only contract before narrating the plan
//     to the user.
//   - Forbids executing the SQL itself: this is a propose-only
//     surface. The LLM has no tool that runs the query; the actual
//     execution flows through the existing manual SQL playground
//     Run button after the user explicitly clicks "Apply to
//     editor" in the AI panel. The narration MUST surface this
//     "review and click Run yourself" expectation so the user is
//     never surprised.
//   - REQUIRES every referenced table to be in the curated
//     in-scope catalog passed in the user message. Inventing a
//     table name that is not in the catalog is forbidden — the
//     tool enforces the same invariant via the per-request scope
//     binding, but the prompt-level ban is defence-in-depth.
//   - Forbids ANY DML or DDL keyword: INSERT, UPDATE, DELETE,
//     DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE, VACUUM, COPY,
//     CALL, DO, MERGE, EXECUTE. The SQL MUST start with SELECT
//     or WITH. Multiple statements (separated by semicolons) are
//     forbidden.
//   - Asks for short, focused output (one rationale sentence per
//     proposed query plus the typed draft) so the surface fits
//     inside the existing /power/sql page layout without a
//     scroll bomb.
//   - Bans inventing values for tables the catalog does not
//     contain: "show me supercharger logins" when no
//     `supercharger_logins` table exists must produce a polite
//     refusal, not a guess against a hallucinated schema.
const SystemPrompt = `You are the TeslaSync nl-sql-playground agent. ` +
	`Your job is to PROPOSE a typed ReadonlySQLDraft (a single read-only SELECT statement) that the user can review and run themselves on the SQL playground at /power/sql; you NEVER execute the SQL yourself. ` +
	`ALWAYS call draft_readonly_sql FIRST with the typed {prompt, sql, rationale} you propose given the in-scope curated schema catalog the user message lists, then call validate_readonly_sql on the proposed draft to confirm it satisfies the read-only contract. ` +
	`Do NOT propose any table name that is NOT included in the in-scope curated schema catalog the user message lists; the per-request scope binding will refuse it, but you should refuse it first with a polite explanation. ` +
	`The proposed sql MUST start with SELECT or WITH (case-insensitive); single statement only — semicolons are forbidden. ` +
	`The proposed sql MUST NOT contain ANY of the following keywords (case-insensitive): INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE, VACUUM, COPY, CALL, DO, MERGE, EXECUTE — refuse politely if asked to write a write query. ` +
	`Always include a LIMIT clause when the query could return many rows (default to LIMIT 100 when the user did not specify a row cap). ` +
	`Refuse politely if asked to write SQL referencing a table that is not in the in-scope catalog. ` +
	`Be concise: one rationale sentence per proposed query plus the typed draft is enough — the user reviews the structured proposal in the AI panel and clicks the canonical Apply to editor button to copy the draft into the manual SQL editor, then clicks the Run button to execute. ` +
	`Never claim the query was executed, run, or fetched; it is propose-only.`

// allowedTools lists the propose-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the process-wide
// tools.Registry — both `draft_readonly_sql` and
// `validate_readonly_sql` are registered by
// RegisterNLSQLPlaygroundTools at boot. The dispatcher refuses to
// mount a strategy that references an unknown tool.
//
// Both tools are PROPOSE-ONLY: they construct + validate a
// ReadonlySQLDraft DTO but do NOT execute the SQL, touch the
// database, or read any row data. The dispatcher's deny-all
// confirm gate is therefore never reached in practice — defence
// in depth in case a future edit accidentally adds a write tool.
var allowedTools = []string{
	"draft_readonly_sql",
	"validate_readonly_sql",
}

// Strategy is the concrete strategy.Strategy implementation for the
// nl-sql-playground surface. Construct via [New]; the zero value
// is intentionally non-functional so a forgotten constructor
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
// handler builds the synthesised "draft a read-only SQL using the
// following curated schema catalog" prompt before the call, so the
// strategy itself contributes no extra prefix messages. Returning
// nil is correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyAlertBuilder wrapped through the F4↔F8 adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// Per the slice prompt: "Policy: PolicyAlertBuilder from
// internal/ai/redact/policies.go. Allowed classes: none; schema
// metadata only, no raw telemetry in prompt. Round-trip required:
// no." PolicyAlertBuilder's deny-by-default stance keeps every PII
// class round-tripped to a tag before the message ever reaches the
// provider — defence in depth against an operator-authored prompt
// that pastes a VIN or location string into the request prose.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyAlertBuilder())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/nl-sql-playground/goldens.yaml` directly
// (see internal/ai/eval/golden.go LoadAllGoldens) — the Strategy
// interface's EvalGoldens method is a future hook for strategies
// that want to ship goldens in code. Returning nil here keeps the
// YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
