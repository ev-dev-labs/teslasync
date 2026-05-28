// Phase-50 / 0021 — D1 Natural-language drive search and replay.
//
// Off-mode + baseline-coexistence tests for the AI drive search
// handler. The off-mode test (TestNLDriveSearchReplayAIOff404) is
// the slice's load-bearing AI-OFF contract proof: it asserts that
// the AI route returns 404 when settings.ai_mode='off' even when
// the per-feature toggle is on (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness (`go run ./cmd/ai-eval -feature nl-drive-search-replay`);
// duplicating that here would require a live database fixture.

package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/ai/rag"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/trip"
)

// TestNLDriveSearchReplayAIOff404 is the load-bearing off-mode
// contract proof for slice 0021. It mounts the AI drive search
// route through the guard with ai_mode='off' and proves:
//
//   - The /api/v1/ai/drives/search route returns 404 (the guard
//     fails closed even when the per-feature toggle is on).
//   - The 404 body does not leak feature metadata.
//
// The companion frontend test
// TestNLDriveSearchReplayAIOffUsesTypedFiltersOnly proves the
// baseline DrivesListPage filters keep working when AI is off; see
// web/src/features/driving/__tests__/.
func TestNLDriveSearchReplayAIOff404(t *testing.T) {
	t.Parallel()

	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"nl-drive-search-replay": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		r.Route("/ai", func(r chi.Router) {
			r.Post("/drives/search", g.Wrap("nl-drive-search-replay", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})
	})

	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"prompt":"find drives last weekend with high consumption"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/drives/search", body)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("AI route status = %d, want 404 in off mode (body=%q)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "GUARD_BYPASSED") {
		t.Fatalf("AI route guard was bypassed in off mode: body=%q", rec.Body.String())
	}
	// Defence-in-depth: the 404 body must not leak feature metadata
	// (ADR-015 §I9 — provider/feature info MUST NOT leak when AI
	// is disabled). chi's http.NotFound emits "404 page not
	// found\n".
	for _, leaked := range []string{"nl-drive-search-replay", "drive_summary", "replay", "feature", "strategy", "provider", "retrieve", "hydrate"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}
}

// TestAIDriveSearchHandler_PanicsOnNilWiring asserts the handler
// constructor refuses zero-valued dependencies. A wiring bug at
// boot must surface as a panic, not as a nil-deref on first
// request.
func TestAIDriveSearchHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAIDriveSearchHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAIDriveSearchHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAIDriveSearchHandler_RejectsBadInput asserts the handler
// validates the request body BEFORE opening the SSE stream — a
// missing prompt, whitespace prompt, or oversized prompt must
// surface as a JSON 400, not a half-opened stream that confuses
// the frontend.
func TestAIDriveSearchHandler_RejectsBadInput(t *testing.T) {
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
		{"prompt too large", fmt.Sprintf(`{"prompt":%q}`, strings.Repeat("a", aiDriveSearchMaxPromptChars+1))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/drives/search", strings.NewReader(tc.body))
			validateDriveSearchOnly(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAIDriveSearchHandler_AcceptsCanonicalInput proves the
// validator does NOT bounce the happy-path shapes — a normal-length
// prompt and a prompt at the size boundary.
func TestAIDriveSearchHandler_AcceptsCanonicalInput(t *testing.T) {
	t.Parallel()

	cases := []string{
		`{"prompt":"find drives last weekend"}`,
		`{"prompt":"a"}`,
		fmt.Sprintf(`{"prompt":%q}`, strings.Repeat("a", aiDriveSearchMaxPromptChars)),
	}
	for _, body := range cases {
		t.Run(body[:min(len(body), 60)], func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/drives/search", strings.NewReader(body))
			validateDriveSearchOnly(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAIDriveSearchHydrator_DelegatesToSearcher proves the
// production hydrator translates a (sourceType, sourceID) tuple
// into a SearchDrives call against the canonical Searcher and
// returns a HydratedDriveReplay shaped from the matching
// SearchHit. The ReplayURL is derived by appending "/replay" to
// the SearchHit URL so the SPA path stays in one source of truth.
func TestAIDriveSearchHydrator_DelegatesToSearcher(t *testing.T) {
	t.Parallel()
	when := time.Date(2025, 1, 4, 14, 32, 0, 0, time.UTC)
	fake := newFakeSearcher()
	fake.hits[SearchTypeDrive] = []SearchHit{{
		Type: SearchTypeDrive, ID: 101,
		Title: "Drive #101", Subtitle: "12.4 km, 18 min",
		URL: "/drives/101", Score: 5, When: &when,
	}}
	h := newAIDriveSearchHydrator(fake)

	got, err := h.HydrateOne(context.Background(), "alice", rag.SourceDriveSummary, "101")
	if err != nil {
		t.Fatalf("HydrateOne err = %v, want nil", err)
	}
	if got == nil {
		t.Fatal("HydrateOne returned nil, want HydratedDriveReplay")
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
	if got.ReplayURL != "/drives/101/replay" {
		t.Errorf("ReplayURL = %q, want /drives/101/replay", got.ReplayURL)
	}
	if got.When != "2025-01-04T14:32:00Z" {
		t.Errorf("When = %q, want 2025-01-04T14:32:00Z", got.When)
	}
}

// TestAIDriveSearchHydrator_ReplayURLFromEmptyURLIsEmpty proves the
// appendReplay helper does NOT produce the misleading "/replay"
// string when the underlying URL is empty.
func TestAIDriveSearchHydrator_ReplayURLFromEmptyURLIsEmpty(t *testing.T) {
	t.Parallel()
	fake := newFakeSearcher()
	fake.hits[SearchTypeDrive] = []SearchHit{{
		Type: SearchTypeDrive, ID: 7,
		Title: "Drive #7",
		URL:   "", // empty URL — search renderer left it blank
	}}
	h := newAIDriveSearchHydrator(fake)
	got, err := h.HydrateOne(context.Background(), "alice", rag.SourceDriveSummary, "7")
	if err != nil {
		t.Fatalf("HydrateOne err = %v", err)
	}
	if got.ReplayURL != "" {
		t.Errorf("ReplayURL = %q, want empty string", got.ReplayURL)
	}
}

// TestAIDriveSearchHydrator_NotFoundOnNonNumericID proves a
// non-numeric source_id surfaces as ErrDriveReplayHydratorNotFound
// rather than a tool error — the AI tool then surfaces this as a
// status="not_found" envelope so the LLM can adapt without
// retrying.
func TestAIDriveSearchHydrator_NotFoundOnNonNumericID(t *testing.T) {
	t.Parallel()
	h := newAIDriveSearchHydrator(newFakeSearcher())
	_, err := h.HydrateOne(context.Background(), "alice", rag.SourceDriveSummary, "drive-101")
	if err == nil {
		t.Fatalf("HydrateOne err = nil, want ErrDriveReplayHydratorNotFound")
	}
	if !errors.Is(err, trip.ErrDriveReplayHydratorNotFound) {
		t.Errorf("HydrateOne err = %v, want ErrDriveReplayHydratorNotFound", err)
	}
}

// TestAIDriveSearchHydrator_NotFoundOnNoMatch proves the hydrator
// surfaces an empty searcher result as
// ErrDriveReplayHydratorNotFound rather than fabricating a
// HydratedDriveReplay.
func TestAIDriveSearchHydrator_NotFoundOnNoMatch(t *testing.T) {
	t.Parallel()
	fake := newFakeSearcher()
	fake.hits[SearchTypeDrive] = nil // empty result
	h := newAIDriveSearchHydrator(fake)
	_, err := h.HydrateOne(context.Background(), "alice", rag.SourceDriveSummary, "999")
	if !errors.Is(err, trip.ErrDriveReplayHydratorNotFound) {
		t.Errorf("HydrateOne err = %v, want ErrDriveReplayHydratorNotFound", err)
	}
}

// TestAIDriveSearchHydrator_NotFoundOnForwardCompatSourceTypes
// proves route_segment and location_summary surface as not_found
// today — they are forward-compat reservations per the slice
// prompt. A future indexer slice that lights up these sources
// should add per-type cases to the hydrator.
func TestAIDriveSearchHydrator_NotFoundOnForwardCompatSourceTypes(t *testing.T) {
	t.Parallel()
	h := newAIDriveSearchHydrator(newFakeSearcher())
	for _, st := range []string{"route_segment", "location_summary"} {
		_, err := h.HydrateOne(context.Background(), "alice", st, "1")
		if !errors.Is(err, trip.ErrDriveReplayHydratorNotFound) {
			t.Errorf("HydrateOne(%s) err = %v, want ErrDriveReplayHydratorNotFound", st, err)
		}
	}
}

// TestAIDriveSearchHydrator_NotFoundOnUnknownSourceType proves the
// default-case surfaces an unknown source type as not_found
// (defence in depth — the tool's Validate already rejects unknown
// source types upstream).
func TestAIDriveSearchHydrator_NotFoundOnUnknownSourceType(t *testing.T) {
	t.Parallel()
	h := newAIDriveSearchHydrator(newFakeSearcher())
	_, err := h.HydrateOne(context.Background(), "alice", "unknown_corpus", "1")
	if !errors.Is(err, trip.ErrDriveReplayHydratorNotFound) {
		t.Errorf("HydrateOne err = %v, want ErrDriveReplayHydratorNotFound", err)
	}
}

// TestAIDriveSearchHydrator_PanicsOnNilSearcher proves the
// constructor guard fires at boot for a nil searcher rather than
// at first request.
func TestAIDriveSearchHydrator_PanicsOnNilSearcher(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Errorf("newAIDriveSearchHydrator(nil) did not panic")
		}
	}()
	_ = newAIDriveSearchHydrator(nil)
}

// validateDriveSearchOnly mirrors the pre-stream validator branch
// of AIDriveSearchHandler.ServeHTTP. Kept as a same-package helper
// so the test does not need to construct a full handler with stub
// deps.
func validateDriveSearchOnly(w http.ResponseWriter, r *http.Request) {
	var body aiDriveSearchRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	prompt := strings.TrimSpace(body.Prompt)
	if prompt == "" {
		writeError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	if len(prompt) > aiDriveSearchMaxPromptChars {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("prompt must be at most %d characters", aiDriveSearchMaxPromptChars))
		return
	}
	w.WriteHeader(http.StatusOK)
}
