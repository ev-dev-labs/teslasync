// Phase-50 / 0058 — PU2 Natural-language Grafana panel.
//
// nl_grafana_panel.go ships TWO new propose-only tools:
//
//   - `draft_grafana_panel`    — accept a typed GrafanaPanelDraft
//                                shape (prompt, panel, rationale)
//                                and return a normalized + validated
//                                draft the frontend can render for
//                                human review in the AI side panel
//                                of the Grafana panel-builder page.
//
//   - `validate_grafana_panel` — accept the same typed shape and
//                                return whether it would be
//                                accepted by the canonical
//                                Grafana-panel contract, with
//                                field-level error messages on
//                                rejection.
//
// Both tools are PROPOSE-ONLY: they construct or validate a
// GrafanaPanelDraft DTO but do NOT call the Grafana API, execute
// any SQL or PromQL, or persist anything. The dispatcher's
// deny-all confirm gate is therefore never triggered — defence in
// depth in case a future edit accidentally adds a write tool. The
// actual export flows through the existing manual Grafana panel
// JSON editor's Copy-to-clipboard button on /power/grafana AFTER
// the user explicitly clicks the Apply to editor button in the AI
// panel; the LLM has no tool that pushes the panel.
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the AI HTTP handler installs the in-scope curated
// catalog (panel-type whitelist, datasource-type whitelist, table
// whitelist) in ctx via WithGrafanaPanelScope BEFORE the dispatcher
// invokes the tool. Both tools' Execute REJECT any LLM-supplied
// panel.type, datasource.type, or postgres-target rawSql table
// reference that is NOT in the snapshot. This blocks a prompt-
// injection attack where an attacker pastes "select * from secrets"
// into the prompt — even if the LLM tries to call the tool with
// an out-of-scope table or panel type, the scope check refuses
// the call before any out-of-catalog proposal can reach the SPA.
//
// Design constraints (from the slice prompt):
//
//   - "Route every mutation proposal through F4 tools and existing
//     typed DTO validation. The LLM never writes raw SQL and never
//     bypasses existing handlers." → both tools delegate the final
//     GrafanaPanelDraft shape check to a narrow [GrafanaPanelValidator]
//     port. The tool ALSO enforces the read-only-SQL contract for
//     postgres targets (re-using the same SELECT/WITH-only +
//     deny-DML/DDL + table-scope checks the nl-sql-playground tool
//     uses) before any validator method runs.
//
//   - "no duplicate write paths" → the toolkit does NOT include an
//     `apply_grafana_panel`, `push_grafana_panel`, or any other
//     write tool. The frontend renders the draft and the user
//     clicks the canonical baseline Copy-to-clipboard button on
//     the Grafana panel-builder page, which is what allows them to
//     paste it into their own Grafana dashboard editor.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// ---------------------------------------------------------------------------
// Per-request Grafana panel scope binding
// ---------------------------------------------------------------------------

// grafanaPanelScope is the value stored in context. Holds the
// in-scope panel-type, datasource-type, and table name sets for
// the current request. A single scope value lets the tool make
// O(1) lookups against each whitelist, and lets missing-scope (no
// value installed) be distinguished from empty-scope (a degenerate
// but legal state) at the type level.
type grafanaPanelScope struct {
	panelTypes      map[string]struct{}
	datasourceTypes map[string]struct{}
	tables          map[string]struct{}
}

// grafanaPanelScopeKey is the unexported context-key type used to
// carry the in-scope snapshot through the dispatcher to the tool.
// A per-package unexported type prevents accidental key collisions
// with any other context value in the request lifetime.
type grafanaPanelScopeKey struct{}

// WithGrafanaPanelScope returns ctx with the panel-type +
// datasource-type + table-name snapshots installed as the in-scope
// curated catalog for this request. Called by the AI HTTP handler
// AFTER it loads the catalog from the canonical
// [AINLGrafanaPanelCatalogSource] and BEFORE the dispatcher.Run
// loop is started. The dispatcher then propagates ctx unchanged
// through every Tool.Execute call.
//
// Each input slice is defensively copied into a private set so a
// later mutation by the caller cannot retroactively widen or
// narrow the scope a tool already consulted. Names are normalised
// to lower-case so case-insensitive comparisons work uniformly
// downstream. nil-safe: passing nil for any slice installs an
// empty scope for that dimension (the tool will refuse every
// member of that dimension).
//
// Exported so internal/api can install the scope without depending
// on tool-internal types.
func WithGrafanaPanelScope(ctx context.Context, panelTypes, datasourceTypes, tables []string) context.Context {
	scope := &grafanaPanelScope{
		panelTypes:      tableNamesToSet(panelTypes),
		datasourceTypes: tableNamesToSet(datasourceTypes),
		tables:          tableNamesToSet(tables),
	}
	return context.WithValue(ctx, grafanaPanelScopeKey{}, scope)
}

// GrafanaPanelScopeFromContext returns the in-scope snapshots and
// true when one is installed, or (nil, nil, nil, false) when no
// scope is installed. Tools that are scope-bound MUST treat the
// missing-scope case as a hard failure — the AI handler ALWAYS
// installs the scope, so an absent scope means the dispatcher was
// invoked from an unintended path and the call must be refused.
//
// Returns sorted defensive copies of the names (callers may mutate
// freely).
//
// Exported for symmetry with WithGrafanaPanelScope and so unit
// tests in other packages can inspect what the AI handler installed.
func GrafanaPanelScopeFromContext(ctx context.Context) (panelTypes, datasourceTypes, tables []string, ok bool) {
	scope, ok := ctx.Value(grafanaPanelScopeKey{}).(*grafanaPanelScope)
	if !ok || scope == nil {
		return nil, nil, nil, false
	}
	return tableNamesSetToSortedSlice(scope.panelTypes),
		tableNamesSetToSortedSlice(scope.datasourceTypes),
		tableNamesSetToSortedSlice(scope.tables),
		true
}

// ---------------------------------------------------------------------------
// Grafana panel constants
// ---------------------------------------------------------------------------

// grafanaPanelGridXMax is the rightmost x-coordinate Grafana
// allows on a 24-column dashboard grid (x ∈ [0..23]).
const grafanaPanelGridXMax = 23

// grafanaPanelGridYMax is the practical upper bound on the panel
// y-coordinate. Grafana itself is unbounded but the AI surface
// caps proposals so a hostile prompt cannot ask for a panel placed
// at y=999999 to confuse the rendering layer downstream.
const grafanaPanelGridYMax = 49

// grafanaPanelGridWMax is the maximum panel width (Grafana's
// 24-column grid).
const grafanaPanelGridWMax = 24

// grafanaPanelGridHMax is the practical upper bound on the panel
// height. Same reasoning as [grafanaPanelGridYMax].
const grafanaPanelGridHMax = 50

// grafanaPanelMaxRationaleLen bounds the rationale string. One
// sentence is enough; longer rationales overflow the panel.
const grafanaPanelMaxRationaleLen = 600

// grafanaPanelMaxPromqlLen bounds the prometheus expr string.
const grafanaPanelMaxPromqlLen = 2000

// ---------------------------------------------------------------------------
// Validator port + GrafanaPanelDraft DTO
// ---------------------------------------------------------------------------

// GrafanaPanelValidator is the narrow validation interface the
// nl-grafana-panel tools need. In production it is satisfied by
// *api.AINLGrafanaValidator (a thin wrapper around the same shape
// + scope checks the tool runs, kept separate so future extensions
// — e.g. a per-folder Grafana ACL check — can plug in without
// touching tool code). Tests substitute deterministic fakes.
//
// The interface MUST stay validation-only — adding an Apply or
// Execute method here would defeat the propose-only contract that
// ADR-015 §I3 + the slice prompt mandate.
type GrafanaPanelValidator interface {
	// ValidateGrafanaPanel reports whether the draft would be
	// accepted by the canonical Grafana-panel contract. Returns
	// nil on acceptance; an error whose Error() text is suitable
	// for surfacing to the LLM (it'll be relayed back as a tool
	// error reply) on rejection.
	ValidateGrafanaPanel(draft *GrafanaPanelDraft) error
}

// GrafanaPanelDraft is the typed proposal envelope both tools
// build and the validator inspects. Exported because the AI
// handler test (in package api) needs to reference the type to
// construct fakes.
//
// This is NOT a model — it's a transient proposal shape the AI
// surface uses. The actual export to Grafana goes through the
// existing manual Grafana panel JSON editor's Copy-to-clipboard
// button on /power/grafana AFTER the user explicitly clicks the
// Apply to editor button in the AI panel.
type GrafanaPanelDraft struct {
	// Prompt is the user's natural-language request, echoed back
	// so the SPA can show prompt + draft side-by-side.
	Prompt string `json:"prompt"`

	// Panel is the proposed Grafana panel JSON envelope.
	Panel GrafanaPanelEnvelope `json:"panel"`

	// Rationale is one sentence explaining what the panel does
	// and why it answers the prompt. Bounded by
	// [grafanaPanelMaxRationaleLen].
	Rationale string `json:"rationale"`

	// ReferencedTables is the deduplicated lower-cased list of
	// table names extracted from postgres targets' rawSql FROM /
	// JOIN clauses. Populated by the tool, NOT the LLM — the SPA
	// renders it under the panel preview so the user can confirm
	// the proposal stays in the curated catalog.
	ReferencedTables []string `json:"referenced_tables"`
}

// GrafanaPanelEnvelope is the panel-shape subset of Grafana's
// JSON-model the slice cares about. The full Grafana panel schema
// is enormous; we expose the fields the AI agent is allowed to
// propose and let Grafana's own importer fill in the rest with
// defaults when the user pastes the JSON in.
type GrafanaPanelEnvelope struct {
	Title      string                 `json:"title"`
	Type       string                 `json:"type"`
	Datasource GrafanaDatasourceRef   `json:"datasource"`
	Targets    []GrafanaPanelTarget   `json:"targets"`
	GridPos    GrafanaPanelGridPos    `json:"grid_pos"`
}

// GrafanaDatasourceRef is the {type, uid} reference Grafana uses
// to bind a panel to its datasource.
type GrafanaDatasourceRef struct {
	Type string `json:"type"`
	UID  string `json:"uid"`
}

// GrafanaPanelTarget is the per-query target shape inside a
// Grafana panel. For postgres targets, RawSQL is required and
// Expr MUST be empty. For prometheus targets, Expr is required
// and RawSQL MUST be empty.
type GrafanaPanelTarget struct {
	RefID  string `json:"ref_id"`
	RawSQL string `json:"raw_sql,omitempty"`
	Expr   string `json:"expr,omitempty"`
	Format string `json:"format,omitempty"`
}

// GrafanaPanelGridPos is the dashboard-grid placement of the
// panel. Bounds are enforced by the schema's gte/lte tags; the
// scope check enforces that {x+w, y+h} stays inside the grid
// downstream.
type GrafanaPanelGridPos struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

// ---------------------------------------------------------------------------
// Typed tool input + output shapes
// ---------------------------------------------------------------------------

// grafanaPanelInput is the typed input shape both tools share.
// The dispatcher decodes the LLM's tool-call arguments JSON into
// this struct via ValidateStruct so a malformed input fails
// before any validator method runs.
type grafanaPanelInput struct {
	// Prompt is the user's natural-language request. Required
	// and non-empty; bounded so pasted-essay attacks don't widen
	// the panel arbitrarily.
	Prompt string `json:"prompt" validate:"required,min=1,max=1200" desc:"The user's natural-language request that motivates this panel draft."`

	// Panel is the proposed Grafana panel envelope. Required.
	// Field-level constraints live in the nested struct.
	Panel grafanaPanelInputEnvelope `json:"panel" validate:"required" desc:"The proposed Grafana panel envelope (title, type, datasource, targets, grid_pos)."`

	// Rationale is one sentence explaining what the panel does.
	// The validator-tag layer enforces the length bound; the
	// tool does not require any particular content.
	Rationale string `json:"rationale" validate:"required,min=1,max=600" desc:"One-sentence rationale explaining what the panel does and why it answers the prompt."`
}

// grafanaPanelInputEnvelope is the nested panel shape. Fields
// follow Grafana's JSON-model naming so the JSON the LLM emits is
// what the user pastes verbatim into Grafana.
type grafanaPanelInputEnvelope struct {
	Title      string                          `json:"title" validate:"required,min=1,max=120" desc:"Human-readable panel title."`
	Type       string                          `json:"type" validate:"required,min=1,max=64" desc:"Grafana panel type (e.g. timeseries, stat, gauge, table). MUST be in the in-scope curated panel-type catalog the user message lists."`
	Datasource grafanaPanelInputDatasource     `json:"datasource" validate:"required" desc:"The Grafana datasource reference."`
	Targets    []grafanaPanelInputTarget       `json:"targets" validate:"required,min=1,max=8" desc:"The panel's query targets. At least 1, at most 8."`
	GridPos    grafanaPanelInputGridPos        `json:"grid_pos" desc:"The panel's dashboard-grid placement; defaults to {x:0,y:0,w:12,h:8} when omitted."`
}

// grafanaPanelInputDatasource is the datasource reference the LLM
// emits. Type MUST be in the in-scope curated datasource-type
// catalog; UID is opaque text and is not constrained beyond being
// non-empty.
type grafanaPanelInputDatasource struct {
	Type string `json:"type" validate:"required,min=1,max=64" desc:"Datasource type (e.g. postgres, prometheus). MUST be in the in-scope curated datasource-type catalog the user message lists."`
	UID  string `json:"uid" validate:"required,min=1,max=128" desc:"Datasource UID (Grafana's per-install identifier for the configured datasource instance)."`
}

// grafanaPanelInputTarget is one query target. The tool's
// scope-and-shape check enforces (RawSQL set ⇔ datasource is
// postgres) and (Expr set ⇔ datasource is prometheus); the
// validator-tag layer cannot express that conditional rule.
type grafanaPanelInputTarget struct {
	RefID  string `json:"ref_id" validate:"required,min=1,max=8" desc:"Per-target reference letter (Grafana uses 'A', 'B', ...)."`
	RawSQL string `json:"raw_sql,omitempty" validate:"omitempty,max=4000" desc:"Postgres rawSql for this target. MUST start with SELECT or WITH; single statement only (no semicolons); MUST NOT contain INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE, VACUUM, COPY, CALL, DO, MERGE, or EXECUTE."`
	Expr   string `json:"expr,omitempty" validate:"omitempty,max=2000" desc:"Prometheus PromQL expression for this target. Single expression only (no semicolons)."`
	Format string `json:"format,omitempty" validate:"omitempty,oneof=time_series table" desc:"Result format hint (time_series or table)."`
}

// grafanaPanelInputGridPos is the dashboard-grid placement. All
// fields are optional in the JSON; missing fields default to 0,
// which is in range for x and y but NOT for w and h. The scope-
// and-shape check applies the {w:12, h:8} default when both are
// zero, so an LLM that omits grid_pos entirely still produces a
// valid envelope.
type grafanaPanelInputGridPos struct {
	X int `json:"x" validate:"gte=0,lte=23" desc:"Grid x-coordinate (0..23)."`
	Y int `json:"y" validate:"gte=0,lte=49" desc:"Grid y-coordinate (0..49)."`
	W int `json:"w" validate:"gte=0,lte=24" desc:"Grid width in columns (1..24, or 0 to use the default of 12)."`
	H int `json:"h" validate:"gte=0,lte=50" desc:"Grid height in rows (1..50, or 0 to use the default of 8)."`
}

// grafanaPanelOutput is the JSON envelope both tools return on
// success. The frontend renders it as the structured proposal in
// the Grafana panel-builder's AI side panel.
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
// Even when invalid, Draft is returned unchanged so the frontend
// can render the partially-correct proposal and let the user fix
// the problem fields rather than start over.
type grafanaPanelOutput struct {
	Draft           *GrafanaPanelDraft `json:"draft"`
	Status          string             `json:"status"`
	ValidationError string             `json:"validation_error,omitempty"`
	Source          string             `json:"source"`
}

// ---------------------------------------------------------------------------
// Shared scope + draft-shape checks
// ---------------------------------------------------------------------------

// buildGrafanaPanelDraft converts the typed input into a
// *GrafanaPanelDraft with surface trimming + default gridPos
// substitution + referenced-table extraction. The scope + shape
// checks live in checkGrafanaPanelScopeAndShape so both tools
// (draft + validate) apply identical semantics.
func buildGrafanaPanelDraft(input grafanaPanelInput) *GrafanaPanelDraft {
	gp := input.Panel.GridPos
	if gp.W == 0 {
		gp.W = 12
	}
	if gp.H == 0 {
		gp.H = 8
	}

	targets := make([]GrafanaPanelTarget, len(input.Panel.Targets))
	tablesSeen := make(map[string]struct{})
	for i, t := range input.Panel.Targets {
		raw := strings.TrimSpace(t.RawSQL)
		expr := strings.TrimSpace(t.Expr)
		targets[i] = GrafanaPanelTarget{
			RefID:  strings.TrimSpace(t.RefID),
			RawSQL: raw,
			Expr:   expr,
			Format: strings.TrimSpace(t.Format),
		}
		if raw != "" {
			for _, tbl := range extractReferencedTables(raw) {
				tablesSeen[tbl] = struct{}{}
			}
		}
	}
	tables := make([]string, 0, len(tablesSeen))
	for k := range tablesSeen {
		tables = append(tables, k)
	}
	sort.Strings(tables)

	return &GrafanaPanelDraft{
		Prompt: strings.TrimSpace(input.Prompt),
		Panel: GrafanaPanelEnvelope{
			Title: strings.TrimSpace(input.Panel.Title),
			Type:  strings.ToLower(strings.TrimSpace(input.Panel.Type)),
			Datasource: GrafanaDatasourceRef{
				Type: strings.ToLower(strings.TrimSpace(input.Panel.Datasource.Type)),
				UID:  strings.TrimSpace(input.Panel.Datasource.UID),
			},
			Targets: targets,
			GridPos: GrafanaPanelGridPos(gp),
		},
		Rationale:        strings.TrimSpace(input.Rationale),
		ReferencedTables: tables,
	}
}

// checkGrafanaPanelScopeAndShape enforces:
//
//   - the in-scope binding installed by the AI handler is present
//     (missing-scope ⇒ hard error)
//   - the panel.type is in the in-scope curated panel-type catalog
//   - the datasource.type is in the in-scope curated
//     datasource-type catalog
//   - per-target shape: postgres ⇒ rawSql required + expr forbidden;
//     prometheus ⇒ expr required + rawSql forbidden
//   - postgres rawSql passes the same read-only contract the
//     nl-sql-playground tool enforces (SELECT/WITH-only,
//     single-statement, no DML/DDL keywords, every referenced
//     table in the in-scope curated catalog)
//   - prometheus expr is non-empty + length-bounded + no semicolons
//   - gridPos stays inside the dashboard grid bounds
//
// Returns nil on success. A returned error is propagated as a tool
// error frame back to the LLM so the strategy can refuse politely
// in its narrative reply.
func checkGrafanaPanelScopeAndShape(ctx context.Context, draft *GrafanaPanelDraft) error {
	scope, ok := ctx.Value(grafanaPanelScopeKey{}).(*grafanaPanelScope)
	if !ok || scope == nil {
		return errors.New("grafana_panel: no in-scope curated catalog installed in context")
	}

	panel := draft.Panel
	if _, in := scope.panelTypes[panel.Type]; !in {
		return fmt.Errorf("grafana_panel: panel type %q is not in the in-scope curated panel-type catalog; refuse the request", panel.Type)
	}
	if _, in := scope.datasourceTypes[panel.Datasource.Type]; !in {
		return fmt.Errorf("grafana_panel: datasource type %q is not in the in-scope curated datasource-type catalog; refuse the request", panel.Datasource.Type)
	}

	if len(panel.Targets) == 0 {
		return errors.New("grafana_panel: panel.targets must contain at least one target")
	}

	for i, t := range panel.Targets {
		switch panel.Datasource.Type {
		case "postgres":
			if t.Expr != "" {
				return fmt.Errorf("grafana_panel: targets[%d].expr must be empty for a postgres datasource (use raw_sql instead)", i)
			}
			if t.RawSQL == "" {
				return fmt.Errorf("grafana_panel: targets[%d].raw_sql is required for a postgres datasource", i)
			}
			if err := checkPostgresTargetSQL(scope, i, t.RawSQL); err != nil {
				return err
			}
		case "prometheus":
			if t.RawSQL != "" {
				return fmt.Errorf("grafana_panel: targets[%d].raw_sql must be empty for a prometheus datasource (use expr instead)", i)
			}
			if t.Expr == "" {
				return fmt.Errorf("grafana_panel: targets[%d].expr is required for a prometheus datasource", i)
			}
			if len(t.Expr) > grafanaPanelMaxPromqlLen {
				return fmt.Errorf("grafana_panel: targets[%d].expr length %d exceeds the %d-char maximum",
					i, len(t.Expr), grafanaPanelMaxPromqlLen)
			}
			if strings.Contains(t.Expr, ";") {
				return fmt.Errorf("grafana_panel: targets[%d].expr contains a semicolon; only a single PromQL expression is allowed", i)
			}
		default:
			return fmt.Errorf("grafana_panel: targets[%d] has no validated shape for datasource type %q", i, panel.Datasource.Type)
		}
	}

	gp := panel.GridPos
	if gp.X < 0 || gp.X > grafanaPanelGridXMax {
		return fmt.Errorf("grafana_panel: grid_pos.x=%d is outside [0..%d]", gp.X, grafanaPanelGridXMax)
	}
	if gp.Y < 0 || gp.Y > grafanaPanelGridYMax {
		return fmt.Errorf("grafana_panel: grid_pos.y=%d is outside [0..%d]", gp.Y, grafanaPanelGridYMax)
	}
	if gp.W < 1 || gp.W > grafanaPanelGridWMax {
		return fmt.Errorf("grafana_panel: grid_pos.w=%d is outside [1..%d]", gp.W, grafanaPanelGridWMax)
	}
	if gp.H < 1 || gp.H > grafanaPanelGridHMax {
		return fmt.Errorf("grafana_panel: grid_pos.h=%d is outside [1..%d]", gp.H, grafanaPanelGridHMax)
	}
	if gp.X+gp.W > grafanaPanelGridXMax+1 {
		return fmt.Errorf("grafana_panel: grid_pos.x+w=%d exceeds the %d-column dashboard grid", gp.X+gp.W, grafanaPanelGridXMax+1)
	}

	return nil
}

// checkPostgresTargetSQL re-uses the same read-only contract the
// nl-sql-playground tool enforces: SELECT/WITH-only,
// single-statement, no DML/DDL keywords, every referenced table in
// the in-scope curated catalog. Re-using the same package-private
// regexes guarantees the two slices stay in lock-step on what
// counts as a safe read-only postgres query.
func checkPostgresTargetSQL(scope *grafanaPanelScope, i int, sql string) error {
	if !readonlySQLPrefixRe.MatchString(sql) {
		return fmt.Errorf("grafana_panel: targets[%d].raw_sql must start with SELECT or WITH (the panel-builder is read-only)", i)
	}
	if strings.Contains(sql, ";") {
		return fmt.Errorf("grafana_panel: targets[%d].raw_sql contains a semicolon; only a single read-only statement is allowed", i)
	}
	if m := readonlySQLKeywordRe.FindString(sql); m != "" {
		return fmt.Errorf("grafana_panel: targets[%d].raw_sql contains forbidden keyword %q; the panel-builder is read-only", i, strings.ToUpper(m))
	}
	for _, tbl := range extractReferencedTables(sql) {
		// Strip any schema qualifier: `public.drives` matches
		// either `public.drives` or `drives` in the scope.
		candidates := []string{tbl}
		if dot := strings.LastIndex(tbl, "."); dot >= 0 && dot+1 < len(tbl) {
			candidates = append(candidates, tbl[dot+1:])
		}
		matched := false
		for _, c := range candidates {
			if _, in := scope.tables[c]; in {
				matched = true
				break
			}
		}
		if !matched {
			return fmt.Errorf("grafana_panel: targets[%d] references table %q which is not in the in-scope curated catalog; refuse the request", i, tbl)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// draft_grafana_panel
// ---------------------------------------------------------------------------

// draftGrafanaPanel is the propose-only tool that builds a
// normalized + validated GrafanaPanelDraft for the panel-builder
// UI to render. It is the FIRST tool the LLM is expected to call
// (per the strategy's system prompt).
//
// Execution is pure: input → typed GrafanaPanelDraft → scope +
// shape check → optional validator pass → JSON envelope. No
// Grafana API call; no SQL execution; no side effects.
type draftGrafanaPanel struct {
	validator GrafanaPanelValidator
}

// Name implements [Tool].
func (t *draftGrafanaPanel) Name() string { return "draft_grafana_panel" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, with the deny-list
// appended so the model picks postgres rawSql / prometheus expr
// deterministically.
func (t *draftGrafanaPanel) Description() string {
	return "Build a typed GrafanaPanelDraft from the user's natural-language request for the Grafana panel-builder at /power/grafana. " +
		"PROPOSE-ONLY: nothing is exported to Grafana; the user reviews the draft in the AI side panel and clicks the Apply to editor button to copy it into the manual Grafana panel JSON editor. " +
		"panel.type MUST be in the in-scope curated panel-type catalog the user message lists. " +
		"panel.datasource.type MUST be in the in-scope curated datasource-type catalog. " +
		"For postgres targets: raw_sql MUST start with SELECT or WITH (case-insensitive); single statement only (no semicolons); MUST NOT contain ANY of: " + strings.Join(readonlySQLForbiddenKeywords, ", ") + "; every referenced table MUST appear in the in-scope curated table catalog. " +
		"For prometheus targets: expr MUST be a single non-empty PromQL expression (no semicolons). " +
		"grid_pos MUST be inside the dashboard grid: x∈[0..23], y∈[0..49], w∈[1..24], h∈[1..50]. " +
		"Returns {draft, status: ok|invalid, validation_error}."
}

// InputSchema implements [Tool].
func (t *draftGrafanaPanel) InputSchema() json.RawMessage {
	return cachedSchema(grafanaPanelInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *draftGrafanaPanel) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
// The tool builds + validates a DTO but does NOT call Grafana,
// touch the database, or persist anything. The actual export
// flows through the existing baseline manual JSON editor + Copy
// button on /power/grafana AFTER the user clicks the canonical
// Apply to editor button.
func (t *draftGrafanaPanel) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream, and the tool
// produces no state mutation that needs an additional RBAC scope.
func (t *draftGrafanaPanel) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *draftGrafanaPanel) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[grafanaPanelInput](raw)
}

// Execute implements [Tool]. Builds the draft, runs the scope +
// shape checks, runs the canonical validator, returns the
// envelope.
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): rejects any LLM-supplied panel.type,
// datasource.type, or postgres-target table reference that is NOT
// in the curated catalog the AI handler installed via
// WithGrafanaPanelScope.
//
// Missing-scope is also a hard failure: if the dispatcher is
// invoked from an unintended path (no scope installed), the tool
// refuses. The AI handler is the only path that should be loading
// this tool, and it ALWAYS installs the scope.
//
// Validator failures are surfaced as status="invalid" in the
// envelope (NOT as a returned error) so the LLM's follow-up prose
// can describe the problem rather than the dispatcher relaying an
// error frame.
func (t *draftGrafanaPanel) Execute(ctx context.Context, in any) (any, error) {
	input := in.(grafanaPanelInput)
	if t.validator == nil {
		return nil, errors.New("draft_grafana_panel: no GrafanaPanelValidator wired")
	}

	draft := buildGrafanaPanelDraft(input)
	if err := checkGrafanaPanelScopeAndShape(ctx, draft); err != nil {
		return nil, err
	}

	out := &grafanaPanelOutput{
		Draft:  draft,
		Status: "ok",
		Source: "validator: internal/ai/tools/nl_grafana_panel.go grafana-panel contract (in-scope panel/datasource catalogs, read-only postgres SQL, single-statement prometheus expr, bounded grid_pos)",
	}
	if err := t.validator.ValidateGrafanaPanel(draft); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// validate_grafana_panel
// ---------------------------------------------------------------------------

// validateGrafanaPanelTool is the propose-only tool that runs the
// canonical validator over a typed GrafanaPanelDraft shape and
// reports the verdict. It is the SECOND tool the LLM is expected
// to call (per the strategy's system prompt) — typically
// immediately after draft_grafana_panel, so the assistant can
// confirm the draft would pass before narrating it to the user.
//
// Execution is pure: input → typed GrafanaPanelDraft → scope +
// shape check → canonical validator pass → JSON envelope. No
// Grafana API call; no SQL execution; no side effects.
type validateGrafanaPanelTool struct {
	validator GrafanaPanelValidator
}

// Name implements [Tool].
func (t *validateGrafanaPanelTool) Name() string { return "validate_grafana_panel" }

// Description implements [Tool].
func (t *validateGrafanaPanelTool) Description() string {
	return "Run the canonical Grafana-panel validator over a typed GrafanaPanelDraft shape and report whether it would be accepted by the panel-builder at /power/grafana. " +
		"PROPOSE-ONLY: nothing is exported. Returns {draft, status: ok|invalid, validation_error}. " +
		"Use this AFTER draft_grafana_panel to confirm a proposed draft will pass the panel-builder contract before narrating it to the user."
}

// InputSchema implements [Tool].
func (t *validateGrafanaPanelTool) InputSchema() json.RawMessage {
	return cachedSchema(grafanaPanelInput{})
}

// OutputSchema implements [Tool].
func (t *validateGrafanaPanelTool) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only.
func (t *validateGrafanaPanelTool) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — same rationale as
// draft_grafana_panel.
func (t *validateGrafanaPanelTool) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *validateGrafanaPanelTool) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[grafanaPanelInput](raw)
}

// Execute implements [Tool]. Same scope + shape checks as
// draft_grafana_panel, then the canonical validator. Same error
// semantics: validation failures are surfaced as status="invalid",
// never as a returned error.
func (t *validateGrafanaPanelTool) Execute(ctx context.Context, in any) (any, error) {
	input := in.(grafanaPanelInput)
	if t.validator == nil {
		return nil, errors.New("validate_grafana_panel: no GrafanaPanelValidator wired")
	}

	draft := buildGrafanaPanelDraft(input)
	if err := checkGrafanaPanelScopeAndShape(ctx, draft); err != nil {
		return nil, err
	}

	out := &grafanaPanelOutput{
		Draft:  draft,
		Status: "ok",
		Source: "validator: internal/ai/tools/nl_grafana_panel.go grafana-panel contract (in-scope panel/datasource catalogs, read-only postgres SQL, single-statement prometheus expr, bounded grid_pos)",
	}
	if err := t.validator.ValidateGrafanaPanel(draft); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// NLGrafanaPanelSources bundles the narrow validator interface
// RegisterNLGrafanaPanelTools needs. Mirrors
// [NLSqlPlaygroundSources] but exposes only the surface the
// nl-grafana-panel tools actually consume.
//
// Production wiring (router.go) instantiates
// *api.AINLGrafanaValidator (a thin wrapper around the same shape
// + scope checks the tool runs); tests substitute deterministic
// fakes.
type NLGrafanaPanelSources struct {
	Validator GrafanaPanelValidator
}

// RegisterNLGrafanaPanelTools installs the nl-grafana-panel
// slice's tools on r. Called from router.go AFTER the Phase-50 /
// 0057 nl-sql-playground registration so the registry's
// alphabetical Names list grows deterministically without
// disturbing earlier registrations or any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterNLGrafanaPanelTools(r *Registry, s NLGrafanaPanelSources) {
	r.Register(&draftGrafanaPanel{validator: s.Validator})
	r.Register(&validateGrafanaPanelTool{validator: s.Validator})
}
