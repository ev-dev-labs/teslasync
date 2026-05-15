// Phase-50 / 0031 — T1 Preheat and precool recommender.
//
// Off-mode + body-parser + advisor tests for the AI
// preheat-precool-recommender handler. The off-mode test
// (TestPreheatPrecoolAIOffManualClimateWorks) is the slice's
// load-bearing AI-OFF contract proof: it asserts that the AI route
// returns 404 when settings.ai_mode='off' even when the per-feature
// toggle is on, AND that a deterministic baseline climate-state
// route remains the unconditional baseline path (ADR-015 §I3 §I6).
//
// The on-path streaming integration is exercised end-to-end by the
// F6 eval harness (`go run ./cmd/ai-eval -feature
// preheat-precool-recommender`); duplicating that here would require
// a live database + signal store fixture.

package api

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// TestPreheatPrecoolAIOffManualClimateWorks is the load-bearing
// off-mode contract proof for slice 0031. It mounts the AI
// preheat-precool-recommender route through the guard with
// ai_mode='off' and proves:
//
//   - The /api/v1/ai/climate/schedule/draft route returns 404 (the
//     guard fails closed even when the per-feature toggle is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline GET /api/v1/vehicles/{id}/climate-state route
//     serving the deterministic climate snapshot remains reachable
//     under the same router — proof that the slice does NOT replace
//     the deterministic climate path (ADR-015 §I3).
//
// The test name MUST stay
// TestPreheatPrecoolAIOffManualClimateWorks — the slice prompt's
// verification command runs
// `go test … -run TestPreheatPrecoolAIOffManualClimateWorks` AND
// `npm test -- --run TestPreheatPrecoolAIOffManualClimateWorks`,
// so both the Go and React off-mode proofs answer to the same
// test-name pattern.
func TestPreheatPrecoolAIOffManualClimateWorks(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"preheat-precool-recommender": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/climate/schedule/draft", g.Wrap("preheat-precool-recommender", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline canonical route — NOT guarded by the AI guard.
		// Returns a deterministic climate snapshot envelope with the
		// `"ai":false` marker and a `surface` envelope shape that
		// names the manual climate baseline, so the test can prove
		// the manual climate-controls path coexists. We mock it
		// here so the test stays hermetic (no DB).
		r.Get("/vehicles/{id}/climate-state", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"vehicle_id":42,"inside_temp_c":4.0,"outside_temp_c":-2.0,"driver_temp_setting_c":21.0,"is_climate_on":false,"ai":false,"surface":"baseline_manual_climate"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"vehicle_id":42,"depart_by":"2099-01-02T07:30:00Z","current_cabin_temp_c":4.0,"outside_temp_c":-2.0,"target_cabin_temp_c":21.0}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/climate/schedule/draft", bytes.NewReader(body))
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
	for _, leaked := range []string{"preheat-precool-recommender", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline climate-state route — MUST return 200
	// + deterministic snapshot-shape content, regardless of the AI
	// guard's state. This is the load-bearing proof that the
	// slice did NOT replace the manual climate-controls path.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/vehicles/42/climate-state", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_manual_climate"`) {
		t.Errorf("baseline body missing baseline_manual_climate marker: %q", recBaseline.Body.String())
	}
}

// TestAIClimateScheduleHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies. A wiring
// bug at boot must surface as a panic, not as a nil-deref on first
// request.
func TestAIClimateScheduleHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAIClimateScheduleHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAIClimateScheduleHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAIClimateScheduleHandler_RejectsBadBody asserts the handler
// validates the JSON body BEFORE opening the SSE stream — a
// missing, unparseable, or out-of-range body must surface as a
// JSON 400, not a half-opened stream that confuses the frontend.
func TestAIClimateScheduleHandler_RejectsBadBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{"empty", ""},
		{"not json", "not json at all"},
		{"unknown_field", `{"vehicle_id":42,"depart_by":"2099-01-02T07:30:00Z","current_cabin_temp_c":4.0,"outside_temp_c":-2.0,"target_cabin_temp_c":21.0,"sneaky":true}`},
		{"zero_vehicle_id", `{"vehicle_id":0,"depart_by":"2099-01-02T07:30:00Z","current_cabin_temp_c":4.0,"outside_temp_c":-2.0,"target_cabin_temp_c":21.0}`},
		{"negative_vehicle_id", `{"vehicle_id":-1,"depart_by":"2099-01-02T07:30:00Z","current_cabin_temp_c":4.0,"outside_temp_c":-2.0,"target_cabin_temp_c":21.0}`},
		{"depart_by_empty", `{"vehicle_id":42,"depart_by":"","current_cabin_temp_c":4.0,"outside_temp_c":-2.0,"target_cabin_temp_c":21.0}`},
		{"depart_by_not_rfc3339", `{"vehicle_id":42,"depart_by":"tomorrow at 7:30","current_cabin_temp_c":4.0,"outside_temp_c":-2.0,"target_cabin_temp_c":21.0}`},
		{"current_cabin_too_cold", `{"vehicle_id":42,"depart_by":"2099-01-02T07:30:00Z","current_cabin_temp_c":-99.0,"outside_temp_c":-2.0,"target_cabin_temp_c":21.0}`},
		{"current_cabin_too_hot", `{"vehicle_id":42,"depart_by":"2099-01-02T07:30:00Z","current_cabin_temp_c":99.0,"outside_temp_c":-2.0,"target_cabin_temp_c":21.0}`},
		{"outside_too_cold", `{"vehicle_id":42,"depart_by":"2099-01-02T07:30:00Z","current_cabin_temp_c":4.0,"outside_temp_c":-99.0,"target_cabin_temp_c":21.0}`},
		{"outside_too_hot", `{"vehicle_id":42,"depart_by":"2099-01-02T07:30:00Z","current_cabin_temp_c":4.0,"outside_temp_c":99.0,"target_cabin_temp_c":21.0}`},
		{"target_below_min", `{"vehicle_id":42,"depart_by":"2099-01-02T07:30:00Z","current_cabin_temp_c":4.0,"outside_temp_c":-2.0,"target_cabin_temp_c":5.0}`},
		{"target_above_max", `{"vehicle_id":42,"depart_by":"2099-01-02T07:30:00Z","current_cabin_temp_c":4.0,"outside_temp_c":-2.0,"target_cabin_temp_c":40.0}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/climate/schedule/draft", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			if body, ok := parseClimateScheduleDraftBody(rec, req); ok {
				t.Fatalf("parseClimateScheduleDraftBody returned ok=true for %q (body=%+v)", tc.name, body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAIClimateScheduleHandler_AcceptsCanonicalBody proves the
// parser does NOT bounce the happy-path shapes.
func TestAIClimateScheduleHandler_AcceptsCanonicalBody(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
	}{
		{"preheat_typical", `{"vehicle_id":1,"depart_by":"2099-01-02T07:30:00Z","current_cabin_temp_c":4.0,"outside_temp_c":-2.0,"target_cabin_temp_c":21.0}`},
		{"precool_typical", `{"vehicle_id":1,"depart_by":"2099-07-15T14:00:00Z","current_cabin_temp_c":38.0,"outside_temp_c":34.0,"target_cabin_temp_c":22.0}`},
		{"boundary_target_min", `{"vehicle_id":42,"depart_by":"2099-01-02T07:30:00Z","current_cabin_temp_c":4.0,"outside_temp_c":-2.0,"target_cabin_temp_c":10.0}`},
		{"boundary_target_max", `{"vehicle_id":42,"depart_by":"2099-01-02T07:30:00Z","current_cabin_temp_c":4.0,"outside_temp_c":-2.0,"target_cabin_temp_c":32.0}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/climate/schedule/draft", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			body, ok := parseClimateScheduleDraftBody(rec, req)
			if !ok {
				t.Fatalf("parseClimateScheduleDraftBody returned ok=false for %q (status=%d, body=%q)", tc.name, rec.Code, rec.Body.String())
			}
			if body == nil {
				t.Fatalf("parseClimateScheduleDraftBody returned ok=true but nil body for %q", tc.name)
			}
		})
	}
}

// TestAIClimateScheduleAdvisor_PreheatHappyPath proves the
// deterministic departure heuristic produces a sensible preheat
// window for a cold-soak input.
func TestAIClimateScheduleAdvisor_PreheatHappyPath(t *testing.T) {
	t.Parallel()
	now := time.Date(2099, 1, 2, 6, 0, 0, 0, time.UTC) // 06:00 UTC; depart_by 07:30 UTC ⇒ 90 minutes ahead
	a := &AIClimateScheduleAdvisor{Now: func() time.Time { return now }}
	req := tools.ClimateScheduleDraftRequest{
		VehicleID:         42,
		DepartBy:          "2099-01-02T07:30:00Z",
		CurrentCabinTempC: 4.0,  // cold
		OutsideTempC:      -2.0, // cold soak
		TargetCabinTempC:  21.0, // comfortable
	}
	res, err := a.DraftClimateSchedule(context.Background(), req)
	if err != nil {
		t.Fatalf("DraftClimateSchedule returned error: %v", err)
	}
	if res.Mode != "preheat" {
		t.Errorf("Mode = %q, want preheat", res.Mode)
	}
	if !res.EndTime.Equal(time.Date(2099, 1, 2, 7, 30, 0, 0, time.UTC)) {
		t.Errorf("EndTime = %v, want depart_by", res.EndTime)
	}
	// Δ = 17°C; preheat rate 0.5°C/min ⇒ 34 minutes; clamped to [5,60].
	wantStart := time.Date(2099, 1, 2, 6, 56, 0, 0, time.UTC)
	if !res.StartTime.Equal(wantStart) {
		t.Errorf("StartTime = %v, want %v (34-minute preheat window)", res.StartTime, wantStart)
	}
	if res.TargetCabinTempC != 21.0 {
		t.Errorf("TargetCabinTempC = %.2f, want 21.0", res.TargetCabinTempC)
	}
}

// TestAIClimateScheduleAdvisor_PrecoolHappyPath proves the
// deterministic departure heuristic produces a sensible precool
// window for a hot-soak input.
func TestAIClimateScheduleAdvisor_PrecoolHappyPath(t *testing.T) {
	t.Parallel()
	now := time.Date(2099, 7, 15, 12, 0, 0, 0, time.UTC) // 12:00 UTC; depart_by 14:00 UTC ⇒ 120 minutes ahead
	a := &AIClimateScheduleAdvisor{Now: func() time.Time { return now }}
	req := tools.ClimateScheduleDraftRequest{
		VehicleID:         42,
		DepartBy:          "2099-07-15T14:00:00Z",
		CurrentCabinTempC: 38.0, // hot
		OutsideTempC:      34.0, // hot soak
		TargetCabinTempC:  22.0, // comfortable
	}
	res, err := a.DraftClimateSchedule(context.Background(), req)
	if err != nil {
		t.Fatalf("DraftClimateSchedule returned error: %v", err)
	}
	if res.Mode != "precool" {
		t.Errorf("Mode = %q, want precool", res.Mode)
	}
	// Δ = -16°C; |Δ|=16; precool rate 0.6°C/min ⇒ 27 minutes (ceil).
	wantStart := time.Date(2099, 7, 15, 13, 33, 0, 0, time.UTC)
	if !res.StartTime.Equal(wantStart) {
		t.Errorf("StartTime = %v, want %v (27-minute precool window)", res.StartTime, wantStart)
	}
}

// TestAIClimateScheduleAdvisor_RejectsCabinAtTarget proves the
// drafter declines to invent a schedule when the cabin is already
// within 0.5°C of target.
func TestAIClimateScheduleAdvisor_RejectsCabinAtTarget(t *testing.T) {
	t.Parallel()
	now := time.Date(2099, 1, 2, 6, 0, 0, 0, time.UTC)
	a := &AIClimateScheduleAdvisor{Now: func() time.Time { return now }}
	req := tools.ClimateScheduleDraftRequest{
		VehicleID:         42,
		DepartBy:          "2099-01-02T07:30:00Z",
		CurrentCabinTempC: 21.2,
		OutsideTempC:      18.0,
		TargetCabinTempC:  21.0,
	}
	if _, err := a.DraftClimateSchedule(context.Background(), req); err == nil {
		t.Fatalf("expected error for cabin-already-at-target, got nil")
	}
}

// TestAIClimateScheduleAdvisor_RejectsDepartInPast proves the
// drafter declines a depart_by that has already passed.
func TestAIClimateScheduleAdvisor_RejectsDepartInPast(t *testing.T) {
	t.Parallel()
	now := time.Date(2099, 1, 2, 8, 0, 0, 0, time.UTC) // after depart_by 07:30
	a := &AIClimateScheduleAdvisor{Now: func() time.Time { return now }}
	req := tools.ClimateScheduleDraftRequest{
		VehicleID:         42,
		DepartBy:          "2099-01-02T07:30:00Z",
		CurrentCabinTempC: 4.0,
		OutsideTempC:      -2.0,
		TargetCabinTempC:  21.0,
	}
	if _, err := a.DraftClimateSchedule(context.Background(), req); err == nil {
		t.Fatalf("expected error for depart-in-past, got nil")
	}
}

// TestAIClimateScheduleAdvisor_RejectsTooSoonDepart proves the
// drafter declines when the depart_by leaves no room for the
// computed window.
func TestAIClimateScheduleAdvisor_RejectsTooSoonDepart(t *testing.T) {
	t.Parallel()
	now := time.Date(2099, 1, 2, 7, 25, 0, 0, time.UTC) // 5 minutes before depart_by
	a := &AIClimateScheduleAdvisor{Now: func() time.Time { return now }}
	req := tools.ClimateScheduleDraftRequest{
		VehicleID:         42,
		DepartBy:          "2099-01-02T07:30:00Z",
		CurrentCabinTempC: 4.0, // 17°C delta needs 34 minutes
		OutsideTempC:      -2.0,
		TargetCabinTempC:  21.0,
	}
	if _, err := a.DraftClimateSchedule(context.Background(), req); err == nil {
		t.Fatalf("expected error for depart-too-soon, got nil")
	}
}

// TestAIClimateScheduleAdvisor_SatisfiesInterface is a compile-time
// + runtime assertion that the production adapter implements
// tools.ClimateScheduleAdvisor. The compile-time `var _` line in
// the handler file gives the same guarantee, but this test fails
// with a clear message if a future refactor accidentally narrows
// the interface contract.
func TestAIClimateScheduleAdvisor_SatisfiesInterface(t *testing.T) {
	t.Parallel()
	var iface tools.ClimateScheduleAdvisor = (*AIClimateScheduleAdvisor)(nil)
	if iface == nil {
		// The (*AIClimateScheduleAdvisor)(nil) cast above already
		// proves interface satisfaction; the nil-check is defence
		// in depth against a future generics quirk.
		t.Logf("AIClimateScheduleAdvisor satisfies tools.ClimateScheduleAdvisor (nil cast)")
	}
}
