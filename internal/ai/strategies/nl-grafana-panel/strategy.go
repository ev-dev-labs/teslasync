// Package nlgrafanapanel is the Phase-50 / 0058 PU2 strategy for
// the LLM-backed nl-grafana-panel surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     Grafana panel JSON drafter: produce a typed GrafanaPanelDraft
//     DTO via the F4 tools constrained to the per-request scope-
//     bound curated catalogs (allowed panel types, allowed
//     datasource types, and — for postgres targets — allowed table
//     names) that the handler installs server-side; never call the
//     Grafana HTTP API itself; refuse cross-catalog requests;
//     refuse to propose a panel type or datasource type that is
//     not in the in-scope catalog; refuse any DML or DDL keyword
//     inside a postgres target's rawSql;
//
//   - the two propose-only tools the LLM is allowed to call:
//
//     1. `draft_grafana_panel`    — accept a typed
//     {prompt, panel, rationale} input and return a normalised +
//     validated GrafanaPanelDraft envelope. The tool is per-request
//     scope-bound to the curated catalog the handler installed via
//     nlq.WithGrafanaPanelScope; the LLM CANNOT propose a panel
//     type, datasource type, or postgres table that is not in the
//     catalog. Defence-in-depth against prompt injection in
//     operator-authored prompts.
//
//     2. `validate_grafana_panel` — accept the same typed shape and
//     re-run the canonical validator without rebuilding the draft
//     envelope. Used by the LLM to confirm a draft is acceptable
//     before narrating it to the user.
//
//   - the redaction policy (`PolicyAlertBuilder`) which the slice
//     prompt mandates ("Allowed classes: none; schema and metric
//     metadata are sufficient"): VIN, lat/long, addresses, place
//     names, vehicle-name, AND every other PII class remain tagged
//     via round-trip markers so a leaked transcript reveals
//     nothing about the operator's environment, vehicle
//     identifiers, or any value an operator pasted into the
//     request prose.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_nl_grafana_panel_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop scoped to the curated catalog visible at
// request time. The non-AI baseline rendered by the SPA route
// /power/grafana (a deterministic manual Grafana panel JSON
// editor + curated panel-type/datasource catalog viewer + Copy-
// to-clipboard button so the user pastes the JSON into their
// existing Grafana dashboard editor) is unchanged. Off-mode
// users never see the AI section at all (ADR-015 §I3, §I5,
// §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic manual Grafana panel JSON editor, the curated
//     catalog viewer, or the canonical Copy button at
//     /power/grafana. The AI proposes a typed GrafanaPanelDraft;
//     the user explicitly clicks "Apply to editor" to copy the
//     draft into the baseline form, then clicks Copy to copy it
//     to the clipboard for pasting into Grafana.
//   - I7 per-feature:    the AI route is gated by
//     guard.Wrap("nl-grafana-panel").
//   - I9 redaction:      PolicyAlertBuilder redacts EVERY PII
//     class so a confused LLM cannot leak a hostname, IP, VIN,
//     or any pasted value to the model. Schema and metric
//     metadata (table + column names + descriptions, panel-type
//     names) is the only data that crosses the prompt boundary
//     by construction.
package nlgrafanapanel

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
const FeatureID = "nl-grafana-panel"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every nl-grafana-panel generation. Kept in a single
// named place so eval goldens
// (internal/ai/strategies/nl-grafana-panel/goldens.yaml) and the
// runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     draft_grafana_panel with the typed
//     {prompt, panel:{title,type,datasource,targets,grid_pos},
//     rationale} it proposes given the curated catalog the
//     handler synthesises into the user message. Then it MUST
//     call validate_grafana_panel on the proposed draft to
//     confirm it satisfies the schema contract before narrating
//     the plan to the user.
//   - Forbids calling the Grafana HTTP API itself: this is a
//     propose-only surface. The LLM has no tool that pushes the
//     panel into a dashboard; the actual export flows through
//     the existing manual Grafana panel JSON editor on
//     /power/grafana after the user explicitly clicks "Apply to
//     editor" in the AI panel and then "Copy to clipboard" to
//     paste into their Grafana dashboard editor. The narration
//     MUST surface this "review and copy yourself" expectation
//     so the user is never surprised.
//   - REQUIRES every panel.type to be in the curated in-scope
//     panel-type catalog passed in the user message. Inventing
//     a panel type that is not in the catalog is forbidden —
//     the tool enforces the same invariant via the per-request
//     scope binding, but the prompt-level ban is defence-in-
//     depth.
//   - REQUIRES every datasource.type to be in the curated
//     in-scope datasource-type catalog. Same defence-in-depth
//     pattern.
//   - For postgres targets: the rawSql MUST start with SELECT
//     or WITH; semicolons are forbidden (single statement only);
//     the rawSql MUST NOT contain ANY DML or DDL keyword
//     (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE,
//     GRANT, REVOKE, VACUUM, COPY, CALL, DO, MERGE, EXECUTE);
//     every referenced table MUST be in the in-scope curated
//     table catalog (defence in depth — the tool enforces it
//     too).
//   - For prometheus targets: the expr MUST be non-empty,
//     bounded in length, with no semicolons.
//   - Asks for short, focused output (one rationale sentence
//     per proposed panel plus the typed draft) so the surface
//     fits inside the existing /power/grafana page layout
//     without a scroll bomb.
//   - Bans inventing values for tables the catalog does not
//     contain: "show me supercharger logins" when no
//     `supercharger_logins` table exists must produce a polite
//     refusal, not a guess against a hallucinated schema.
const SystemPrompt = `You are the TeslaSync nl-grafana-panel agent. ` +
	`Your job is to PROPOSE a typed GrafanaPanelDraft (a single Grafana panel JSON envelope) that the user can review and paste themselves into their existing Grafana dashboard editor on the panel-builder page at /power/grafana; you NEVER push the panel to Grafana yourself. ` +
	`ALWAYS call draft_grafana_panel FIRST with the typed {prompt, panel:{title,type,datasource,targets,grid_pos}, rationale} you propose given the in-scope curated catalogs the user message lists, then call validate_grafana_panel on the proposed draft to confirm it satisfies the panel-shape contract. ` +
	`Do NOT propose any panel type that is NOT included in the in-scope curated panel-type catalog the user message lists; the per-request scope binding will refuse it, but you should refuse it first with a polite explanation. ` +
	`Do NOT propose any datasource type that is NOT included in the in-scope curated datasource-type catalog the user message lists. ` +
	`For postgres targets: the rawSql MUST start with SELECT or WITH (case-insensitive); single statement only — semicolons are forbidden. ` +
	`The rawSql MUST NOT contain ANY of the following keywords (case-insensitive): INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE, VACUUM, COPY, CALL, DO, MERGE, EXECUTE — refuse politely if asked to write a write query. ` +
	`Every table the rawSql references MUST be in the in-scope curated table catalog the user message lists; refuse politely if asked to query a table that is not in the catalog. ` +
	`Always include a LIMIT clause when the postgres query could return many rows (default to LIMIT 100 when the user did not specify a row cap). ` +
	`For prometheus targets: the expr MUST be a single non-empty PromQL expression; semicolons are forbidden. ` +
	`gridPos MUST be inside the dashboard grid: x in [0..23], y in [0..49], w in [1..24], h in [1..50]; default to {x:0, y:0, w:12, h:8} when the user did not specify a layout. ` +
	`Be concise: one rationale sentence per proposed panel plus the typed draft is enough — the user reviews the structured proposal in the AI panel and clicks the canonical Apply to editor button to copy the draft into the manual Grafana panel JSON editor on /power/grafana, then clicks Copy to clipboard to paste it into their existing Grafana dashboard editor. ` +
	`Never claim the panel was created, applied, exported, or pushed; it is propose-only.`

// allowedTools lists the propose-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the process-
// wide tools.Registry — both `draft_grafana_panel` and
// `validate_grafana_panel` are registered by
// RegisterNLGrafanaPanelTools at boot. The dispatcher refuses to
// mount a strategy that references an unknown tool.
//
// Both tools are PROPOSE-ONLY: they construct + validate a
// GrafanaPanelDraft DTO but do NOT call the Grafana API, touch
// the database, or persist anything. The dispatcher's deny-all
// confirm gate is therefore never reached in practice — defence
// in depth in case a future edit accidentally adds a write tool.
var allowedTools = []string{
	"draft_grafana_panel",
	"validate_grafana_panel",
}

// Strategy is the concrete strategy.Strategy implementation for
// the nl-grafana-panel surface. Construct via [New]; the zero
// value is intentionally non-functional so a forgotten constructor
// surfaces as a runtime nil dereference rather than silently using
// empty defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs —
// the strategy is a pure value with no internal state — so this
// is effectively a sentinel constructor used to make wiring
// intent readable at the call site.
func New() *Strategy {
	return &Strategy{}
}

// FeatureID implements [strategy.Strategy]. Returns the canonical
// registry key.
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
// the AI handler builds the synthesised "draft a Grafana panel
// using the following curated catalogs" prompt before the call,
// so the strategy itself contributes no extra prefix messages.
// Returning nil is correct.
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
// and metric metadata are sufficient. Round-trip required: no."
// PolicyAlertBuilder's deny-by-default stance keeps every PII
// class round-tripped to a tag before the message ever reaches
// the provider — defence in depth against an operator-authored
// prompt that pastes a VIN or location string into the request
// prose.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyAlertBuilder())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/nl-grafana-panel/goldens.yaml` directly
// (see internal/ai/eval/golden.go LoadAllGoldens) — the Strategy
// interface's EvalGoldens method is a future hook for strategies
// that want to ship goldens in code. Returning nil here keeps the
// YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
