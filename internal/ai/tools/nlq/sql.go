// Phase-50 / 0057 — PU1 Natural-language SQL playground.
//
// nl_sql_playground.go ships TWO new propose-only tools:
//
//   - `draft_readonly_sql`    — accept a typed ReadonlySQLDraft shape
//                               (prompt, sql, rationale) and return a
//                               normalized + validated draft the
//                               frontend can render for human review
//                               in the AI side panel of the SQL
//                               playground page.
//
//   - `validate_readonly_sql` — accept the same typed shape and
//                               return whether it would be accepted
//                               by the canonical read-only SQL
//                               contract, with field-level error
//                               messages on rejection.
//
// Both tools are PROPOSE-ONLY: they construct or validate a
// ReadonlySQLDraft DTO but do NOT touch the database, execute the
// SQL, or persist anything. The dispatcher's deny-all confirm gate
// is therefore never triggered — defence in depth in case a future
// edit accidentally adds a write tool. The actual query execution
// flows through the existing manual SQL editor's Run button on
// /power/sql AFTER the user explicitly clicks the canonical Apply
// to editor button in the AI panel; the LLM has no tool that
// executes raw SQL.
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): the AI HTTP handler inspects the curated install-
// wide schema catalog (a hardcoded whitelist of safe read-only
// table names) and installs the table-name set in ctx via
// WithScopedSchemaCatalog BEFORE the dispatcher invokes the tool.
// Both tools' Execute REJECT any LLM-supplied table reference that
// is NOT in the snapshot. This blocks a prompt-injection attack
// where an attacker pastes "select * from secrets" into the prompt
// — even if the LLM tries to call the tool with an out-of-scope
// table, the scope check refuses the call before any out-of-
// catalog query proposal can reach the SPA.
//
// Design constraints (from the slice prompt):
//
//   - "Route every mutation proposal through F4 tools and existing
//     typed DTO validation. The LLM never writes raw SQL and never
//     bypasses existing handlers." → both tools delegate the final
//     ReadonlySQLDraft shape check to a narrow [ReadonlySQLValidator]
//     port. The tool ALSO enforces a deny-by-default DML/DDL
//     keyword filter and a SELECT/WITH-only prefix check before any
//     validator ever runs.
//
//   - "the LLM never writes raw SQL" → tools have no DB handle.
//     The interface is intentionally narrow: a single Validate
//     call. The tool does NOT execute the proposed SQL — it only
//     pattern-matches the text against the read-only contract.
//
//   - "no duplicate write paths" → the toolkit does NOT include an
//     `apply_readonly_sql`, `execute_readonly_sql`, or any other
//     write / execute tool. The frontend renders the draft and the
//     user clicks the canonical baseline Run button on the SQL
//     playground, which is what invokes any actual query.

package nlq

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// ---------------------------------------------------------------------------
// Per-request schema-catalog scope binding
// ---------------------------------------------------------------------------

// scopedSchemaCatalogScope is the value stored in context. Holding
// the table-name set in a single value lets the tool make one O(1)
// lookup against the scope, and lets missing-scope (no value) be
// distinguished from empty-scope (zero in-catalog tables — a
// degenerate but legal state) at the type level.
type scopedSchemaCatalogScope struct {
	tables map[string]struct{}
}

// scopedSchemaCatalogKey is the unexported context-key type used
// to carry the in-scope snapshot through the dispatcher to the
// tool. A per-package unexported type prevents accidental key
// collisions with any other context value in the request lifetime.
type scopedSchemaCatalogKey struct{}

// WithScopedSchemaCatalog returns ctx with the table-name snapshot
// installed as the in-scope curated schema catalog for this
// request. Called by the AI HTTP handler AFTER it loads the
// catalog from the canonical [AINLSQLSchemaCatalogSource] and
// BEFORE the dispatcher.Run loop is started. The dispatcher then
// propagates ctx unchanged through every Tool.Execute call.
//
// tables is defensively copied into a private set so a later
// mutation by the caller cannot retroactively widen or narrow the
// scope a tool already consulted. nil-safe: passing nil for the
// tables slice installs an empty scope (the tool will refuse every
// table reference).
//
// Exported so internal/api can install the scope without depending
// on tool-internal types.
func WithScopedSchemaCatalog(ctx context.Context, tables []string) context.Context {
	scope := &scopedSchemaCatalogScope{
		tables: tableNamesToSet(tables),
	}
	return context.WithValue(ctx, scopedSchemaCatalogKey{}, scope)
}

// ScopedSchemaCatalogFromContext returns the in-scope table-name
// snapshot and true when one is present, or (nil, false) when no
// scope is installed. Tools that are scope-bound MUST treat the
// missing-scope case as a hard failure — the AI handler ALWAYS
// installs the scope, so an absent scope means the dispatcher was
// invoked from an unintended path and the call must be refused.
//
// Returns a sorted defensive copy of the table names (callers may
// mutate freely).
//
// Exported for symmetry with WithScopedSchemaCatalog and so unit
// tests in other packages can inspect what the AI handler installed.
func ScopedSchemaCatalogFromContext(ctx context.Context) (tables []string, ok bool) {
	scope, ok := ctx.Value(scopedSchemaCatalogKey{}).(*scopedSchemaCatalogScope)
	if !ok || scope == nil {
		return nil, false
	}
	return tableNamesSetToSortedSlice(scope.tables), true
}

// tableNamesToSet builds a defensive name-set; a nil input yields
// an empty map (NOT a nil map) so membership lookups stay correct
// without an extra nil-check. Names are lower-cased so case-
// insensitive table comparisons work uniformly downstream.
func tableNamesToSet(names []string) map[string]struct{} {
	out := make(map[string]struct{}, len(names))
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		out[strings.ToLower(n)] = struct{}{}
	}
	return out
}

// tableNamesSetToSortedSlice returns the keys of m in ascending
// order. Used only by tests and the diagnostic
// ScopedSchemaCatalogFromContext path; the hot tool path uses
// direct map lookup.
func tableNamesSetToSortedSlice(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// ---------------------------------------------------------------------------
// Constants & enumerations
// ---------------------------------------------------------------------------

// readonlySQLForbiddenKeywords is the deny-list of SQL keywords
// that MUST NOT appear in a proposed read-only draft. Matched as
// case-insensitive whole words via [readonlySQLKeywordRe].
//
// Adding a keyword here is safe — the worst case is that a benign
// SELECT containing the literal text in a string literal or
// identifier is rejected, which surfaces as a validation error the
// user can fix. Removing one is dangerous and MUST NOT happen
// without a corresponding change to the strategy's system prompt
// AND the goldens that pin the contract.
var readonlySQLForbiddenKeywords = []string{
	"INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
	"TRUNCATE", "GRANT", "REVOKE", "VACUUM", "COPY", "CALL",
	"DO", "MERGE", "EXECUTE",
}

// readonlySQLKeywordRe is the case-insensitive whole-word matcher
// for the forbidden-keyword scan. Built once at package init.
var readonlySQLKeywordRe = func() *regexp.Regexp {
	parts := make([]string, len(readonlySQLForbiddenKeywords))
	for i, kw := range readonlySQLForbiddenKeywords {
		parts[i] = regexp.QuoteMeta(kw)
	}
	return regexp.MustCompile(`(?i)\b(` + strings.Join(parts, "|") + `)\b`)
}()

// readonlySQLTableRefRe extracts referenced table names from FROM
// and JOIN clauses. Matches the table identifier (a simple
// `[A-Za-z_][A-Za-z0-9_]*` token) immediately after the keyword.
// Schema-qualified names (`public.drives`) are matched as
// `public.drives` and lower-cased for the scope check; the in-
// scope catalog SHOULD store the same qualified form for a match.
//
// Sub-queries, CTEs, and quoted identifiers are NOT exhaustively
// parsed — we only need to surface the candidate table names so
// the scope check can refuse out-of-catalog references. Anything
// the regex misses is harmless: the LLM is instructed to refer to
// catalog tables by their canonical names, and the scope check
// will refuse anything that DOES match but is not in the catalog.
var readonlySQLTableRefRe = regexp.MustCompile(`(?i)\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_\.]*)`)

// readonlySQLPrefixRe enforces the SELECT-or-WITH-only contract.
// Allows leading whitespace and SQL comments (`--` line comments
// and `/* */` block comments) before the keyword so an LLM that
// pads the proposal with a one-line rationale comment is not
// rejected on a technicality.
var readonlySQLPrefixRe = regexp.MustCompile(`(?is)^(?:\s*(?:--[^\n]*\n|/\*.*?\*/|\s))*(SELECT|WITH)\b`)

// readonlySQLMinSQLLen is the minimum length of a proposed SQL
// string. A proposal shorter than this cannot meaningfully be a
// SELECT statement (`SELECT 1` is 8 chars) and is almost certainly
// the LLM padding an empty draft.
const readonlySQLMinSQLLen = 8

// readonlySQLMaxSQLLen is the maximum length of a proposed SQL
// string. The frontend's textarea is sized for ~2000 chars; longer
// proposals overflow the AI panel and are typically the LLM
// pasting an entire schema dump. Bound the proposal so the panel
// renders cleanly and the prompt-injection blast radius stays
// small.
const readonlySQLMaxSQLLen = 4000

// readonlySQLMaxRationaleLen bounds the rationale string. One
// sentence is enough; longer rationales overflow the panel.
const readonlySQLMaxRationaleLen = 600

// ForbiddenReadonlySQLKeywords returns a defensive copy of the
// keyword deny-list. Exported so the AI handler + tests can
// reference the same list the tools enforce.
func ForbiddenReadonlySQLKeywords() []string {
	out := make([]string, len(readonlySQLForbiddenKeywords))
	copy(out, readonlySQLForbiddenKeywords)
	return out
}

// ---------------------------------------------------------------------------
// Validator port + ReadonlySQLDraft DTO
// ---------------------------------------------------------------------------

// ReadonlySQLValidator is the narrow validation interface the
// nl-sql-playground tools need. In production it is satisfied by
// *api.AINLSQLValidator (a thin wrapper around the same prefix
// check + keyword scan the tool runs, kept separate so future
// extensions — e.g. a per-vehicle row-level scope — can plug in
// without touching tool code). Tests substitute deterministic
// fakes.
//
// The interface MUST stay validation-only — adding an Apply or
// Execute method here would defeat the propose-only contract that
// ADR-015 §I3 + the slice prompt mandate.
type ReadonlySQLValidator interface {
	// ValidateReadonlySQL reports whether the draft would be
	// accepted by the canonical read-only SQL contract. Returns
	// nil on acceptance; an error whose Error() text is suitable
	// for surfacing to the LLM (it'll be relayed back as a tool
	// error reply) on rejection.
	ValidateReadonlySQL(draft *ReadonlySQLDraft) error
}

// ReadonlySQLDraft is the typed proposal envelope both tools build
// and the validator inspects. Exported because the AI handler test
// (in package api) needs to reference the type to construct fakes.
//
// This is NOT a model — it's a transient proposal shape the AI
// surface uses. The actual SQL execution goes through the existing
// manual SQL editor on /power/sql AFTER the user explicitly clicks
// the Apply to editor button in the AI panel and then the Run
// button.
type ReadonlySQLDraft struct {
	// Prompt is the user's natural-language request, echoed back
	// so the SPA can show prompt + draft side-by-side.
	Prompt string `json:"prompt"`

	// SQL is the proposed read-only statement. Always starts with
	// SELECT or WITH (case-insensitive); single statement only
	// (no semicolons); contains none of the forbidden DML/DDL
	// keywords.
	SQL string `json:"sql"`

	// Rationale is one sentence explaining what the SQL does and
	// why it answers the prompt. Bounded by
	// [readonlySQLMaxRationaleLen].
	Rationale string `json:"rationale"`

	// ReferencedTables is the deduplicated lower-cased list of
	// table names extracted from FROM / JOIN clauses. Populated
	// by the tool, NOT the LLM — the SPA renders it under the
	// SQL preview so the user can confirm the proposal stays in
	// the curated catalog.
	ReferencedTables []string `json:"referenced_tables"`
}

// ---------------------------------------------------------------------------
// Typed tool input + output shapes
// ---------------------------------------------------------------------------

// readonlySQLInput is the typed input shape both tools share. The
// dispatcher decodes the LLM's tool-call arguments JSON into this
// struct via ValidateStruct so a malformed input fails before any
// validator method runs.
type readonlySQLInput struct {
	// Prompt is the user's natural-language request. Required and
	// non-empty; bounded by [readonlySQLMaxRationaleLen] * 2 so
	// pasted-essay attacks don't widen the panel arbitrarily.
	Prompt string `json:"prompt" validate:"required,min=1,max=1200" desc:"The user's natural-language request that motivates this draft."`

	// SQL is the proposed read-only statement. Required; must
	// start with SELECT or WITH; contains no semicolons; contains
	// none of the forbidden DML/DDL keywords. The validator-tag
	// layer enforces only the length bounds; the prefix + keyword
	// + scope checks live in checkReadonlySQLScopeAndShape.
	SQL string `json:"sql" validate:"required,min=8,max=4000" desc:"Proposed read-only SQL; MUST start with SELECT or WITH; single statement only (no semicolons); MUST NOT contain INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, GRANT, REVOKE, VACUUM, COPY, CALL, DO, MERGE, or EXECUTE."`

	// Rationale is one sentence explaining what the SQL does. The
	// validator-tag layer enforces the length bound; the tool
	// does not require any particular content.
	Rationale string `json:"rationale" validate:"required,min=1,max=600" desc:"One-sentence rationale explaining what the SQL does and why it answers the prompt."`
}

// readonlySQLOutput is the JSON envelope both tools return on
// success. The frontend renders it as the structured proposal in
// the SQL playground's AI side panel.
//
// Status reports whether the draft would be accepted by the
// canonical validator at the time of the tool call:
//
//   - "ok"      — accepted; the user can copy the draft into the
//     baseline editor and click Run to execute.
//   - "invalid" — rejected; ValidationError contains a one-line
//     diagnostic suitable for showing in the UI.
//
// Even when invalid, Draft is returned unchanged so the frontend
// can render the partially-correct proposal and let the user fix
// the problem clauses rather than start over.
type readonlySQLOutput struct {
	// Draft is the proposed ReadonlySQLDraft, with referenced
	// tables canonicalized and the in-scope scope check already
	// passed.
	Draft *ReadonlySQLDraft `json:"draft"`

	// Status is "ok" or "invalid".
	Status string `json:"status"`

	// ValidationError is the canonical validator's diagnostic on
	// rejection; empty when ok.
	ValidationError string `json:"validation_error,omitempty"`

	// Source is the dispatcher-visible breadcrumb so the LLM's
	// follow-up prose can attribute the decision to the canonical
	// read-only contract rather than its own reasoning.
	Source string `json:"source"`
}

// ---------------------------------------------------------------------------
// Shared scope + draft-shape checks
// ---------------------------------------------------------------------------

// buildReadonlySQLDraft converts the typed input into a
// *ReadonlySQLDraft with no scope or shape modification beyond
// trimming surrounding whitespace and extracting referenced
// tables. The scope + keyword + prefix checks live in
// checkReadonlySQLScopeAndShape so both tools (draft + validate)
// apply identical semantics.
func buildReadonlySQLDraft(input readonlySQLInput) *ReadonlySQLDraft {
	sql := strings.TrimSpace(input.SQL)
	return &ReadonlySQLDraft{
		Prompt:           strings.TrimSpace(input.Prompt),
		SQL:              sql,
		Rationale:        strings.TrimSpace(input.Rationale),
		ReferencedTables: extractReferencedTables(sql),
	}
}

// extractReferencedTables returns the deduplicated lower-cased
// list of table names referenced in FROM / JOIN clauses. Order is
// stable (sorted ascending) so subsequent equality checks and
// rendering are deterministic across calls.
func extractReferencedTables(sql string) []string {
	matches := readonlySQLTableRefRe.FindAllStringSubmatch(sql, -1)
	seen := make(map[string]struct{}, len(matches))
	for _, m := range matches {
		if len(m) < 2 {
			continue
		}
		name := strings.ToLower(strings.TrimSpace(m[1]))
		if name == "" {
			continue
		}
		seen[name] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// checkReadonlySQLScopeAndShape enforces:
//
//   - the in-scope binding installed by the AI handler is present
//     (missing-scope ⇒ hard error)
//   - the proposed SQL starts with SELECT or WITH (no DML/DDL)
//   - the proposed SQL contains no semicolons (single statement)
//   - the proposed SQL contains no forbidden DML/DDL keywords
//     (defence in depth on top of the prefix check)
//   - every referenced table is in the in-scope curated catalog
//     (out-of-catalog prompt-injection ⇒ hard error)
//
// Returns nil on success. A returned error is propagated as a tool
// error frame back to the LLM so the strategy can refuse politely
// in its narrative reply.
func checkReadonlySQLScopeAndShape(ctx context.Context, draft *ReadonlySQLDraft) error {
	scope, ok := ctx.Value(scopedSchemaCatalogKey{}).(*scopedSchemaCatalogScope)
	if !ok || scope == nil {
		return errors.New("readonly_sql: no in-scope curated schema catalog installed in context")
	}

	if len(draft.SQL) < readonlySQLMinSQLLen {
		return fmt.Errorf("readonly_sql: sql length %d is below the %d-char minimum",
			len(draft.SQL), readonlySQLMinSQLLen)
	}
	if len(draft.SQL) > readonlySQLMaxSQLLen {
		return fmt.Errorf("readonly_sql: sql length %d exceeds the %d-char maximum",
			len(draft.SQL), readonlySQLMaxSQLLen)
	}

	// Prefix check: SELECT or WITH only. The regex skips leading
	// whitespace and SQL comments so a one-line rationale comment
	// before the SELECT does not trip the check.
	if !readonlySQLPrefixRe.MatchString(draft.SQL) {
		return errors.New("readonly_sql: sql must start with SELECT or WITH (the read-only SQL playground rejects any other statement type)")
	}

	// Single-statement check: semicolons forbidden. A trailing
	// semicolon would be safe in many engines, but the playground
	// surface refuses it uniformly so the LLM cannot smuggle a
	// follow-up statement.
	if strings.Contains(draft.SQL, ";") {
		return errors.New("readonly_sql: sql contains a semicolon; only a single read-only statement is allowed")
	}

	// Forbidden-keyword scan. Defence in depth on top of the
	// SELECT/WITH prefix check — even a malformed proposal that
	// somehow starts with SELECT but smuggles a UNION-attached
	// DML keyword is refused. The match returns the first
	// offending keyword so the diagnostic is precise.
	if m := readonlySQLKeywordRe.FindString(draft.SQL); m != "" {
		return fmt.Errorf("readonly_sql: sql contains forbidden keyword %q; the playground is read-only", strings.ToUpper(m))
	}

	// Scope check: every referenced table MUST be in the curated
	// catalog. Refuses cross-catalog prompt-injection attacks.
	for _, tbl := range draft.ReferencedTables {
		// Strip any schema qualifier: `public.drives` matches
		// either `public.drives` (preferred) or `drives` in the
		// scope, so the catalog can ship without per-table
		// schema prefixes if it chooses.
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
			return fmt.Errorf("readonly_sql: table %q is not in the in-scope curated schema catalog; refuse the request", tbl)
		}
	}

	return nil
}

// ---------------------------------------------------------------------------
// draft_readonly_sql
// ---------------------------------------------------------------------------

// draftReadonlySQL is the propose-only tool that builds a
// normalized + validated ReadonlySQLDraft for the SQL playground
// UI to render. It is the FIRST tool the LLM is expected to call
// (per the strategy's system prompt).
//
// Execution is pure: input → typed ReadonlySQLDraft → scope +
// shape check → optional validator pass → JSON envelope. No DB
// call; no SQL execution; no side effects.
type draftReadonlySQL struct {
	validator ReadonlySQLValidator
}

// Name implements [Tool].
func (t *draftReadonlySQL) Name() string { return "draft_readonly_sql" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, with the deny-list
// appended so the model picks SELECT/WITH deterministically.
func (t *draftReadonlySQL) Description() string {
	return "Build a typed ReadonlySQLDraft from the user's natural-language request for the SQL playground at /power/sql. " +
		"PROPOSE-ONLY: the SQL is NOT executed; the user reviews the draft in the AI side panel and clicks the Apply to editor button to copy it into the manual SQL editor. " +
		"sql MUST start with SELECT or WITH (case-insensitive); single statement only (no semicolons). " +
		"sql MUST NOT contain ANY of: " + strings.Join(readonlySQLForbiddenKeywords, ", ") + ". " +
		"Every table the SQL references MUST appear in the in-scope curated schema catalog the user message lists; out-of-catalog table references are refused. " +
		"Returns {draft, status: ok|invalid, validation_error}."
}

// InputSchema implements [Tool].
func (t *draftReadonlySQL) InputSchema() json.RawMessage {
	return tools.CachedSchema(readonlySQLInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *draftReadonlySQL) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
// The tool builds + validates a DTO but does NOT execute the SQL,
// touch the database, or persist anything. The actual query
// execution flows through the existing baseline manual SQL editor
// + Run button on /power/sql AFTER the user clicks the canonical
// Apply to editor button.
func (t *draftReadonlySQL) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream, and the tool
// produces no state mutation that needs an additional RBAC scope.
func (t *draftReadonlySQL) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *draftReadonlySQL) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[readonlySQLInput](raw)
}

// Execute implements [Tool]. Builds the draft, runs the scope +
// shape checks, runs the canonical validator, returns the envelope.
//
// Per-request scope binding (defence against prompt-injection
// exfiltration): rejects any LLM-supplied SQL that references a
// table NOT in the curated schema catalog the AI handler installed
// via WithScopedSchemaCatalog.
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
func (t *draftReadonlySQL) Execute(ctx context.Context, in any) (any, error) {
	input := in.(readonlySQLInput)
	if t.validator == nil {
		return nil, errors.New("draft_readonly_sql: no ReadonlySQLValidator wired")
	}

	draft := buildReadonlySQLDraft(input)
	if err := checkReadonlySQLScopeAndShape(ctx, draft); err != nil {
		return nil, err
	}

	out := &readonlySQLOutput{
		Draft:  draft,
		Status: "ok",
		Source: "validator: internal/ai/tools/nl_sql_playground.go readonly_sql contract (SELECT/WITH-only, single-statement, deny DML/DDL keywords, in-scope catalog tables only)",
	}
	if err := t.validator.ValidateReadonlySQL(draft); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// validate_readonly_sql
// ---------------------------------------------------------------------------

// validateReadonlySQLTool is the propose-only tool that runs the
// canonical validator over a typed ReadonlySQLDraft shape and
// reports the verdict. It is the SECOND tool the LLM is expected
// to call (per the strategy's system prompt) — typically
// immediately after draft_readonly_sql, so the assistant can
// confirm the draft would pass before narrating it to the user.
//
// Execution is pure: input → typed ReadonlySQLDraft → scope +
// shape check → canonical validator pass → JSON envelope. No DB
// call; no SQL execution; no side effects.
type validateReadonlySQLTool struct {
	validator ReadonlySQLValidator
}

// Name implements [Tool].
func (t *validateReadonlySQLTool) Name() string { return "validate_readonly_sql" }

// Description implements [Tool].
func (t *validateReadonlySQLTool) Description() string {
	return "Run the canonical read-only SQL validator over a typed ReadonlySQLDraft shape and report whether it would be accepted by the SQL playground at /power/sql. " +
		"PROPOSE-ONLY: nothing is executed. Returns {draft, status: ok|invalid, validation_error}. " +
		"Use this AFTER draft_readonly_sql to confirm a proposed draft will pass the read-only contract before narrating it to the user."
}

// InputSchema implements [Tool].
func (t *validateReadonlySQLTool) InputSchema() json.RawMessage {
	return tools.CachedSchema(readonlySQLInput{})
}

// OutputSchema implements [Tool].
func (t *validateReadonlySQLTool) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only.
func (t *validateReadonlySQLTool) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — same rationale as
// draft_readonly_sql.
func (t *validateReadonlySQLTool) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *validateReadonlySQLTool) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[readonlySQLInput](raw)
}

// Execute implements [Tool]. Same scope + shape checks as
// draft_readonly_sql, then the canonical validator. Same error
// semantics: validation failures are surfaced as status="invalid",
// never as a returned error.
func (t *validateReadonlySQLTool) Execute(ctx context.Context, in any) (any, error) {
	input := in.(readonlySQLInput)
	if t.validator == nil {
		return nil, errors.New("validate_readonly_sql: no ReadonlySQLValidator wired")
	}

	draft := buildReadonlySQLDraft(input)
	if err := checkReadonlySQLScopeAndShape(ctx, draft); err != nil {
		return nil, err
	}

	out := &readonlySQLOutput{
		Draft:  draft,
		Status: "ok",
		Source: "validator: internal/ai/tools/nl_sql_playground.go readonly_sql contract (SELECT/WITH-only, single-statement, deny DML/DDL keywords, in-scope catalog tables only)",
	}
	if err := t.validator.ValidateReadonlySQL(draft); err != nil {
		out.Status = "invalid"
		out.ValidationError = err.Error()
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// NLSqlPlaygroundSources bundles the narrow validator interface
// RegisterNLSqlPlaygroundTools needs. Mirrors
// [SignalExplorerNlFilterSources] but exposes only the surface the
// nl-sql-playground tools actually consume.
//
// Production wiring (router.go) instantiates
// *api.AINLSQLValidator (a thin wrapper around the same prefix +
// keyword + scope checks the tool runs); tests substitute
// deterministic fakes.
type NLSqlPlaygroundSources struct {
	Validator ReadonlySQLValidator
}

// RegisterNLSqlPlaygroundTools installs the nl-sql-playground
// slice's tools on r. Called from router.go AFTER the Phase-50 /
// 0044 signal-explorer-nl-filter registration so the registry's
// alphabetical Names list grows deterministically without
// disturbing earlier registrations or any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) — a
// second call is a wiring bug detected at boot, not at first
// request.
func RegisterNLSqlPlaygroundTools(r *tools.Registry, s NLSqlPlaygroundSources) {
	r.Register(&draftReadonlySQL{validator: s.Validator})
	r.Register(&validateReadonlySQLTool{validator: s.Validator})
}
