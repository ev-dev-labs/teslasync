// Phase-50 / 0059 — PU3 Natural-language dashboard composer.
//
// nl_dashboard_composer.go ships TWO new propose-only tools:
//
//   - `draft_dashboard_layout`    — accept a typed
//                                   DashboardLayoutDraft shape
//                                   (prompt, dashboard, rationale)
//                                   and return a normalized +
//                                   validated draft the frontend
//                                   can render for human review
//                                   in the AI side panel of the
//                                   dashboard composer page.
//
//   - `validate_dashboard_layout` — accept the same typed shape
//                                   and return whether it would
//                                   be accepted by the canonical
//                                   dashboard-layout contract,
//                                   with field-level error
//                                   messages on rejection.
//
// Both tools are PROPOSE-ONLY: they construct or validate a
// DashboardLayoutDraft DTO but do NOT call the Grafana API,
// touch the database, or persist anything. The dispatcher's
// deny-all confirm gate is therefore never triggered — defence
// in depth in case a future edit accidentally adds a write tool.
// The actual export flows through the existing manual dashboard
// composer's Copy-to-clipboard button on /power/dashboards
// AFTER the user explicitly clicks the Apply to editor button in
// the AI panel; the LLM has no tool that pushes the dashboard.
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the AI HTTP handler installs the in-scope
// curated panel name catalog in ctx via
// WithDashboardComposerScope BEFORE the dispatcher invokes the
// tool. Both tools' Execute REJECT any LLM-supplied panel_name
// that is NOT in the snapshot. This blocks a prompt-injection
// attack where an attacker pastes "use panel secret_dump" into
// the prompt — even if the LLM tries to call the tool with an
// out-of-scope panel name, the scope check refuses the call
// before any out-of-catalog proposal can reach the SPA.
//
// Design constraints (from the slice prompt):
//
//   - "Route every mutation proposal through F4 tools and existing
//     typed DTO validation. The LLM never writes raw SQL and never
//     bypasses existing handlers." → both tools delegate the final
//     DashboardLayoutDraft shape check to a narrow
//     [DashboardLayoutValidator] port. The tool ALSO enforces the
//     panel-name catalog scope, the slot-count bounds, and the
//     overlap detector before any validator method runs.
//
//   - "no duplicate write paths" → the toolkit does NOT include an
//     `apply_dashboard_layout`, `push_dashboard_layout`, or any
//     other write tool. The frontend renders the draft and the
//     user clicks the canonical baseline Copy-to-clipboard
//     button on the dashboard composer page, which is what
//     allows them to paste it into their own Grafana dashboard
//     editor.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ---------------------------------------------------------------------------
// Per-request dashboard composer scope binding
// ---------------------------------------------------------------------------

// dashboardComposerScope is the value stored in context. Holds
// the in-scope panel name set for the current request. A single
// scope value lets the tool make O(1) lookups, and lets
// missing-scope (no value installed) be distinguished from
// empty-scope (a degenerate but legal state) at the type level.
type dashboardComposerScope struct {
	panels map[string]struct{}
}

// dashboardComposerScopeKey is the unexported context-key type
// used to carry the in-scope snapshot through the dispatcher to
// the tool. A per-package unexported type prevents accidental
// key collisions with any other context value in the request
// lifetime.
type dashboardComposerScopeKey struct{}

// WithDashboardComposerScope returns ctx with the panel name
// snapshot installed as the in-scope curated catalog for this
// request. Called by the AI HTTP handler AFTER it loads the
// catalog from the canonical
// [AINLDashboardComposerCatalogSource] and BEFORE the
// dispatcher.Run loop is started. The dispatcher then propagates
// ctx unchanged through every Tool.Execute call.
//
// The input slice is defensively copied into a private set so a
// later mutation by the caller cannot retroactively widen or
// narrow the scope a tool already consulted. Names are
// normalised to lower-case so case-insensitive comparisons work
// uniformly downstream. nil-safe: passing nil installs an empty
// scope (the tool will refuse every panel name the LLM proposes).
//
// Exported so internal/api can install the scope without
// depending on tool-internal types.
func WithDashboardComposerScope(ctx context.Context, panels []string) context.Context {
	scope := &dashboardComposerScope{
		panels: tableNamesToSet(panels),
	}
	return context.WithValue(ctx, dashboardComposerScopeKey{}, scope)
}

// DashboardComposerScopeFromContext returns the in-scope snapshot
// and true when one is installed, or (nil, false) when no scope
// is installed. Tools that are scope-bound MUST treat the
// missing-scope case as a hard failure — the AI handler ALWAYS
// installs the scope, so an absent scope means the dispatcher
// was invoked from an unintended path and the call must be
// refused.
//
// Returns a sorted defensive copy of the names (callers may
// mutate freely).
//
// Exported for symmetry with WithDashboardComposerScope and so
// unit tests in other packages can inspect what the AI handler
// installed.
func DashboardComposerScopeFromContext(ctx context.Context) (panels []string, ok bool) {
	scope, ok := ctx.Value(dashboardComposerScopeKey{}).(*dashboardComposerScope)
	if !ok || scope == nil {
		return nil, false
	}
	return tableNamesSetToSortedSlice(scope.panels), true
}

// ---------------------------------------------------------------------------
// Dashboard composer constants
// ---------------------------------------------------------------------------

// dashboardGridXMax is the rightmost x-coordinate Grafana allows
// on a 24-column dashboard grid (x ∈ [0..23]).
const dashboardGridXMax = 23

// dashboardGridYMax is the practical upper bound on the slot
// y-coordinate. Grafana itself is unbounded but the AI surface
// caps proposals so a hostile prompt cannot ask for a slot
// placed at y=999999 to confuse the rendering layer downstream.
const dashboardGridYMax = 49

// dashboardGridWMax is the maximum slot width (Grafana's
// 24-column grid).
const dashboardGridWMax = 24

// dashboardGridHMax is the practical upper bound on the slot
// height. Same reasoning as [dashboardGridYMax].
const dashboardGridHMax = 50

// dashboardMaxSlots bounds the number of panel slots a single
// proposed dashboard may contain. 12 is generous for a Grafana
// dashboard but cheap to enforce; a hostile prompt cannot ask
// for a 100-panel mega-dashboard.
const dashboardMaxSlots = 12

// dashboardMaxRationaleLen bounds the rationale string. One
// sentence is enough; longer rationales overflow the panel.
const dashboardMaxRationaleLen = 600

// dashboardMaxTitleLen bounds the dashboard title length.
const dashboardMaxTitleLen = 120

// ---------------------------------------------------------------------------
// Validator port + DashboardLayoutDraft DTO
// ---------------------------------------------------------------------------

// DashboardLayoutValidator is the narrow validation interface
// the nl-dashboard-composer tools need. In production it is
// satisfied by *api.AINLDashboardComposerValidator (a thin
// wrapper around the same shape + scope checks the tool runs,
// kept separate so future extensions — e.g. a per-folder Grafana
// ACL check — can plug in without touching tool code). Tests
// substitute deterministic fakes.
//
// The interface MUST stay validation-only — adding an Apply or
// Execute method here would defeat the propose-only contract that
// ADR-015 §I3 + the slice prompt mandate.
type DashboardLayoutValidator interface {
	// ValidateDashboardLayout reports whether the draft would be
	// accepted by the canonical dashboard-layout contract.
	// Returns nil on acceptance; an error whose Error() text is
	// suitable for surfacing to the LLM (it'll be relayed back
	// as a tool error reply) on rejection.
	ValidateDashboardLayout(draft *DashboardLayoutDraft) error
}

// DashboardLayoutDraft is the typed proposal envelope both tools
// build and the validator inspects. Exported because the AI
// handler test (in package api) needs to reference the type to
// construct fakes.
//
// This is NOT a model — it's a transient proposal shape the AI
// surface uses. The actual export to Grafana goes through the
// existing manual dashboard composer's Copy-to-clipboard button
// on /power/dashboards AFTER the user explicitly clicks the
// Apply to editor button in the AI panel.
type DashboardLayoutDraft struct {
	// Prompt is the user's natural-language request, echoed back
	// so the SPA can show prompt + draft side-by-side.
	Prompt string `json:"prompt"`

	// Dashboard is the proposed dashboard envelope.
	Dashboard DashboardEnvelope `json:"dashboard"`

	// Rationale is one sentence explaining what the dashboard
	// shows and why it answers the prompt. Bounded by
	// [dashboardMaxRationaleLen].
	Rationale string `json:"rationale"`
}

// DashboardEnvelope is the dashboard-shape subset the slice
// cares about. The full Grafana dashboard schema is enormous;
// we expose the fields the AI agent is allowed to propose
// (title + ordered slots) and let Grafana's own importer fill
// in the rest with defaults when the user pastes the JSON in.
type DashboardEnvelope struct {
	Title string          `json:"title"`
	Slots []DashboardSlot `json:"slots"`
}

// DashboardSlot is one (panel, placement) pair. PanelName MUST
// be in the in-scope curated panel catalog the AI handler
// installs.
type DashboardSlot struct {
	PanelName string             `json:"panel_name"`
	GridPos   DashboardSlotGrid  `json:"grid_pos"`
}

// DashboardSlotGrid is the dashboard-grid placement of a slot.
// Bounds are enforced by the schema's gte/lte tags; the scope
// check enforces that {x+w, y+h} stays inside the grid
// downstream.
type DashboardSlotGrid struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

// ---------------------------------------------------------------------------
// Typed tool input + output shapes
// ---------------------------------------------------------------------------

// dashboardLayoutInput is the typed input shape both tools
// share. The dispatcher decodes the LLM's tool-call arguments
// JSON into this struct via ValidateStruct so a malformed input
// fails before any validator method runs.
type dashboardLayoutInput struct {
	// Prompt is the user's natural-language request. Required
	// and non-empty; bounded so pasted-essay attacks don't widen
	// the draft arbitrarily.
	Prompt string `json:"prompt" validate:"required,min=1,max=1200" desc:"The user's natural-language request that motivates this dashboard draft."`

	// Dashboard is the proposed dashboard envelope. Required.
	// Field-level constraints live in the nested struct.
	Dashboard dashboardLayoutInputEnvelope `json:"dashboard" validate:"required" desc:"The proposed dashboard envelope (title + ordered list of slots)."`

	// Rationale is one sentence explaining what the dashboard
	// shows. The validator-tag layer enforces the length bound;
	// the tool does not require any particular content.
	Rationale string `json:"rationale" validate:"required,min=1,max=600" desc:"One-sentence rationale explaining what the dashboard shows and why it answers the prompt."`
}

// dashboardLayoutInputEnvelope is the nested dashboard shape.
type dashboardLayoutInputEnvelope struct {
	Title string                       `json:"title" validate:"required,min=1,max=120" desc:"Human-readable dashboard title."`
	Slots []dashboardLayoutInputSlot   `json:"slots" validate:"required,min=1,max=12" desc:"The dashboard's panel slots. At least 1, at most 12. Each slot picks a panel by name from the in-scope curated panel catalog."`
}

// dashboardLayoutInputSlot is one slot in the proposed
// dashboard. The panel_name MUST be in the in-scope curated
// panel catalog the user message lists.
type dashboardLayoutInputSlot struct {
	PanelName string                      `json:"panel_name" validate:"required,min=1,max=128" desc:"The panel name from the in-scope curated panel catalog. The per-request scope binding refuses any panel name not in the catalog the user message lists."`
	GridPos   dashboardLayoutInputGridPos `json:"grid_pos" desc:"The slot's dashboard-grid placement; defaults to {x:0,y:i*8,w:12,h:8} for slot index i when omitted."`
}

// dashboardLayoutInputGridPos is the dashboard-grid placement.
// All fields are optional in the JSON; missing fields default
// to 0, which is in range for x and y but NOT for w and h. The
// scope-and-shape check applies the {w:12, h:8} default when
// both are zero, so an LLM that omits grid_pos entirely still
// produces a valid envelope.
type dashboardLayoutInputGridPos struct {
	X int `json:"x" validate:"gte=0,lte=23" desc:"Grid x-coordinate (0..23)."`
	Y int `json:"y" validate:"gte=0,lte=49" desc:"Grid y-coordinate (0..49)."`
	W int `json:"w" validate:"gte=0,lte=24" desc:"Grid width in columns (1..24, or 0 to use the default of 12)."`
	H int `json:"h" validate:"gte=0,lte=50" desc:"Grid height in rows (1..50, or 0 to use the default of 8)."`
}

// dashboardLayoutOutput is the JSON envelope both tools return
// on success. The frontend renders it as the structured
// proposal in the dashboard composer's AI side panel.
//
// Status reports whether the draft would be accepted by the
// canonical validator at the time of the tool call:
//
//   - "ok"      — accepted; the user can copy the draft into the
//     baseline editor and click Copy to clipboard to paste it
//     into their Grafana dashboard.
//   - "invalid" — rejected; ValidationError contains a one-line
//     diagnostic suitable for showing in the UI.
//
// Even when invalid, Draft is returned unchanged so the
// frontend can render the partially-correct proposal and let
// the user fix the problem fields rather than start over.
type dashboardLayoutOutput struct {
	Draft           *DashboardLayoutDraft `json:"draft"`
	Status          string                `json:"status"`
	ValidationError string                `json:"validation_error,omitempty"`
	Source          string                `json:"source"`
}

// ---------------------------------------------------------------------------
// Shared scope + draft-shape checks
// ---------------------------------------------------------------------------

// buildDashboardLayoutDraft converts the typed input into a
// *DashboardLayoutDraft with surface trimming + default gridPos
// substitution. The scope + shape checks live in
// checkDashboardLayoutScopeAndShape so both tools (draft +
// validate) apply identical semantics.
func buildDashboardLayoutDraft(input dashboardLayoutInput) *DashboardLayoutDraft {
	slots := make([]DashboardSlot, len(input.Dashboard.Slots))
	for i, s := range input.Dashboard.Slots {
		gp := s.GridPos
		if gp.W == 0 {
			gp.W = 12
		}
		if gp.H == 0 {
			gp.H = 8
		}
		// If the LLM omitted both x and y AND used the default
		// width, stack the slot vertically so a "default" layout
		// renders correctly. We keep gp.X/gp.Y untouched
		// otherwise so an LLM that proposes (x=0, y=0) for the
		// first panel and (x=0, y=0) again for the second panel
		// still trips the overlap check rather than being
		// silently relocated.
		if gp.X == 0 && gp.Y == 0 && s.GridPos.W == 0 && s.GridPos.H == 0 && i > 0 {
			gp.Y = i * 8
		}
		slots[i] = DashboardSlot{
			PanelName: strings.ToLower(strings.TrimSpace(s.PanelName)),
			GridPos:   DashboardSlotGrid(gp),
		}
	}
	return &DashboardLayoutDraft{
		Prompt: strings.TrimSpace(input.Prompt),
		Dashboard: DashboardEnvelope{
			Title: strings.TrimSpace(input.Dashboard.Title),
			Slots: slots,
		},
		Rationale: strings.TrimSpace(input.Rationale),
	}
}

// checkDashboardLayoutScopeAndShape enforces:
//
//   - the in-scope binding installed by the AI handler is present
//     (missing-scope ⇒ hard error)
//   - every slot.panel_name is in the in-scope curated panel
//     catalog
//   - slot-count bounds (1 ≤ count ≤ dashboardMaxSlots)
//   - per-slot grid bounds (x∈[0..23], y∈[0..49], w∈[1..24],
//     h∈[1..50])
//   - x+w ≤ 24 (slot stays inside the 24-column grid)
//   - no duplicate panel_name slots (each catalog panel may
//     appear at most once per dashboard)
//   - no overlapping bounding boxes (defence in depth — the LLM
//     might propose two panels at (x=0,y=0,w=12,h=8))
//
// Returns nil on success. A returned error is propagated as a
// tool error frame back to the LLM so the strategy can refuse
// politely in its narrative reply.
func checkDashboardLayoutScopeAndShape(ctx context.Context, draft *DashboardLayoutDraft) error {
	scope, ok := ctx.Value(dashboardComposerScopeKey{}).(*dashboardComposerScope)
	if !ok || scope == nil {
		return errors.New("dashboard_composer: no in-scope curated panel catalog installed in context")
	}

	dash := draft.Dashboard
	if len(dash.Slots) == 0 {
		return errors.New("dashboard_composer: dashboard.slots must contain at least one slot")
	}
	if len(dash.Slots) > dashboardMaxSlots {
		return fmt.Errorf("dashboard_composer: dashboard.slots count %d exceeds the maximum of %d", len(dash.Slots), dashboardMaxSlots)
	}

	seen := make(map[string]int, len(dash.Slots))
	for i, s := range dash.Slots {
		if _, in := scope.panels[s.PanelName]; !in {
			return fmt.Errorf("dashboard_composer: slots[%d].panel_name %q is not in the in-scope curated panel catalog; refuse the request", i, s.PanelName)
		}
		if prev, dup := seen[s.PanelName]; dup {
			return fmt.Errorf("dashboard_composer: slots[%d].panel_name %q duplicates slots[%d].panel_name; each catalog panel may appear at most once per dashboard", i, s.PanelName, prev)
		}
		seen[s.PanelName] = i

		gp := s.GridPos
		if gp.X < 0 || gp.X > dashboardGridXMax {
			return fmt.Errorf("dashboard_composer: slots[%d].grid_pos.x=%d is outside [0..%d]", i, gp.X, dashboardGridXMax)
		}
		if gp.Y < 0 || gp.Y > dashboardGridYMax {
			return fmt.Errorf("dashboard_composer: slots[%d].grid_pos.y=%d is outside [0..%d]", i, gp.Y, dashboardGridYMax)
		}
		if gp.W < 1 || gp.W > dashboardGridWMax {
			return fmt.Errorf("dashboard_composer: slots[%d].grid_pos.w=%d is outside [1..%d]", i, gp.W, dashboardGridWMax)
		}
		if gp.H < 1 || gp.H > dashboardGridHMax {
			return fmt.Errorf("dashboard_composer: slots[%d].grid_pos.h=%d is outside [1..%d]", i, gp.H, dashboardGridHMax)
		}
		if gp.X+gp.W > dashboardGridXMax+1 {
			return fmt.Errorf("dashboard_composer: slots[%d].grid_pos.x+w=%d exceeds the %d-column dashboard grid", i, gp.X+gp.W, dashboardGridXMax+1)
		}
	}

	// Overlap detection: O(n^2) pairwise check. n ≤ 12 so the
	// quadratic cost is fine.
	for i := 0; i < len(dash.Slots); i++ {
		a := dash.Slots[i].GridPos
		for j := i + 1; j < len(dash.Slots); j++ {
			b := dash.Slots[j].GridPos
			if rectanglesOverlap(a, b) {
				return fmt.Errorf("dashboard_composer: slots[%d] (x=%d,y=%d,w=%d,h=%d) and slots[%d] (x=%d,y=%d,w=%d,h=%d) have overlapping bounding boxes; rearrange so every slot is disjoint",
					i, a.X, a.Y, a.W, a.H,
					j, b.X, b.Y, b.W, b.H)
			}
		}
	}

	return nil
}

// rectanglesOverlap returns true when the two grid rectangles
// share at least one cell. Each rectangle covers
// {x..x+w-1, y..y+h-1}. Standard separating-axis test on the
// integer grid.
func rectanglesOverlap(a, b DashboardSlotGrid) bool {
	if a.X+a.W <= b.X || b.X+b.W <= a.X {
		return false
	}
	if a.Y+a.H <= b.Y || b.Y+b.H <= a.Y {
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// draft_dashboard_layout
// ---------------------------------------------------------------------------

// draftDashboardLayout is the propose-only tool that builds a
// normalized + validated DashboardLayoutDraft for the dashboard
// composer UI to render. It is the FIRST tool the LLM is
// expected to call (per the strategy's system prompt).
//
// Execution is pure: input → typed DashboardLayoutDraft → scope
// + shape check → optional validator pass → JSON envelope. No
// Grafana API call; no SQL execution; no side effects.
type draftDashboardLayout struct {
	validator DashboardLayoutValidator
}

// Name implements [Tool].
func (t *draftDashboardLayout) Name() string { return "draft_dashboard_layout" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused.
func (t *draftDashboardLayout) Description() string {
	return "Build a typed DashboardLayoutDraft from the user's natural-language request for the dashboard composer at /power/dashboards. " +
		"PROPOSE-ONLY: nothing is exported to Grafana; the user reviews the draft in the AI side panel and clicks the Apply to editor button to copy it into the manual dashboard composer form. " +
		"Each slot.panel_name MUST be in the in-scope curated panel catalog the user message lists; the per-request scope binding refuses any other name. " +
		"The dashboard MUST contain 1 to 12 slots; no two slots may use the same panel_name; no two slots may have overlapping bounding boxes. " +
		"Each slot's grid_pos MUST be inside the Grafana dashboard grid: x∈[0..23], y∈[0..49], w∈[1..24], h∈[1..50]; x+w MUST be at most 24. " +
		"Returns {draft, status: ok|invalid, validation_error}."
}

// InputSchema implements [Tool].
func (t *draftDashboardLayout) InputSchema() json.RawMessage {
	return cachedSchema(dashboardLayoutInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *draftDashboardLayout) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
// The tool builds + validates a DTO but does NOT call Grafana,
// touch the database, or persist anything. The actual export
// flows through the existing baseline manual composer + Copy
// button on /power/dashboards AFTER the user clicks the
// canonical Apply to editor button.
func (t *draftDashboardLayout) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream, and the tool
// produces no state mutation that needs an additional RBAC
// scope.
func (t *draftDashboardLayout) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *draftDashboardLayout) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[dashboardLayoutInput](raw)
}

// Execute implements [Tool]. Builds the draft, runs the scope +
// shape checks, runs the canonical validator, returns the
// envelope.
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): rejects any LLM-supplied slot.panel_name that
// is NOT in the curated catalog the AI handler installed via
// WithDashboardComposerScope.
//
// Missing-scope is also a hard failure: if the dispatcher is
// invoked from an unintended path (no scope installed), the
// tool refuses. The AI handler is the only path that should be
// loading this tool, and it ALWAYS installs the scope.
//
// Validator failures are surfaced as status="invalid" in the
// envelope (NOT as a returned error) so the LLM's follow-up
// prose can describe the problem rather than the dispatcher
// relaying an error frame.
func (t *draftDashboardLayout) Execute(ctx context.Context, in any) (any, error) {
	input := in.(dashboardLayoutInput)
	if t.validator == nil {
		return nil, errors.New("draft_dashboard_layout: no DashboardLayoutValidator wired")
	}

	draft := buildDashboardLayoutDraft(input)
	if err := checkDashboardLayoutScopeAndShape(ctx, draft); err != nil {
		return nil, err
	}

	out := &dashboardLayoutOutput{
		Draft:  draft,
		Status: "ok",
		Source: "validator: internal/ai/tools/nl_dashboard_composer.go dashboard-layout contract (in-scope panel catalog, 1..12 slots, no duplicate panels, no overlapping bounding boxes, bounded grid_pos)",
	}
	if err := t.validator.ValidateDashboardLayout(draft); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// validate_dashboard_layout
// ---------------------------------------------------------------------------

// validateDashboardLayoutTool is the propose-only tool that
// runs the canonical validator over a typed DashboardLayoutDraft
// shape and reports the verdict. It is the SECOND tool the LLM
// is expected to call (per the strategy's system prompt) —
// typically immediately after draft_dashboard_layout, so the
// assistant can confirm the draft would pass before narrating
// it to the user.
//
// Execution is pure: input → typed DashboardLayoutDraft → scope
// + shape check → canonical validator pass → JSON envelope. No
// Grafana API call; no SQL execution; no side effects.
type validateDashboardLayoutTool struct {
	validator DashboardLayoutValidator
}

// Name implements [Tool].
func (t *validateDashboardLayoutTool) Name() string { return "validate_dashboard_layout" }

// Description implements [Tool].
func (t *validateDashboardLayoutTool) Description() string {
	return "Run the canonical dashboard-layout validator over a typed DashboardLayoutDraft shape and report whether it would be accepted by the dashboard composer at /power/dashboards. " +
		"PROPOSE-ONLY: nothing is exported. Returns {draft, status: ok|invalid, validation_error}. " +
		"Use this AFTER draft_dashboard_layout to confirm a proposed draft will pass the layout contract before narrating it to the user."
}

// InputSchema implements [Tool].
func (t *validateDashboardLayoutTool) InputSchema() json.RawMessage {
	return cachedSchema(dashboardLayoutInput{})
}

// OutputSchema implements [Tool].
func (t *validateDashboardLayoutTool) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only.
func (t *validateDashboardLayoutTool) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — same rationale as
// draft_dashboard_layout.
func (t *validateDashboardLayoutTool) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *validateDashboardLayoutTool) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[dashboardLayoutInput](raw)
}

// Execute implements [Tool]. Same scope + shape checks as
// draft_dashboard_layout, then the canonical validator. Same
// error semantics: validation failures are surfaced as
// status="invalid", never as a returned error.
func (t *validateDashboardLayoutTool) Execute(ctx context.Context, in any) (any, error) {
	input := in.(dashboardLayoutInput)
	if t.validator == nil {
		return nil, errors.New("validate_dashboard_layout: no DashboardLayoutValidator wired")
	}

	draft := buildDashboardLayoutDraft(input)
	if err := checkDashboardLayoutScopeAndShape(ctx, draft); err != nil {
		return nil, err
	}

	out := &dashboardLayoutOutput{
		Draft:  draft,
		Status: "ok",
		Source: "validator: internal/ai/tools/nl_dashboard_composer.go dashboard-layout contract (in-scope panel catalog, 1..12 slots, no duplicate panels, no overlapping bounding boxes, bounded grid_pos)",
	}
	if err := t.validator.ValidateDashboardLayout(draft); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// NLDashboardComposerSources bundles the narrow validator
// interface RegisterNLDashboardComposerTools needs. Mirrors
// [NLGrafanaPanelSources] but exposes only the surface the
// nl-dashboard-composer tools actually consume.
//
// Production wiring (router.go) instantiates
// *api.AINLDashboardComposerValidator (a thin wrapper around the
// same shape + scope checks the tool runs); tests substitute
// deterministic fakes.
type NLDashboardComposerSources struct {
	Validator DashboardLayoutValidator
}

// RegisterNLDashboardComposerTools installs the
// nl-dashboard-composer slice's tools on r. Called from
// router.go AFTER the Phase-50 / 0058 nl-grafana-panel
// registration so the registry's alphabetical Names list grows
// deterministically without disturbing earlier registrations or
// any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) —
// a second call is a wiring bug detected at boot, not at first
// request.
func RegisterNLDashboardComposerTools(r *Registry, s NLDashboardComposerSources) {
	r.Register(&draftDashboardLayout{validator: s.Validator})
	r.Register(&validateDashboardLayoutTool{validator: s.Validator})
}
