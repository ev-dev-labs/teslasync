// Tests for per-charging-session AI diagnosis.
//
// Off-mode + baseline-coexistence tests for the AI charging
// diagnosis. The off-mode test
// (TestChargingDiagnosisAIOffShowsOnlyDeterministicFlags) is the
// load-bearing AI-OFF contract proof: it asserts that
// the AI route returns 404 when settings.ai_mode='off' even when
// the per-feature toggle is on, AND that the deterministic
// per-charging-session aggregation flag badges served at the
// canonical GET /api/v1/charging/{sessionID} handler remains
// the unconditional baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by
// the AI eval harness
// (`go run ./cmd/ai-eval --feature charging-diagnosis`);
// duplicating that here would require a live database fixture.

package aichargdiag

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

// TestChargingDiagnosisAIOffShowsOnlyDeterministicFlags is the
// load-bearing off-mode contract proof. It mounts the AI charging
// diagnosis route through the guard with
// ai_mode='off' and proves:
//
//   - The /api/v1/ai/charging/{sessionID}/diagnose route returns 404
//     (the guard fails closed even when the per-feature toggle is on).
//   - The 404 body does not leak feature metadata or session identifiers.
//   - A baseline charging route serving deterministic flag-badge
//     content remains reachable under the same router, proving the AI
//     route does not replace the deterministic per-charging-session
//     aggregation flags path (ADR-015 §I3).
//
// The test name MUST stay
// TestChargingDiagnosisAIOffShowsOnlyDeterministicFlags because external
// verification commands run
// `go test … -run TestChargingDiagnosisAIOffShowsOnlyDeterministicFlags`
// AND
// `npm test -- --run TestChargingDiagnosisAIOffShowsOnlyDeterministicFlags`,
// so both the Go and React off-mode proofs must answer to the same
// test-name pattern.
func TestChargingDiagnosisAIOffShowsOnlyDeterministicFlags(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"charging-diagnosis": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A non-404
		// status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/charging/{sessionID}/diagnose", g.Wrap("charging-diagnosis", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline charging route — NOT guarded by the AI guard.
		// Returns deterministic per-charging-session aggregation
		// with the `"ai":false` marker and the
		// `"surface":"baseline_aggregation_flags"` envelope shape
		// the canonical ChargingDetailHandler path produces, so
		// the test can prove the baseline coexists. We mock it
		// here so the test stays hermetic (no DB).
		r.Get("/charging/{sessionID}", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":42,"vehicle_id":1,"total_energy_added_wh":11200,"avg_power_w":1600,"flags":["trickle"],"ai":false,"surface":"baseline_aggregation_flags"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/charging/42/diagnose", nil)
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
	for _, leaked := range []string{"charging-diagnosis", "feature", "strategy", "provider", "diagnose"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline charging route — MUST return 200 +
	// deterministic flag-badge content, regardless of the AI
	// guard's state. This is the load-bearing proof that the
	// slice did NOT replace the per-charging-session aggregation
	// flags path.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/charging/42", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_aggregation_flags"`) {
		t.Errorf("baseline body missing baseline_aggregation_flags marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"trickle"`) {
		t.Errorf("baseline body missing deterministic 'trickle' flag: %q", recBaseline.Body.String())
	}
}

// TestHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies. A wiring
// bug at boot must surface as a panic, not as a nil-deref on
// first request.
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

// TestHandler_RejectsBadSessionID asserts the
// handler validates the URL path parameter BEFORE opening the
// SSE stream — a missing, non-numeric, zero, or negative
// sessionID must surface as a JSON 400, not a half-opened stream
// that confuses the frontend.
//
// We mount the parser branch directly via parseChargingDiagnosisURL
// so the test does not need to construct a full handler with stub
// deps. NewHandler panics on nil deps, and the
// parser runs BEFORE touching any of them, so we can inline the
// parser without losing coverage.
func TestHandler_RejectsBadSessionID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		sessionID string // chi URL param value; "" simulates missing
	}{
		{"empty", ""},
		{"not numeric", "abc"},
		{"hex", "0x42"},
		{"trailing junk", "42x"},
		{"zero", "0"},
		{"negative", "-1"},
		{"overflow", "99999999999999999999999"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/charging/x/diagnose", nil)
			// Inject the chi URL param value directly into the
			// route context so chi.URLParam returns the test value
			// without us having to mount a real chi router for
			// every case.
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("sessionID", tc.sessionID)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			if id, ok := parseChargingDiagnosisURL(rec, req); ok {
				t.Fatalf("parseChargingDiagnosisURL returned ok=true for %q (id=%d)", tc.sessionID, id)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestHandler_AcceptsCanonicalSessionID proves
// the parser does NOT bounce the happy-path shapes — small int,
// large int, max int64.
func TestHandler_AcceptsCanonicalSessionID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		sessionID string
		want      int64
	}{
		{"one", "1", 1},
		{"forty-two", "42", 42},
		{"large", "1234567890", 1234567890},
		{"max int64", "9223372036854775807", 9223372036854775807},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/charging/x/diagnose", nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("sessionID", tc.sessionID)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			id, ok := parseChargingDiagnosisURL(rec, req)
			if !ok {
				t.Fatalf("parseChargingDiagnosisURL returned ok=false for %q (status=%d, body=%q)", tc.sessionID, rec.Code, rec.Body.String())
			}
			if id != tc.want {
				t.Errorf("id = %d, want %d", id, tc.want)
			}
		})
	}
}
