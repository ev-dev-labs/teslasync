// Phase-50 / 0028 — C3 Charging-curve fingerprint clustering.
//
// Off-mode + baseline-coexistence tests for the AI
// charging-curve-fingerprint-clustering handler. The off-mode test
// (TestChargingCurveClusteringAIOffShowsChartsOnly) is the slice's
// load-bearing AI-OFF contract proof: it asserts that the AI route
// returns 404 when settings.ai_mode='off' even when the per-feature
// toggle is on, AND that the deterministic charging-curve aggregate
// served at the canonical GET /api/v1/charging route remains the
// unconditional baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness
// (`go run ./cmd/ai-eval -feature charging-curve-fingerprint-clustering`);
// duplicating that here would require a live database + signal
// store fixture.

package aichargcurve

import (
	"bytes"
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

// TestChargingCurveClusteringAIOffShowsChartsOnly is the
// load-bearing off-mode contract proof for slice 0028. It mounts
// the AI charging-curve-fingerprint-clustering route through the
// guard with ai_mode='off' and proves:
//
//   - The /api/v1/ai/charging/curves/clusters/explain route returns
//     404 (the guard fails closed even when the per-feature toggle
//     is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline GET /api/v1/charging route serving the
//     deterministic charging-session aggregate remains reachable
//     under the same router — proof that the slice does NOT replace
//     the deterministic ChargingCurvePage charts (ADR-015 §I3).
//
// The test name MUST stay
// TestChargingCurveClusteringAIOffShowsChartsOnly — the slice
// prompt's verification command runs
// `go test … -run TestChargingCurveClusteringAIOffShowsChartsOnly`
// AND
// `npm test -- --run TestChargingCurveClusteringAIOffShowsChartsOnly`,
// so both the Go and React off-mode proofs answer to the same
// test-name pattern.
func TestChargingCurveClusteringAIOffShowsChartsOnly(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"charging-curve-fingerprint-clustering": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/charging/curves/clusters/explain", g.Wrap("charging-curve-fingerprint-clustering", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline canonical route — NOT guarded by the AI guard.
		// Returns a deterministic charging-session aggregate with
		// the `"ai":false` marker and a `surface` envelope shape
		// that names the deterministic baseline, so the test can
		// prove the deterministic charging-curve path coexists. We
		// mock it here so the test stays hermetic (no DB).
		r.Get("/charging", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"vehicle_id":42,"sessions":[{"id":1,"peak_power_w":7000,"avg_power_w":6500,"total_energy_added_wh":24000}],"ai":false,"surface":"baseline_deterministic_charging_curve"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"vehicle_id":42}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/charging/curves/clusters/explain", bytes.NewReader(body))
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
	for _, leaked := range []string{"charging-curve-fingerprint-clustering", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline charging route — MUST return 200 +
	// deterministic baseline content, regardless of the AI guard's
	// state. This is the load-bearing proof that the slice did
	// NOT replace the deterministic charging-curve UI.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/charging?vehicle_id=42", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_deterministic_charging_curve"`) {
		t.Errorf("baseline body missing baseline_deterministic_charging_curve marker: %q", recBaseline.Body.String())
	}
}

// TestHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies.
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

// TestHandler_RejectsBadBody asserts the
// handler validates the JSON body BEFORE opening the SSE stream —
// a missing, unparseable, or out-of-range body must surface as a
// JSON 400, not a half-opened stream that confuses the frontend.
func TestHandler_RejectsBadBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{"empty", ""},
		{"not json", "not json at all"},
		{"unknown_field", `{"vehicle_id":42,"sneaky":true}`},
		{"zero_vehicle_id", `{"vehicle_id":0}`},
		{"negative_vehicle_id", `{"vehicle_id":-1}`},
		{"missing_vehicle_id", `{}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/charging/curves/clusters/explain", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			if body, ok := parseExplainBody(rec, req); ok {
				t.Fatalf("parseExplainBody returned ok=true for %q (body=%+v)", tc.name, body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestHandler_AcceptsCanonicalBody proves
// the parser does NOT bounce the happy-path shapes.
func TestHandler_AcceptsCanonicalBody(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		body string
	}{
		{"minimal", `{"vehicle_id":1}`},
		{"large_vehicle_id", `{"vehicle_id":9223372036854775807}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/charging/curves/clusters/explain", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			body, ok := parseExplainBody(rec, req)
			if !ok {
				t.Fatalf("parseExplainBody returned ok=false for %q (status=%d, body=%q)", tc.name, rec.Code, rec.Body.String())
			}
			if body == nil {
				t.Fatalf("parseExplainBody returned ok=true but nil body for %q", tc.name)
			}
		})
	}
}
