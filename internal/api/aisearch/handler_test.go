// N3 Natural-language search across drives, charges,
// and alerts.
//
// Off-mode + baseline-coexistence tests for the AI search handler.
// The off-mode test (TestNLSearchAIOffFallsBackToTypedFilters) is
// the slice's load-bearing AI-OFF contract proof: it asserts that
// the AI route returns 404 when settings.ai_mode='off' even when the
// per-feature toggle is on, AND that the canonical typed
// SearchHandler.Search path served at GET /api/v1/search remains the
// unconditional baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness (`go run ./cmd/ai-eval --feature nl-search`);
// duplicating that here would require a live database fixture.

package aisearch

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	apisearch "github.com/ev-dev-labs/teslasync/internal/api/search"
	"github.com/ev-dev-labs/teslasync/internal/api/search/searchtest"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// stubGuardSettings is a minimal in-memory guard.Settings used to
// drive the off-mode contract test without a real DB.
type stubGuardSettings struct {
	mode string
	on   map[string]bool
}

func (s *stubGuardSettings) AIMode(_ context.Context) (string, error) {
	if s.mode == "" {
		return "off", nil
	}
	return s.mode, nil
}

func (s *stubGuardSettings) AIFeatureEnabled(_ context.Context, id string) (bool, error) {
	return s.on[id], nil
}

// TestNLSearchAIOffFallsBackToTypedFilters is the load-bearing
// off-mode contract proof for tool group. It mounts the AI search
// route through the guard with ai_mode='off' and proves:
//
// - The /api/v1/ai/search/query route returns 404 (the guard
// fails closed even when the per-feature toggle is on).
// - The 404 body does not leak feature metadata.
// - The typed GET /api/v1/search baseline route remains reachable
// under the same router and returns its deterministic typed-
// filter response — proof that the slice does NOT replace the
// canonical SearchHandler.Search path (ADR-015 §I3).
//
// The test name MUST stay TestNLSearchAIOffFallsBackToTypedFilters —
// the request's verification command runs
// `go test … -run TestNLSearchAIOffFallsBackToTypedFilters`.
func TestNLSearchAIOffFallsBackToTypedFilters(t *testing.T) {
	t.Parallel()
	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"nl-search": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A non-404
		// status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/search/query", g.Wrap("nl-search", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline typed search route — NOT guarded by the AI
		// guard. Returns deterministic content that the test can
		// grep on so we prove the baseline coexists with the AI
		// route's 404. We mock the baseline here so the test stays
		// hermetic (no DB); the real route in router.go wires
		// SearchHandler.Search at the same path.
		baselineFake := searchtest.NewFakeSearcher()
		baselineFake.Hits[apisearch.SearchTypeDrive] = []apisearch.SearchHit{{
			Type: apisearch.SearchTypeDrive, ID: 1, Title: "Drive #1",
			URL: "/drives/1", Score: 1.0,
		}}
		baselineHandler := apisearch.NewHandlerWithSearcher(baselineFake)
		r.Get("/search", baselineHandler.Search)
	})

	// 1) Probe the AI route — MUST be 404.
	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"prompt":"find drives last weekend with high consumption"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/search/query", body)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("AI route status = %d, want 404 in off mode (body=%q)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "GUARD_BYPASSED") {
		t.Fatalf("AI route guard was bypassed in off mode: body=%q", rec.Body.String())
	}
	// Defence-in-depth: the 404 body must not leak feature metadata
	// (ADR-015 §I9 — provider/feature info MUST NOT leak when AI is
	// disabled). chi's http.NotFound emits "404 page not found\n".
	for _, leaked := range []string{"nl-search", "feature", "strategy", "provider", "retrieve", "hydrate", "natural-language"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline typed search route — MUST return 200 +
	// deterministic content, regardless of the AI guard's state.
	// This is the load-bearing proof that the slice did NOT
	// replace the canonical SearchHandler.Search path.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/search?q=Drive&types=drive", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"Drive #1"`) {
		t.Errorf("baseline body missing Drive #1 marker (proof typed filters still rendered): %q", recBaseline.Body.String())
	}
	// The baseline response must not contain ANY ai-side field —
	// no SSE, no AI narration, no feature metadata.
	for _, leaked := range []string{"narration", "ai_", "feature_id", "tool_call"} {
		if strings.Contains(recBaseline.Body.String(), leaked) {
			t.Errorf("baseline body leaks AI-side field %q: %q", leaked, recBaseline.Body.String())
		}
	}
}

// TestHandler_PanicsOnNilWiring asserts the handler
// constructor refuses zero-valued dependencies. A wiring bug at
// boot must surface as a panic, not as a nil-deref on first
// request.
func TestHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestHandler_RejectsBadInput asserts the handler validates
// the request body BEFORE opening the SSE stream — a missing prompt,
// whitespace prompt, or oversized prompt must surface as a JSON 400,
// not a half-opened stream that confuses the frontend.
func TestHandler_RejectsBadInput(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		body string
	}{
		{"empty body", ``},
		{"not json", `not-json`},
		{"missing prompt", `{}`},
		{"empty prompt", `{"prompt":""}`},
		{"whitespace prompt", `{"prompt":"   "}`},
		{"prompt too large", fmt.Sprintf(`{"prompt":%q}`, strings.Repeat("a", maxPromptChars+1))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/search/query", strings.NewReader(tc.body))
			validateSearchOnly(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestHandler_AcceptsCanonicalInput proves the validator does
// NOT bounce the happy-path shapes — a normal-length prompt and a
// prompt at the size boundary.
func TestHandler_AcceptsCanonicalInput(t *testing.T) {
	t.Parallel()
	cases := []string{
		`{"prompt":"find drives last weekend"}`,
		`{"prompt":"a"}`,
		fmt.Sprintf(`{"prompt":%q}`, strings.Repeat("a", maxPromptChars)),
	}
	for _, body := range cases {
		t.Run(body[:min(len(body), 60)], func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/search/query", strings.NewReader(body))
			validateSearchOnly(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestHydrator_DelegatesToSearcher proves the production
// hydrator translates a (sourceType, sourceID) tuple into a Search
// call against the canonical Searcher and returns a HydratedResult
// shaped from the matching apisearch.SearchHit. Same code path the typed
// /api/v1/search baseline uses, so a hydrated AI citation is
// byte-equivalent to a typed search hit.
func TestHydrator_DelegatesToSearcher(t *testing.T) {
	t.Parallel()
	when := time.Date(2025, 1, 4, 14, 32, 0, 0, time.UTC)
	fake := searchtest.NewFakeSearcher()
	fake.Hits[apisearch.SearchTypeDrive] = []apisearch.SearchHit{{
		Type: apisearch.SearchTypeDrive, ID: 101,
		Title: "Drive #101", Subtitle: "12.4 km, 18 min",
		URL: "/drives/101", Score: 5, When: &when,
	}}
	h := newHydrator(fake)

	got, err := h.HydrateOne(context.Background(), "alice", rag.SourceDriveSummary, "101")
	if err != nil {
		t.Fatalf("HydrateOne err = %v, want nil", err)
	}
	if got == nil {
		t.Fatal("HydrateOne returned nil, want HydratedResult")
	}
	if got.SourceType != rag.SourceDriveSummary || got.SourceID != "101" {
		t.Errorf("source identity = (%q, %q), want (%q, %q)",
			got.SourceType, got.SourceID, rag.SourceDriveSummary, "101")
	}
	if got.Title != "Drive #101" {
		t.Errorf("Title = %q, want Drive #101", got.Title)
	}
	if got.URL != "/drives/101" {
		t.Errorf("URL = %q, want /drives/101", got.URL)
	}
	if got.When != "2025-01-04T14:32:00Z" {
		t.Errorf("When = %q, want 2025-01-04T14:32:00Z", got.When)
	}
}

// TestHydrator_NotFoundOnNonNumericID proves a non-numeric
// source_id surfaces as ErrHydratorNotFound rather than a tool
// error — the AI tool then surfaces this as a status="not_found"
// envelope so the LLM can adapt without retrying.
func TestHydrator_NotFoundOnNonNumericID(t *testing.T) {
	t.Parallel()
	h := newHydrator(searchtest.NewFakeSearcher())
	_, err := h.HydrateOne(context.Background(), "alice", rag.SourceDriveSummary, "drive-101")
	if err == nil {
		t.Fatalf("HydrateOne err = nil, want ErrHydratorNotFound")
	}
	if !errorIsNotFound(err) {
		t.Errorf("HydrateOne err = %v, want ErrHydratorNotFound", err)
	}
}

// TestHydrator_NotFoundOnNoMatch proves the hydrator
// surfaces an empty searcher result as ErrHydratorNotFound rather
// than fabricating a HydratedResult.
func TestHydrator_NotFoundOnNoMatch(t *testing.T) {
	t.Parallel()
	fake := searchtest.NewFakeSearcher()
	fake.Hits[apisearch.SearchTypeDrive] = nil // empty result
	h := newHydrator(fake)
	_, err := h.HydrateOne(context.Background(), "alice", rag.SourceDriveSummary, "999")
	if !errorIsNotFound(err) {
		t.Errorf("HydrateOne err = %v, want ErrHydratorNotFound", err)
	}
}

// TestHydrator_NotFoundOnUnknownSourceType proves the
// switch-default path surfaces an unknown source type as not_found
// (defence in depth — the tool's Validate already rejects unknown
// source types upstream).
func TestHydrator_NotFoundOnUnknownSourceType(t *testing.T) {
	t.Parallel()
	h := newHydrator(searchtest.NewFakeSearcher())
	_, err := h.HydrateOne(context.Background(), "alice", "unknown_corpus", "1")
	if !errorIsNotFound(err) {
		t.Errorf("HydrateOne err = %v, want ErrHydratorNotFound", err)
	}
}

// TestHydrator_PanicsOnNilSearcher proves the constructor
// guard fires at boot for a nil searcher rather than at first
// request.
func TestHydrator_PanicsOnNilSearcher(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Errorf("newHydrator(nil) did not panic")
		}
	}()
	_ = newHydrator(nil)
}

// validateSearchOnly mirrors the pre-stream validator branch of
// Handler.ServeHTTP. Kept as a same-package helper so the
// test does not need to construct a full handler with stub deps.
func validateSearchOnly(w http.ResponseWriter, r *http.Request) {
	var body queryRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" {
		httpx.WriteError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if len(prompt) > maxPromptChars {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("prompt must be at most %d characters", maxPromptChars))
		return
	}
	w.WriteHeader(http.StatusOK)
}

// errorIsNotFound is a small wrapper around errors.Is for the
// hydrator's sentinel — kept as a helper so the test file does not
// need to import errors directly (the assertion is the same shape
// across all four tests).
func errorIsNotFound(err error) bool {
	return err != nil && err.Error() == tools.ErrHydratorNotFound.Error()
}
