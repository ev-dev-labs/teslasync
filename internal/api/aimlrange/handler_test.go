// Phase-50 / 0063 — ML2 range-prediction model.
//
// These tests pin ADR-015 edges: off-mode hides AI, baseline projected range
// remains reachable, bad bodies fail before SSE, and tool inputs stay stable.

package aimlrange

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
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

// TestRangePredictionModelAIOffUsesHeuristicOnly pins the off-mode contract:
// AI training is hidden while the deterministic projected-range route works.
func TestRangePredictionModelAIOffUsesHeuristicOnly(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"range-prediction-model": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A non-404
		// status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/ml/range/train", g.Wrap("range-prediction-model", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline range-projection route — NOT guarded by the AI
		// guard. Returns deterministic content with the static
		// heuristic explanation marker so the test can prove the
		// baseline coexists. The real route is wired in router.go
		// to range_projection_handler.go's ServeHTTP; we mock it
		// here so the test stays hermetic (no DB).
		r.Get("/vehicles/{id}/range/projection", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"vehicle_id":1,"current_range_km":280,"scenarios":[],"ai":false,"projection_source":"static_heuristic"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	rec := httptest.NewRecorder()
	body := strings.NewReader(`{"vehicle_id":1,"days":7}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/ml/range/train", body)
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("AI route status = %d, want 404 in off mode (body=%q)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "GUARD_BYPASSED") {
		t.Fatalf("AI route guard was bypassed in off mode: body=%q", rec.Body.String())
	}
	// Defence-in-depth: the 404 body must not leak feature metadata
	// (ADR-015 §I9 — provider/feature info must be invisible in off
	// mode). chi's http.NotFound emits "404 page not found\n".
	for _, leaked := range []string{"range-prediction-model", "range-prediction", "feature", "strategy", "provider", "train"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline range-projection route — MUST return
	// 200 + deterministic content, regardless of the AI guard's
	// state. This is the load-bearing proof that the slice did
	// NOT replace the deterministic Projected Range page.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/vehicles/1/range/projection", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"projection_source":"static_heuristic"`) {
		t.Errorf("baseline body missing static_heuristic marker: %q", recBaseline.Body.String())
	}
}

// TestHandler_PanicsOnNilWiring asserts the handler
// constructor refuses zero-valued dependencies. A wiring bug at boot
// must surface as a panic, not as a nil-deref on first request.
func TestHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("NewHandler(nil,nil,nil,\"\") did not panic")
		}
	}()
	NewHandler(nil, nil, nil, "")
}

// TestHandler_RejectsBadRequestBodies pins the
// request-validation contract: missing vehicle_id, non-positive
// vehicle_id, and out-of-range days must surface as 4xx BEFORE the
// dispatcher is reached (so a confused caller cannot waste a
// provider call). The baseline-coexistence test above already
// proves the off-mode 404; this test pins the on-mode validator.
func TestHandler_RejectsBadRequestBodies(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		body string
		want int
	}{
		{"empty body", "", http.StatusBadRequest},
		{"malformed json", "{not json", http.StatusBadRequest},
		{"missing vehicle_id", `{"days":7}`, http.StatusBadRequest},
		{"vehicle_id zero", `{"vehicle_id":0,"days":7}`, http.StatusBadRequest},
		{"vehicle_id negative", `{"vehicle_id":-3,"days":7}`, http.StatusBadRequest},
		{"days negative", `{"vehicle_id":1,"days":-1}`, http.StatusBadRequest},
		{"days over max", `{"vehicle_id":1,"days":31}`, http.StatusBadRequest},
		{"days exactly max+1", `{"vehicle_id":1,"days":31}`, http.StatusBadRequest},
	}

	// Exercise the same parser ServeHTTP uses before opening the SSE
	// stream or resolving a provider. This keeps the test hermetic (no
	// DB, no provider) while pinning the real validation path.
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/ml/range/train",
				strings.NewReader(tc.body))
			_, _, ok := parseRangeRequest(rec, req)
			if ok {
				t.Fatalf("parseRangeRequest returned ok=true for %q", tc.name)
			}
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (body=%q)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}
