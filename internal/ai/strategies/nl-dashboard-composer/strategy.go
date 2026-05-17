// Package nldashboardcomposer is the Phase-50 / 0059 PU3 strategy
// for the LLM-backed nl-dashboard-composer surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     dashboard layout drafter: produce a typed
//     DashboardLayoutDraft DTO via the F4 tools constrained to the
//     per-request scope-bound curated panel catalog (a finite set
//     of named pre-validated panel templates) that the handler
//     installs server-side; the LLM does NOT invent panels — it
//     only picks panel names from the in-scope catalog and
//     assigns each one a grid_pos;
//
//   - the two propose-only tools the LLM is allowed to call:
//
//     1. `draft_dashboard_layout`    — accept a typed
//     {prompt, dashboard:{title, slots:[{panel_name, grid_pos}]},
//     rationale} input and return a normalised + validated
//     DashboardLayoutDraft envelope. The tool is per-request
//     scope-bound to the curated panel catalog the handler
//     installed via tools.WithDashboardComposerScope; the LLM
//     CANNOT propose a panel name that is not in the catalog.
//     Defence-in-depth against prompt injection in
//     operator-authored prompts.
//
//     2. `validate_dashboard_layout` — accept the same typed shape
//     and re-run the canonical validator without rebuilding the
//     draft envelope. Used by the LLM to confirm a draft is
//     acceptable before narrating it to the user.
//
//   - the redaction policy (`PolicyAlertBuilder`) which the slice
//     prompt mandates ("Allowed classes: none; widget catalog and
//     aggregate metadata only"): VIN, lat/long, addresses, place
//     names, vehicle-name, AND every other PII class remain tagged
//     via round-trip markers so a leaked transcript reveals
//     nothing about the operator's environment, vehicle
//     identifiers, or any value an operator pasted into the
//     request prose.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_nl_dashboard_composer_handler.go` which builds
// a dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop scoped to the curated panel catalog visible at
// request time. The non-AI baseline rendered by the SPA route
// /power/dashboards (a deterministic manual dashboard layout
// composer + curated panel catalog viewer + Copy-to-clipboard
// button so the user pastes the JSON into their Grafana
// dashboard) is unchanged. Off-mode users never see the AI
// section at all (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic manual dashboard layout composer, the curated
//     panel catalog viewer, or the canonical Copy button at
//     /power/dashboards. The AI proposes a typed
//     DashboardLayoutDraft; the user explicitly clicks "Apply to
//     editor" to copy the draft into the baseline form, then
//     clicks Copy to copy it to the clipboard for pasting into
//     Grafana.
//   - I7 per-feature:    the AI route is gated by
//     guard.Wrap("nl-dashboard-composer").
//   - I9 redaction:      PolicyAlertBuilder redacts EVERY PII
//     class so a confused LLM cannot leak a hostname, IP, VIN,
//     or any pasted value to the model. Only panel-catalog
//     metadata (panel names + descriptions) crosses the prompt
//     boundary by construction.
package nldashboardcomposer

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
const FeatureID = "nl-dashboard-composer"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every nl-dashboard-composer generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/nl-dashboard-composer/goldens.yaml) and
// the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     draft_dashboard_layout with the typed
//     {prompt, dashboard:{title, slots:[{panel_name, grid_pos}]},
//     rationale} it proposes given the curated catalog the
//     handler synthesises into the user message. Then it MUST
//     call validate_dashboard_layout on the proposed draft to
//     confirm it satisfies the schema contract before narrating
//     the plan to the user.
//   - Forbids inventing panels: the LLM has no tool that creates
//     a new panel; it only picks panel_name values from the
//     in-scope catalog. Asking for an out-of-catalog panel
//     produces a polite refusal.
//   - Forbids pushing the dashboard: this is a propose-only
//     surface. The narration MUST surface this "review and copy
//     yourself" expectation so the user is never surprised.
//   - REQUIRES every panel_name to be in the in-scope curated
//     panel catalog. The tool enforces the same invariant via
//     the per-request scope binding, but the prompt-level ban
//     is defence-in-depth.
//   - Per-slot grid_pos MUST be inside the dashboard grid:
//     x in [0..23], y in [0..49], w in [1..24], h in [1..50];
//     and x+w MUST stay within 24.
//   - Bounds the dashboard at 12 slots so a confused LLM cannot
//     produce a 100-panel mega-dashboard.
//   - Forbids duplicate panel_name slots and overlapping
//     bounding boxes (defence in depth — the validator enforces
//     it too).
//   - Asks for short, focused output (one rationale sentence
//     plus the typed draft) so the surface fits inside the
//     /power/dashboards page layout without a scroll bomb.
const SystemPrompt = `You are the TeslaSync nl-dashboard-composer agent. ` +
	`Your job is to PROPOSE a typed DashboardLayoutDraft (a single dashboard envelope: title plus an ordered list of panel slots that pick panels by name from the in-scope curated panel catalog and place each one on the Grafana 24-column grid) that the user can review and paste themselves into their existing Grafana dashboard editor on the dashboard composer page at /power/dashboards; you NEVER push the dashboard to Grafana yourself. ` +
	`ALWAYS call draft_dashboard_layout FIRST with the typed {prompt, dashboard:{title, slots:[{panel_name, grid_pos:{x,y,w,h}}]}, rationale} you propose given the in-scope curated catalog the user message lists, then call validate_dashboard_layout on the proposed draft to confirm it satisfies the layout contract. ` +
	`Do NOT invent panels: every slot.panel_name MUST be one of the panel names listed in the in-scope curated panel catalog the user message provides; the per-request scope binding will refuse any other name, but you should refuse it first with a polite explanation. ` +
	`Each slot's grid_pos MUST be inside the Grafana dashboard grid: x in [0..23], y in [0..49], w in [1..24], h in [1..50]; the sum x+w MUST be at most 24. ` +
	`The dashboard MUST contain at least 1 and at most 12 slots. ` +
	`Slots MUST NOT use the same panel_name twice (each catalog panel may appear at most once per dashboard). ` +
	`Slot bounding boxes MUST NOT overlap: for any two slots S1=(x1,y1,w1,h1) and S2=(x2,y2,w2,h2), the rectangles {x1..x1+w1-1, y1..y1+h1-1} and {x2..x2+w2-1, y2..y2+h2-1} MUST be disjoint — refuse politely if you cannot lay every requested panel out without an overlap. ` +
	`Default to a tidy 2-column layout: width 12 columns, height 8 rows, stacked vertically (slot N at y=N*8) when the user does not specify a layout. ` +
	`Be concise: one rationale sentence per dashboard plus the typed draft is enough — the user reviews the structured proposal in the AI panel and clicks the canonical Apply to editor button to copy the draft into the manual dashboard composer form on /power/dashboards, then clicks Copy to clipboard to paste it into their existing Grafana dashboard. ` +
	`Never claim the dashboard was created, applied, exported, or pushed; it is propose-only.`

// allowedTools lists the propose-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the process-
// wide tools.Registry — both `draft_dashboard_layout` and
// `validate_dashboard_layout` are registered by
// RegisterNLDashboardComposerTools at boot. The dispatcher refuses
// to mount a strategy that references an unknown tool.
//
// Both tools are PROPOSE-ONLY: they construct + validate a
// DashboardLayoutDraft DTO but do NOT call the Grafana API,
// touch the database, or persist anything. The dispatcher's
// deny-all confirm gate is therefore never reached in practice —
// defence in depth in case a future edit accidentally adds a
// write tool.
var allowedTools = []string{
	"draft_dashboard_layout",
	"validate_dashboard_layout",
}

// Strategy is the concrete strategy.Strategy implementation for
// the nl-dashboard-composer surface. Construct via [New]; the
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
// the AI handler builds the synthesised "compose a dashboard
// using the following curated panel catalog" prompt before the
// call, so the strategy itself contributes no extra prefix
// messages. Returning nil is correct.
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
// internal/ai/redact/policies.go. Allowed classes: none; widget
// catalog and aggregate metadata only. Round-trip required: no."
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
// `internal/ai/strategies/nl-dashboard-composer/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
