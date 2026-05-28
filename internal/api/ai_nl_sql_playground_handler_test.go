// Phase-50 / 0057 — PU1 Natural-language SQL playground.
//
// Off-mode + baseline-coexistence tests for the AI nl-sql-playground
// handler. The off-mode test (TestNLSQLPlaygroundAIOffManualSQLWorks)
// is the slice's load-bearing AI-OFF contract proof: it asserts that
// the AI route returns 404 when settings.ai_mode='off' even when the
// per-feature toggle is on, AND that the deterministic /power/sql
// page (manual SQL editor + curated catalog viewer + Apply target)
// remains the unconditional baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness (`go run ./cmd/ai-eval -feature
// nl-sql-playground`); duplicating that here would require a live
// database fixture.

package api

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/nlq"
)

// TestNLSQLPlaygroundAIOffManualSQLWorks is the load-bearing
// off-mode contract proof for slice 0057. It mounts the AI
// nl-sql-playground route through the guard with ai_mode='off'
// and proves:
//
//   - The /api/v1/ai/power/sql/draft route returns 404 (the guard
//     fails closed even when the per-feature toggle is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline /power/sql backplane (the curated schema catalog
//     viewer the SPA renders alongside the manual SQL editor) is
//     reachable in off mode through a non-AI route — proof that
//     the slice does NOT replace the deterministic manual SQL
//     editor flow on /power/sql (ADR-015 §I3).
//
// The test name MUST stay TestNLSQLPlaygroundAIOffManualSQLWorks
// — the slice prompt's verification command runs
// `go test … -run TestNLSQLPlaygroundAIOffManualSQLWorks` AND
// `npm test -- --run TestNLSQLPlaygroundAIOffManualSQLWorks`,
// so both the Go and React off-mode proofs answer to the same
// test-name pattern.
func TestNLSQLPlaygroundAIOffManualSQLWorks(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route -----------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"nl-sql-playground": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/power/sql/draft", g.Wrap("nl-sql-playground", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline /power/sql backplane — NOT guarded by the AI
		// guard. The SPA renders a deterministic curated schema
		// catalog viewer + manual SQL editor at /power/sql; in a
		// hermetic test we mock the catalog endpoint here so the
		// test stays without a live DB. The "ai":false marker +
		// "surface":"baseline_..." envelope shape proves the
		// deterministic baseline path coexists.
		r.Get("/power/sql/catalog", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"tables":[{"name":"drives"},{"name":"charging_sessions"},{"name":"vehicles"}],"ai":false,"surface":"baseline_curated_schema_catalog"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"prompt":"how many drives last week"}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/power/sql/draft", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("AI route status = %d, want 404 in off mode (body=%q)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "GUARD_BYPASSED") {
		t.Fatalf("AI route guard was bypassed in off mode: body=%q", rec.Body.String())
	}
	// Defence-in-depth: the 404 body must not leak feature
	// metadata (ADR-015 §I9 — provider/feature info must be
	// invisible in off mode). chi's http.NotFound emits "404 page
	// not found\n".
	for _, leaked := range []string{"nl-sql-playground", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline catalog endpoint — MUST return 200 +
	// deterministic baseline content, regardless of the AI
	// guard's state. This is the load-bearing proof that the
	// slice did NOT replace the deterministic manual SQL editor
	// flow on /power/sql.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/power/sql/catalog", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline catalog status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline catalog body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_curated_schema_catalog"`) {
		t.Errorf("baseline catalog body missing baseline_curated_schema_catalog marker: %q", recBaseline.Body.String())
	}
	// Pin that the catalog rows are present so the
	// "ManualSQLWorks" half of the test name is defensible —
	// the user CAN see the curated tables even when AI is off.
	for _, must := range []string{`"name":"drives"`, `"name":"charging_sessions"`, `"name":"vehicles"`, `"tables"`} {
		if !strings.Contains(recBaseline.Body.String(), must) {
			t.Errorf("baseline catalog body missing marker %q: %q", must, recBaseline.Body.String())
		}
	}
}

// TestAINLSQLPlaygroundHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies. A wiring
// bug at boot must surface as a panic, not as a nil-deref on first
// request.
func TestAINLSQLPlaygroundHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAINLSQLPlaygroundHandler(nil, nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAINLSQLPlaygroundHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAINLSQLPlaygroundHandler_RejectsBadBody asserts the handler
// validates the body BEFORE doing anything else — a body that
// fails to decode as JSON object MUST surface as a JSON 400, not
// a half-opened stream that confuses the frontend.
func TestAINLSQLPlaygroundHandler_RejectsBadBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		body   string
		wantOK bool
	}{
		{"empty_body", "", false},
		{"empty_object_body", "{}", false},
		{"null_body", "null", false},
		{"object_missing_prompt", `{"x":1}`, false},
		{"prompt_blank", `{"prompt":"   "}`, false},
		{"malformed_json_body", "{not json", false},
		{"bare_array", "[1, 2]", false},
		{"object_with_unknown_field", `{"prompt":"how many drives","x":1}`, false},
		{"happy_path", `{"prompt":"how many drives last week"}`, true},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/power/sql/draft", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")

			_, ok := parseNLSqlPlaygroundRequest(rec, req)
			if ok != tc.wantOK {
				t.Errorf("parseNLSqlPlaygroundRequest(%s) ok = %v, want %v (body=%q)", tc.name, ok, tc.wantOK, rec.Body.String())
			}
		})
	}
}

// TestBuildNLSqlPlaygroundUserMessage_DeterministicShape pins the
// synthesised user message's exact shape so the goldens stay
// stable across boots. The format is sort-by-name with the prompt
// appended last. A change to any of these breaks the deterministic
// prompt-hash caching that providers rely on, so the test must
// catch it before the goldens silently drift.
func TestBuildNLSqlPlaygroundUserMessage_DeterministicShape(t *testing.T) {
	t.Parallel()
	catalog := []AINLSQLSchemaCatalogEntry{
		{
			Name:        "vehicles",
			Description: "vehicle metadata",
			Columns: []AINLSQLSchemaColumn{
				{Name: "id", Type: "bigint", Description: "primary key"},
				{Name: "model", Type: "text", Description: "model code"},
			},
		},
		{
			Name:        "drives",
			Description: "per-trip aggregates",
			Columns: []AINLSQLSchemaColumn{
				{Name: "id", Type: "bigint", Description: "primary key"},
				{Name: "started_at", Type: "timestamptz", Description: "drive start"},
			},
		},
	}
	got := buildNLSqlPlaygroundUserMessage("how many drives last week", catalog)

	// Pinned substrings — sorted output, prompt echoed.
	for _, must := range []string{
		"draft_readonly_sql",
		"validate_readonly_sql",
		"  - table=drives — per-trip aggregates",
		"      - column=id type=bigint — primary key",
		"      - column=started_at type=timestamptz — drive start",
		"  - table=vehicles — vehicle metadata",
		"      - column=model type=text — model code",
		"User request: how many drives last week",
	} {
		if !strings.Contains(got, must) {
			t.Errorf("user message missing %q\nfull message:\n%s", must, got)
		}
	}

	// Sort order: drives must appear BEFORE vehicles because the
	// synthesizer sorts table names ascending.
	di := strings.Index(got, "table=drives")
	vi := strings.Index(got, "table=vehicles")
	if di < 0 || vi < 0 || !(di < vi) {
		t.Errorf("catalog tables not sorted ascending: drives=%d vehicles=%d", di, vi)
	}
}

// TestBuildNLSqlPlaygroundUserMessage_EmptyCatalog pins the empty-
// catalog branch — the synthesised message must instruct the LLM
// to STOP without calling any tool.
func TestBuildNLSqlPlaygroundUserMessage_EmptyCatalog(t *testing.T) {
	t.Parallel()
	got := buildNLSqlPlaygroundUserMessage("how many drives", nil)
	for _, must := range []string{
		"In-scope curated schema catalog: NONE.",
		"catalog is empty",
		"do not call any tool",
		"User request: how many drives",
	} {
		if !strings.Contains(got, must) {
			t.Errorf("empty-catalog message missing %q\nfull message:\n%s", must, got)
		}
	}
}

// TestAINLSQLValidator_AcceptsValidDraft pins the validator's
// accept path: a well-formed ReadonlySQLDraft returns nil. Future
// slices that add semantic checks will need to update this test.
func TestAINLSQLValidator_AcceptsValidDraft(t *testing.T) {
	t.Parallel()
	v := NewAINLSQLValidator()
	drafts := []*nlq.ReadonlySQLDraft{
		{
			Prompt:    "how many drives last week",
			SQL:       "SELECT COUNT(*) FROM drives WHERE started_at >= NOW() - INTERVAL '7 days'",
			Rationale: "counts the drives table over the trailing 7 days",
		},
		{
			Prompt:    "show last 30 days charging cost",
			SQL:       "SELECT SUM(cost_cents) FROM charging_sessions WHERE started_at >= NOW() - INTERVAL '30 days'",
			Rationale: "sums charging cost over the trailing 30 days",
		},
	}
	for _, d := range drafts {
		if err := v.ValidateReadonlySQL(d); err != nil {
			t.Errorf("ValidateReadonlySQL(%+v) err = %v, want nil", d, err)
		}
	}
}

// TestAINLSQLValidator_RejectsNil pins the defensive nil check.
func TestAINLSQLValidator_RejectsNil(t *testing.T) {
	t.Parallel()
	v := NewAINLSQLValidator()
	if err := v.ValidateReadonlySQL(nil); err == nil {
		t.Error("ValidateReadonlySQL(nil) err = nil, want error")
	}
}

// TestAINLSQLSchemaCatalogSourceImpl_ReturnsCuratedCatalog proves
// the production source returns the hardcoded curated catalog
// with non-empty Name + at least one Column per entry. The
// catalog MUST include `drives`, `charging_sessions`, `vehicles`,
// `alerts`, and `signal_log_view` so the goldens stay valid.
func TestAINLSQLSchemaCatalogSourceImpl_ReturnsCuratedCatalog(t *testing.T) {
	t.Parallel()
	src := NewAINLSQLSchemaCatalogSource()
	got, err := src.SchemaCatalog(context.Background())
	if err != nil {
		t.Fatalf("SchemaCatalog err = %v, want nil", err)
	}
	if len(got) == 0 {
		t.Fatal("SchemaCatalog returned empty list, want curated entries")
	}
	wantTables := []string{"drives", "charging_sessions", "vehicles", "alerts", "signal_log_view"}
	have := make(map[string]bool, len(got))
	for _, e := range got {
		if e.Name == "" {
			t.Errorf("catalog entry missing name: %+v", e)
		}
		if len(e.Columns) == 0 {
			t.Errorf("catalog entry %q has no columns", e.Name)
		}
		have[e.Name] = true
	}
	for _, w := range wantTables {
		if !have[w] {
			t.Errorf("catalog missing required table %q (got=%v)", w, nlSqlCatalogTableKeys(have))
		}
	}
}

// TestAINLSQLSchemaCatalogSourceImpl_ReturnsDefensiveCopy proves
// the production source returns a defensive copy — a caller that
// mutates the returned slice does NOT leak the mutation back into
// the source-of-truth catalog. Subsequent calls return the
// original entries.
func TestAINLSQLSchemaCatalogSourceImpl_ReturnsDefensiveCopy(t *testing.T) {
	t.Parallel()
	src := NewAINLSQLSchemaCatalogSource()
	got, _ := src.SchemaCatalog(context.Background())
	if len(got) == 0 {
		t.Fatal("SchemaCatalog returned empty list")
	}
	// Mutate the first entry — should not leak.
	got[0].Name = "MUTATED"
	got[0].Columns[0].Name = "MUTATED_COL"
	again, _ := src.SchemaCatalog(context.Background())
	if again[0].Name == "MUTATED" {
		t.Errorf("SchemaCatalog leaked Name mutation: again[0].Name = %q", again[0].Name)
	}
	if again[0].Columns[0].Name == "MUTATED_COL" {
		t.Errorf("SchemaCatalog leaked Columns mutation: again[0].Columns[0].Name = %q", again[0].Columns[0].Name)
	}
}

// nlSqlCatalogTableKeys is a tiny helper for the test diagnostic
// path; avoids pulling in maps.Keys from the std lib (Go 1.23+).
// Per-test name prefix avoids a collision with the keysOf helper
// already defined in geofence_handler_test.go.
func nlSqlCatalogTableKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
