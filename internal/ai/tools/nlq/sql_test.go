// Tool tests for draft_readonly_sql + validate_readonly_sql plus the
// package-shared helpers that live in sql.go (tableNamesToSet,
// tableNamesSetToSortedSlice, extractReferencedTables,
// ForbiddenReadonlySQLKeywords, and the read-only SQL contract regexes).
//
// Both tools are pure functions over input + the per-request scoped
// schema catalog installed in context + a narrow ReadonlySQLValidator
// port. The tests stub the validator with a deterministic fake so
// they stay hermetic (no api package import, no DB, no network).

package nlq

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// Compile-time proof both concrete tools satisfy the Tool contract.
var (
	_ tools.Tool = (*draftReadonlySQL)(nil)
	_ tools.Tool = (*validateReadonlySQLTool)(nil)
)

// stubReadonlySQLValidator records every call and can be wired to
// fail for the rejection-path tests.
type stubReadonlySQLValidator struct {
	failWith error
	calls    []*ReadonlySQLDraft
}

func (s *stubReadonlySQLValidator) ValidateReadonlySQL(d *ReadonlySQLDraft) error {
	s.calls = append(s.calls, d)
	return s.failWith
}

// sqlScopedCtx is a one-line builder so tests don't repeat the
// context install boilerplate.
func sqlScopedCtx(tables ...string) context.Context {
	return WithScopedSchemaCatalog(context.Background(), tables)
}

// ---------------------------------------------------------------------------
// Shared helpers: tableNamesToSet / tableNamesSetToSortedSlice
// ---------------------------------------------------------------------------

func TestTableNamesToSet_TrimsLowercasesDropsEmpty(t *testing.T) {
	t.Parallel()
	set := tableNamesToSet([]string{"  Drives ", "CHARGING", "", "   ", "drives"})
	if _, ok := set["drives"]; !ok {
		t.Errorf("set missing lowercased %q; set=%v", "drives", set)
	}
	if _, ok := set["charging"]; !ok {
		t.Errorf("set missing lowercased %q; set=%v", "charging", set)
	}
	// "Drives" and "drives" collapse to one key; empty/whitespace dropped.
	if len(set) != 2 {
		t.Errorf("len(set) = %d, want 2 (dedup + drop-empty); set=%v", len(set), set)
	}
}

func TestTableNamesToSet_NilYieldsEmptyNonNilMap(t *testing.T) {
	t.Parallel()
	set := tableNamesToSet(nil)
	if set == nil {
		t.Fatal("tableNamesToSet(nil) = nil map, want empty non-nil map")
	}
	if len(set) != 0 {
		t.Errorf("len = %d, want 0", len(set))
	}
	// Membership lookups must be safe without a nil check.
	if _, ok := set["anything"]; ok {
		t.Error("empty set reported membership for a name it never held")
	}
}

func TestTableNamesSetToSortedSlice_SortedAscending(t *testing.T) {
	t.Parallel()
	got := tableNamesSetToSortedSlice(map[string]struct{}{
		"vehicles": {}, "alerts": {}, "drives": {},
	})
	want := []string{"alerts", "drives", "vehicles"}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d (got=%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestTableNamesSetToSortedSlice_Empty(t *testing.T) {
	t.Parallel()
	got := tableNamesSetToSortedSlice(map[string]struct{}{})
	if len(got) != 0 {
		t.Errorf("len = %d, want 0", len(got))
	}
}

// ---------------------------------------------------------------------------
// Shared helper: extractReferencedTables
// ---------------------------------------------------------------------------

func TestExtractReferencedTables(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		sql  string
		want []string
	}{
		{"single from", "SELECT * FROM drives", []string{"drives"}},
		{"from lowercased", "SELECT * FROM Drives", []string{"drives"}},
		{"from + join sorted", "SELECT * FROM drives JOIN charging_sessions ON x", []string{"charging_sessions", "drives"}},
		{"schema qualified kept", "SELECT * FROM public.drives", []string{"public.drives"}},
		{"dedup repeated", "SELECT * FROM drives d JOIN drives d2 ON x", []string{"drives"}},
		{"no from yields empty", "SELECT 1", []string{}},
		{"tab whitespace after keyword", "SELECT * FROM\tdrives", []string{"drives"}},
		{"subquery paren not matched", "SELECT * FROM (SELECT 1) t", []string{}},
		{"case-insensitive keyword", "select * from drives join alerts on x", []string{"alerts", "drives"}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := extractReferencedTables(tc.sql)
			if len(got) != len(tc.want) {
				t.Fatalf("extractReferencedTables(%q) = %v, want %v", tc.sql, got, tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Errorf("[%d] = %q, want %q (full=%v)", i, got[i], tc.want[i], got)
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Shared helper: ForbiddenReadonlySQLKeywords defensive copy
// ---------------------------------------------------------------------------

func TestForbiddenReadonlySQLKeywords_ContentAndDefensiveCopy(t *testing.T) {
	t.Parallel()
	kws := ForbiddenReadonlySQLKeywords()
	for _, must := range []string{"INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE"} {
		found := false
		for _, k := range kws {
			if k == must {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("ForbiddenReadonlySQLKeywords missing %q", must)
		}
	}
	// Mutating the returned slice must not corrupt the package list.
	kws[0] = "MUTATED"
	second := ForbiddenReadonlySQLKeywords()
	if second[0] == "MUTATED" {
		t.Fatalf("ForbiddenReadonlySQLKeywords leaked mutation: second[0] = %q", second[0])
	}
}

// ---------------------------------------------------------------------------
// Scope context round-trip
// ---------------------------------------------------------------------------

func TestScopedSchemaCatalog_RoundTrip(t *testing.T) {
	t.Parallel()
	ctx := WithScopedSchemaCatalog(context.Background(), []string{"Vehicles", "drives"})
	tablesOut, ok := ScopedSchemaCatalogFromContext(ctx)
	if !ok {
		t.Fatal("ScopedSchemaCatalogFromContext ok = false, want true")
	}
	// Sorted ascending + lower-cased defensive copy.
	if len(tablesOut) != 2 || tablesOut[0] != "drives" || tablesOut[1] != "vehicles" {
		t.Errorf("tables = %v, want [drives vehicles]", tablesOut)
	}
}

func TestScopedSchemaCatalog_Empty(t *testing.T) {
	t.Parallel()
	ctx := WithScopedSchemaCatalog(context.Background(), nil)
	tablesOut, ok := ScopedSchemaCatalogFromContext(ctx)
	if !ok {
		t.Fatal("ok = false, want true (empty scope is still a scope)")
	}
	if len(tablesOut) != 0 {
		t.Errorf("tables len = %d, want 0", len(tablesOut))
	}
}

func TestScopedSchemaCatalog_Missing(t *testing.T) {
	t.Parallel()
	_, ok := ScopedSchemaCatalogFromContext(context.Background())
	if ok {
		t.Fatal("ok = true on unscoped ctx, want false")
	}
}

// TestScopedSchemaCatalog_DefensiveCopyOnInstall proves a post-install
// mutation of the caller's slice cannot retroactively widen the scope.
func TestScopedSchemaCatalog_DefensiveCopyOnInstall(t *testing.T) {
	t.Parallel()
	src := []string{"drives"}
	ctx := WithScopedSchemaCatalog(context.Background(), src)
	src[0] = "secrets" // mutate after install
	tablesOut, _ := ScopedSchemaCatalogFromContext(ctx)
	if len(tablesOut) != 1 || tablesOut[0] != "drives" {
		t.Fatalf("scope leaked caller mutation: %v, want [drives]", tablesOut)
	}
}

// ---------------------------------------------------------------------------
// buildReadonlySQLDraft
// ---------------------------------------------------------------------------

func TestBuildReadonlySQLDraft_TrimsAndExtracts(t *testing.T) {
	t.Parallel()
	draft := buildReadonlySQLDraft(readonlySQLInput{
		Prompt:    "  how far did I drive  ",
		SQL:       "  SELECT * FROM drives JOIN alerts ON x  ",
		Rationale: "  reads drives  ",
	})
	if draft.Prompt != "how far did I drive" {
		t.Errorf("Prompt = %q, want trimmed", draft.Prompt)
	}
	if draft.SQL != "SELECT * FROM drives JOIN alerts ON x" {
		t.Errorf("SQL = %q, want trimmed", draft.SQL)
	}
	if draft.Rationale != "reads drives" {
		t.Errorf("Rationale = %q, want trimmed", draft.Rationale)
	}
	if len(draft.ReferencedTables) != 2 || draft.ReferencedTables[0] != "alerts" || draft.ReferencedTables[1] != "drives" {
		t.Errorf("ReferencedTables = %v, want [alerts drives]", draft.ReferencedTables)
	}
}

// ---------------------------------------------------------------------------
// checkReadonlySQLScopeAndShape branch coverage
// ---------------------------------------------------------------------------

func TestCheckReadonlySQLScopeAndShape_MissingScope(t *testing.T) {
	t.Parallel()
	draft := buildReadonlySQLDraft(readonlySQLInput{SQL: "SELECT * FROM drives"})
	err := checkReadonlySQLScopeAndShape(context.Background(), draft)
	if err == nil || !strings.Contains(err.Error(), "no in-scope curated schema catalog") {
		t.Fatalf("err = %v, want missing-scope refusal", err)
	}
}

func TestCheckReadonlySQLScopeAndShape_Table(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		sql     string
		scope   []string
		wantSub string // "" ⇒ expect success
	}{
		{"happy single table", "SELECT * FROM drives", []string{"drives"}, ""},
		{"happy join", "SELECT * FROM drives JOIN alerts ON x", []string{"drives", "alerts"}, ""},
		{"happy with cte prefix", "WITH x AS (SELECT 1) SELECT 2", []string{"drives"}, ""},
		{"happy line comment before select", "-- pick recent\nSELECT * FROM drives", []string{"drives"}, ""},
		{"happy block comment before select", "/* c */ SELECT * FROM drives", []string{"drives"}, ""},
		{"schema qualified matches bare", "SELECT * FROM public.drives", []string{"drives"}, ""},
		{"schema qualified matches qualified", "SELECT * FROM public.drives", []string{"public.drives"}, ""},
		{"too short", "SELECT", []string{"drives"}, "below the 8-char minimum"},
		{"bad prefix", "EXPLAIN SELECT 1", []string{"drives"}, "must start with SELECT or WITH"},
		{"semicolon", "SELECT 1 ; ", []string{"drives"}, "contains a semicolon"},
		{"forbidden keyword", "SELECT 1 TRUNCATE", []string{"drives"}, "forbidden keyword \"TRUNCATE\""},
		{"forbidden keyword lowercase", "SELECT 1 delete 2", []string{"drives"}, "forbidden keyword \"DELETE\""},
		{"out of scope table", "SELECT * FROM secrets", []string{"drives"}, "is not in the in-scope curated schema catalog"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			draft := buildReadonlySQLDraft(readonlySQLInput{SQL: tc.sql})
			err := checkReadonlySQLScopeAndShape(sqlScopedCtx(tc.scope...), draft)
			if tc.wantSub == "" {
				if err != nil {
					t.Fatalf("checkReadonlySQLScopeAndShape(%q) err = %v, want nil", tc.sql, err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantSub) {
				t.Fatalf("checkReadonlySQLScopeAndShape(%q) err = %v, want substring %q", tc.sql, err, tc.wantSub)
			}
		})
	}
}

// TestCheckReadonlySQLScopeAndShape_MaxLen exercises the upper-bound
// defence-in-depth branch (unreachable via Validate since the tag caps
// the untrimmed input at 4000, but reachable if Execute is called
// directly with an over-long draft).
func TestCheckReadonlySQLScopeAndShape_MaxLen(t *testing.T) {
	t.Parallel()
	long := "SELECT " + strings.Repeat("x", readonlySQLMaxSQLLen)
	draft := &ReadonlySQLDraft{SQL: long}
	err := checkReadonlySQLScopeAndShape(sqlScopedCtx("drives"), draft)
	if err == nil || !strings.Contains(err.Error(), "exceeds the 4000-char maximum") {
		t.Fatalf("err = %v, want max-length refusal", err)
	}
}

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

func TestReadonlySQLTools_Metadata(t *testing.T) {
	t.Parallel()
	d := &draftReadonlySQL{}
	v := &validateReadonlySQLTool{}

	if d.Name() != "draft_readonly_sql" {
		t.Errorf("draft Name() = %q", d.Name())
	}
	if v.Name() != "validate_readonly_sql" {
		t.Errorf("validate Name() = %q", v.Name())
	}
	if d.Mutates() || v.Mutates() {
		t.Error("propose-only tools must report Mutates()=false")
	}
	if d.RequiredScope() != "" || v.RequiredScope() != "" {
		t.Error("RequiredScope must be empty")
	}
	if d.OutputSchema() != nil || v.OutputSchema() != nil {
		t.Error("OutputSchema must be nil (free-form output)")
	}
	for _, tl := range []tools.Tool{d, v} {
		schema := tl.InputSchema()
		if len(schema) == 0 || !json.Valid(schema) {
			t.Errorf("%s InputSchema() is not valid JSON: %s", tl.Name(), schema)
		}
	}
	// Description must advertise the read-only contract + deny-list so
	// the model picks SELECT/WITH deterministically.
	for _, must := range []string{"SELECT or WITH", "INSERT", "DELETE", "DROP"} {
		if !strings.Contains(d.Description(), must) {
			t.Errorf("draft Description() missing %q", must)
		}
	}
	if !strings.Contains(v.Description(), "validator") {
		t.Errorf("validate Description() missing %q", "validator")
	}
}

// ---------------------------------------------------------------------------
// Validate stage (per-field tag enforcement before Execute)
// ---------------------------------------------------------------------------

func TestReadonlySQL_Validate_Good(t *testing.T) {
	t.Parallel()
	tool := &draftReadonlySQL{validator: &stubReadonlySQLValidator{}}
	in, err := tool.Validate(json.RawMessage(`{"prompt":"p","sql":"SELECT 1","rationale":"r"}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	if _, ok := in.(readonlySQLInput); !ok {
		t.Fatalf("Validate returned %T, want readonlySQLInput", in)
	}
}

func TestReadonlySQL_Validate_BadInput(t *testing.T) {
	t.Parallel()
	tool := &draftReadonlySQL{validator: &stubReadonlySQLValidator{}}
	cases := []struct {
		name string
		body string
	}{
		{"missing prompt", `{"sql":"SELECT 1","rationale":"r"}`},
		{"empty prompt", `{"prompt":"","sql":"SELECT 1","rationale":"r"}`},
		{"missing sql", `{"prompt":"p","rationale":"r"}`},
		{"sql too short", `{"prompt":"p","sql":"SELECT","rationale":"r"}`},
		{"missing rationale", `{"prompt":"p","sql":"SELECT 1"}`},
		{"unknown field", `{"prompt":"p","sql":"SELECT 1","rationale":"r","extra":true}`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if _, err := tool.Validate(json.RawMessage(tc.body)); err == nil {
				t.Fatalf("Validate(%s) err = nil, want non-nil", tc.body)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Execute — draft_readonly_sql
// ---------------------------------------------------------------------------

func TestDraftReadonlySQL_HappyPath_OK(t *testing.T) {
	t.Parallel()
	stub := &stubReadonlySQLValidator{}
	tool := &draftReadonlySQL{validator: stub}

	in, err := tool.Validate(json.RawMessage(`{"prompt":"far?","sql":"SELECT * FROM drives","rationale":"reads drives"}`))
	if err != nil {
		t.Fatalf("Validate err = %v", err)
	}
	out, err := tool.Execute(sqlScopedCtx("drives"), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*readonlySQLOutput)
	if !ok {
		t.Fatalf("Execute returned %T, want *readonlySQLOutput", out)
	}
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok (err=%q)", env.Status, env.ValidationError)
	}
	if env.Draft == nil || env.Draft.SQL != "SELECT * FROM drives" {
		t.Errorf("Draft = %+v, want SQL preserved", env.Draft)
	}
	if len(env.Draft.ReferencedTables) != 1 || env.Draft.ReferencedTables[0] != "drives" {
		t.Errorf("ReferencedTables = %v, want [drives]", env.Draft.ReferencedTables)
	}
	if env.Source == "" {
		t.Error("Source must be non-empty")
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator calls = %d, want 1", len(stub.calls))
	}
}

func TestDraftReadonlySQL_NoScope_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubReadonlySQLValidator{}
	tool := &draftReadonlySQL{validator: stub}
	in := readonlySQLInput{Prompt: "p", SQL: "SELECT * FROM drives", Rationale: "r"}
	_, err := tool.Execute(context.Background(), in)
	if err == nil || !strings.Contains(err.Error(), "no in-scope") {
		t.Fatalf("Execute err = %v, want missing-scope refusal", err)
	}
	if len(stub.calls) != 0 {
		t.Errorf("validator calls = %d, want 0 (scope check refuses before validator)", len(stub.calls))
	}
}

func TestDraftReadonlySQL_OutOfScopeTable_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubReadonlySQLValidator{}
	tool := &draftReadonlySQL{validator: stub}
	in := readonlySQLInput{Prompt: "p", SQL: "SELECT * FROM secrets", Rationale: "r"}
	_, err := tool.Execute(sqlScopedCtx("drives"), in)
	if err == nil || !strings.Contains(err.Error(), "secrets") {
		t.Fatalf("Execute err = %v, want out-of-catalog refusal", err)
	}
	if len(stub.calls) != 0 {
		t.Errorf("validator calls = %d, want 0", len(stub.calls))
	}
}

func TestDraftReadonlySQL_ValidatorReject_StatusInvalid(t *testing.T) {
	t.Parallel()
	stub := &stubReadonlySQLValidator{failWith: errors.New("out of band reason")}
	tool := &draftReadonlySQL{validator: stub}
	in := readonlySQLInput{Prompt: "p", SQL: "SELECT * FROM drives", Rationale: "r"}
	out, err := tool.Execute(sqlScopedCtx("drives"), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (validator failure must NOT surface as exec error)", err)
	}
	env := out.(*readonlySQLOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "out of band reason") {
		t.Errorf("ValidationError = %q, want substring", env.ValidationError)
	}
	if env.Draft == nil {
		t.Error("Draft must still be returned on validator reject")
	}
}

func TestDraftReadonlySQL_NilValidator_Errors(t *testing.T) {
	t.Parallel()
	tool := &draftReadonlySQL{validator: nil}
	in := readonlySQLInput{Prompt: "p", SQL: "SELECT * FROM drives", Rationale: "r"}
	if _, err := tool.Execute(sqlScopedCtx("drives"), in); err == nil {
		t.Fatal("Execute err = nil, want non-nil (no validator wired)")
	}
}

// ---------------------------------------------------------------------------
// Execute — validate_readonly_sql (symmetry with draft)
// ---------------------------------------------------------------------------

func TestValidateReadonlySQL_HappyPath_OK(t *testing.T) {
	t.Parallel()
	stub := &stubReadonlySQLValidator{}
	tool := &validateReadonlySQLTool{validator: stub}
	in := readonlySQLInput{Prompt: "p", SQL: "WITH x AS (SELECT 1) SELECT 2", Rationale: "r"}
	out, err := tool.Execute(sqlScopedCtx("drives"), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env := out.(*readonlySQLOutput)
	if env.Status != "ok" {
		t.Errorf("Status = %q, want ok (err=%q)", env.Status, env.ValidationError)
	}
	if len(stub.calls) != 1 {
		t.Errorf("validator calls = %d, want 1", len(stub.calls))
	}
}

func TestValidateReadonlySQL_OutOfScope_Refuses(t *testing.T) {
	t.Parallel()
	stub := &stubReadonlySQLValidator{}
	tool := &validateReadonlySQLTool{validator: stub}
	in := readonlySQLInput{Prompt: "p", SQL: "SELECT * FROM secrets", Rationale: "r"}
	if _, err := tool.Execute(sqlScopedCtx("drives"), in); err == nil {
		t.Fatal("Execute err = nil, want refusal (out-of-catalog)")
	}
}

func TestValidateReadonlySQL_NilValidator_Errors(t *testing.T) {
	t.Parallel()
	tool := &validateReadonlySQLTool{validator: nil}
	in := readonlySQLInput{Prompt: "p", SQL: "SELECT * FROM drives", Rationale: "r"}
	if _, err := tool.Execute(sqlScopedCtx("drives"), in); err == nil {
		t.Fatal("Execute err = nil, want non-nil (no validator wired)")
	}
}

func TestValidateReadonlySQL_Validate_Good(t *testing.T) {
	t.Parallel()
	tool := &validateReadonlySQLTool{validator: &stubReadonlySQLValidator{}}
	in, err := tool.Validate(json.RawMessage(`{"prompt":"p","sql":"SELECT 1","rationale":"r"}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	if _, ok := in.(readonlySQLInput); !ok {
		t.Fatalf("Validate returned %T, want readonlySQLInput", in)
	}
}

func TestValidateReadonlySQL_ValidatorReject_StatusInvalid(t *testing.T) {
	t.Parallel()
	stub := &stubReadonlySQLValidator{failWith: errors.New("out of band reason")}
	tool := &validateReadonlySQLTool{validator: stub}
	in := readonlySQLInput{Prompt: "p", SQL: "SELECT * FROM drives", Rationale: "r"}
	out, err := tool.Execute(sqlScopedCtx("drives"), in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (validator failure must NOT surface as exec error)", err)
	}
	env := out.(*readonlySQLOutput)
	if env.Status != "invalid" {
		t.Errorf("Status = %q, want invalid", env.Status)
	}
	if !strings.Contains(env.ValidationError, "out of band reason") {
		t.Errorf("ValidationError = %q, want substring", env.ValidationError)
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

func TestRegisterNLSqlPlaygroundTools_RegistersBoth(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterNLSqlPlaygroundTools(r, NLSqlPlaygroundSources{Validator: &stubReadonlySQLValidator{}})
	if _, ok := r.Get("draft_readonly_sql"); !ok {
		t.Error("draft_readonly_sql not registered")
	}
	if _, ok := r.Get("validate_readonly_sql"); !ok {
		t.Error("validate_readonly_sql not registered")
	}
}
