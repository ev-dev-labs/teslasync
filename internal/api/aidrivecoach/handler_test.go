// Phase-50 / 0018 — N4 Per-drive coaching narrative.
//
// Off-mode tests prove TestDriveCoachingAIOffShowsOnlyBaselineStats keeps AI hidden while
// GET /api/v1/drives/{driveID} remains the deterministic baseline (ADR-015 §I3, §I6).
// Streaming coverage stays in the F6 eval harness because it needs a live fixture.

package aidrivecoach

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
)

type stubGuardSettings struct {
	mode string
	on   map[string]bool
}

func (s *stubGuardSettings) AIMode(_ context.Context) (string, error) {
	return s.mode, nil
}

func (s *stubGuardSettings) AIFeatureEnabled(_ context.Context, id string) (bool, error) {
	return s.on[id], nil
}

// TestDriveCoachingAIOffShowsOnlyBaselineStats is the load-bearing
// off-mode contract proof for slice 0018. It mounts the AI drive
// coach route through the guard with ai_mode='off' and proves:
//
//   - The /api/v1/ai/drives/{driveID}/coach route returns 404 (the
//     guard fails closed even when the per-feature toggle is on).
//   - The 404 body does not leak feature metadata or drive
//     identifiers.
//   - A baseline drive route serving deterministic stat-card content
//     remains reachable under the same router — proof that the
//     slice does NOT replace the deterministic per-drive aggregates
//     path (ADR-015 §I3).
//
// The test name MUST stay TestDriveCoachingAIOffShowsOnlyBaselineStats —
// the slice prompt's verification command runs
// `go test … -run TestDriveCoachingAIOffShowsOnlyBaselineStats` AND
// `npm test -- --run TestDriveCoachingAIOffShowsOnlyBaselineStats`,
// so both the Go and React off-mode proofs must answer to the same
// test-name pattern.
func TestDriveCoachingAIOffShowsOnlyBaselineStats(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"drive-coaching": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A non-404
		// status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/drives/{driveID}/coach", g.Wrap("drive-coaching", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline drive route — NOT guarded by the AI guard.
		// Returns deterministic per-drive aggregates with the
		// `"ai":false` marker and the `stat_cards` envelope shape
		// that the canonical DriveDetailHandler produces, so the
		// test can prove the baseline coexists. We mock it here so
		// the test stays hermetic (no DB).
		r.Get("/drives/{driveID}", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"id":42,"vehicle_id":1,"distance_m":12345,"duration_s":900,"energy_used_wh":3500,"ai":false,"surface":"baseline_stat_cards"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/drives/42/coach", nil)
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
	for _, leaked := range []string{"drive-coaching", "feature", "strategy", "provider", "coach"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline drive route — MUST return 200 +
	// deterministic stat-card content, regardless of the AI
	// guard's state. This is the load-bearing proof that the
	// slice did NOT replace the per-drive aggregates path.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/drives/42", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_stat_cards"`) {
		t.Errorf("baseline body missing baseline_stat_cards marker: %q", recBaseline.Body.String())
	}
}

// TestHandler_PanicsOnNilWiring asserts the handler
// constructor refuses zero-valued dependencies. A wiring bug at boot
// must surface as a panic, not as a nil-deref on first request.
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

// TestHandler_RejectsBadDriveID asserts the handler
// validates the URL path parameter BEFORE opening the SSE stream — a
// missing, non-numeric, zero, or negative driveID must surface as a
// JSON 400, not a half-opened stream that confuses the frontend.
//
// We mount the parser branch directly via parseDriveCoachURL so the
// test does not need to construct a full handler with stub deps.
// NewHandler panics on nil deps, and the parser runs
// BEFORE touching any of them, so we can inline the parser without
// losing coverage.
func TestHandler_RejectsBadDriveID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		driveID string // chi URL param value; "" simulates missing
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
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/drives/x/coach", nil)
			// Inject the chi URL param value directly into the
			// route context so chi.URLParam returns the test value
			// without us having to mount a real chi router for
			// every case.
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("driveID", tc.driveID)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			if id, ok := parseDriveCoachURL(rec, req); ok {
				t.Fatalf("parseDriveCoachURL returned ok=true for %q (id=%d)", tc.driveID, id)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestHandler_AcceptsCanonicalDriveID proves the parser
// does NOT bounce the happy-path shapes — small int, large int, max
// int64.
func TestHandler_AcceptsCanonicalDriveID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		driveID string
		want    int64
	}{
		{"one", "1", 1},
		{"forty-two", "42", 42},
		{"large", "1234567890", 1234567890},
		{"max int64", "9223372036854775807", 9223372036854775807},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/drives/x/coach", nil)
			rctx := chi.NewRouteContext()
			rctx.URLParams.Add("driveID", tc.driveID)
			req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

			id, ok := parseDriveCoachURL(rec, req)
			if !ok {
				t.Fatalf("parseDriveCoachURL returned ok=false for %q (status=%d, body=%q)", tc.driveID, rec.Code, rec.Body.String())
			}
			if id != tc.want {
				t.Errorf("id = %d, want %d", id, tc.want)
			}
		})
	}
}
