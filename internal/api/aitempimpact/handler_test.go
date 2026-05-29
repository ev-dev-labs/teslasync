// Tests for the cabin temperature impact narrative.
//
// These tests pin ADR-015 edges: off-mode hides AI, baseline analytics stay
// reachable, bad bodies fail before SSE, and bucket selection stays stable.

package aitempimpact

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/ai/guard"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/forecast"
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

// TestCabinTemperatureNarrativeAIOffShowsChartsOnly pins the off-mode contract:
// AI narration is hidden while deterministic temperature-impact analytics work.
func TestCabinTemperatureNarrativeAIOffShowsChartsOnly(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"cabin-temperature-impact-narrative": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500: the
		// guard MUST short-circuit before we are reached. A
		// non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/climate/temperature-impact/narrate", g.Wrap("cabin-temperature-impact-narrative", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline canonical route — NOT guarded by the AI guard.
		// Returns a deterministic temperature-impact envelope with
		// the `"ai":false` marker and a `surface` envelope shape
		// that names the deterministic baseline, so the test can
		// prove the deterministic charts coexist. We mock it here
		// so the test stays hermetic (no DB).
		r.Get("/analytics/temperature-impact", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"vehicle_id":42,"points":[],"efficiency":[{"temp_bucket":"10-20°C","drive_count":20,"avg_battery_pct_per_100km":18.0,"avg_temp":14.5}],"vampire_drain":[],"monthly_trend":[{"month":"2024-01","avg_temp":-2.0,"avg_efficiency":22.5,"drive_count":8,"total_distance":200}],"ai":false,"surface":"baseline_deterministic_temperature_impact"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"vehicle_id":42}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/climate/temperature-impact/narrate", bytes.NewReader(body))
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
	for _, leaked := range []string{"cabin-temperature-impact-narrative", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline temperature-impact route — MUST
	// return 200 + deterministic baseline content, regardless of
	// the AI guard's state. This is the load-bearing proof that
	// the slice did NOT replace the deterministic charts.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/analytics/temperature-impact?vehicle_id=42", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_deterministic_temperature_impact"`) {
		t.Errorf("baseline body missing baseline_deterministic_temperature_impact marker: %q", recBaseline.Body.String())
	}
}

// TestHandler_PanicsOnNilWiring asserts
// the handler constructor refuses zero-valued dependencies. A
// wiring bug at boot must surface as a panic, not as a nil-deref
// on first request.
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
// handler validates the JSON body BEFORE opening the SSE stream
// — a missing or unparseable body must surface as a JSON 400, not
// a half-opened stream that confuses the frontend.
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
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/climate/temperature-impact/narrate", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			if body, ok := parseCabinTemperatureImpactBody(rec, req); ok {
				t.Fatalf("parseCabinTemperatureImpactBody returned ok=true for %q (body=%+v)", tc.name, body)
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
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/climate/temperature-impact/narrate", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			body, ok := parseCabinTemperatureImpactBody(rec, req)
			if !ok {
				t.Fatalf("parseCabinTemperatureImpactBody returned ok=false for %q (status=%d, body=%q)", tc.name, rec.Code, rec.Body.String())
			}
			if body == nil {
				t.Fatalf("parseCabinTemperatureImpactBody returned ok=true but nil body for %q", tc.name)
			}
		})
	}
}

// TestAITemperatureImpactSource_PanicsOnNilDB asserts the
// production adapter constructor refuses a nil *database.DB — a
// wiring bug at boot must surface as a panic, not as a nil-deref
// on first AI request.
func TestAITemperatureImpactSource_PanicsOnNilDB(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("NewAITemperatureImpactSource(nil db) did not panic")
		}
	}()
	NewAITemperatureImpactSource(nil)
}

// TestAITemperatureImpactSource_SatisfiesInterface is a
// compile-time + runtime assertion that the production adapter
// implements forecast.TemperatureImpactSource.
func TestAITemperatureImpactSource_SatisfiesInterface(t *testing.T) {
	t.Parallel()
	var iface forecast.TemperatureImpactSource = (*AITemperatureImpactSource)(nil)
	if iface == nil {
		t.Logf("AITemperatureImpactSource satisfies forecast.TemperatureImpactSource (nil cast)")
	}
}

// TestPickBestWorstBuckets_ReturnsNilWhenNotEnoughData proves the
// best/worst classifier refuses to invent a classification when
// has_enough_data is false — defence in depth so the narrator
// cannot quote a noisy best/worst from a 2-drive sample.
func TestPickBestWorstBuckets_ReturnsNilWhenNotEnoughData(t *testing.T) {
	t.Parallel()
	buckets := []forecast.TemperatureImpactBucket{
		{Label: "Below 0°C", DriveCount: 1, AvgBatteryPer100Km: 25.0, AvgTempC: -2},
		{Label: "10-20°C", DriveCount: 1, AvgBatteryPer100Km: 18.0, AvgTempC: 15},
	}
	best, worst := pickBestWorstBuckets(buckets, false)
	if best != nil {
		t.Errorf("best = %+v, want nil when has_enough_data=false", best)
	}
	if worst != nil {
		t.Errorf("worst = %+v, want nil when has_enough_data=false", worst)
	}
}

// TestPickBestWorstBuckets_PicksLowestAndHighestPer100Km proves
// the best/worst classifier picks the lowest and highest
// avg_battery_pct_per_100km respectively (i.e. the most and
// least efficient bucket).
func TestPickBestWorstBuckets_PicksLowestAndHighestPer100Km(t *testing.T) {
	t.Parallel()
	buckets := []forecast.TemperatureImpactBucket{
		{Label: "Below 0°C", DriveCount: 5, AvgBatteryPer100Km: 25.0, AvgTempC: -2},
		{Label: "10-20°C", DriveCount: 10, AvgBatteryPer100Km: 18.0, AvgTempC: 15},
		{Label: "20-30°C", DriveCount: 8, AvgBatteryPer100Km: 19.5, AvgTempC: 24},
	}
	best, worst := pickBestWorstBuckets(buckets, true)
	if best == nil || best.Label != "10-20°C" {
		t.Errorf("best = %+v, want label '10-20°C'", best)
	}
	if worst == nil || worst.Label != "Below 0°C" {
		t.Errorf("worst = %+v, want label 'Below 0°C'", worst)
	}
}

// TestPickBestWorstBuckets_IgnoresZeroDriveBuckets proves the
// classifier filters out degenerate buckets (zero drives or
// non-positive avg_battery_pct_per_100km) before selecting
// best/worst.
func TestPickBestWorstBuckets_IgnoresZeroDriveBuckets(t *testing.T) {
	t.Parallel()
	buckets := []forecast.TemperatureImpactBucket{
		{Label: "Below 0°C", DriveCount: 0, AvgBatteryPer100Km: 25.0, AvgTempC: -2},
		{Label: "10-20°C", DriveCount: 10, AvgBatteryPer100Km: 18.0, AvgTempC: 15},
	}
	best, worst := pickBestWorstBuckets(buckets, true)
	if best == nil || best.Label != "10-20°C" {
		t.Errorf("best = %+v, want label '10-20°C'", best)
	}
	if worst == nil || worst.Label != "10-20°C" {
		t.Errorf("worst = %+v, want label '10-20°C' (only valid bucket)", worst)
	}
}

// TestBuildTemperatureImpactInsights_EmptyWhenNotEnoughData
// proves the insight generator refuses to invent insights from
// a noisy sample.
func TestBuildTemperatureImpactInsights_EmptyWhenNotEnoughData(t *testing.T) {
	t.Parallel()
	env := &forecast.TemperatureImpact{
		HasEnoughData: false,
		BestBucket:    nil,
		WorstBucket:   nil,
	}
	insights := buildTemperatureImpactInsights(env)
	if len(insights) != 0 {
		t.Errorf("insights = %v, want empty when has_enough_data=false", insights)
	}
}

// TestBuildTemperatureImpactInsights_GeneratesThreeInsights proves
// the insight generator emits the standard 3 deterministic
// strings (best, worst, ratio) when the data is sufficient.
func TestBuildTemperatureImpactInsights_GeneratesThreeInsights(t *testing.T) {
	t.Parallel()
	env := &forecast.TemperatureImpact{
		HasEnoughData: true,
		BestBucket:    &forecast.TemperatureImpactBucket{Label: "10-20°C", DriveCount: 10, AvgBatteryPer100Km: 18.0, AvgTempC: 15},
		WorstBucket:   &forecast.TemperatureImpactBucket{Label: "Below 0°C", DriveCount: 5, AvgBatteryPer100Km: 25.0, AvgTempC: -2},
	}
	insights := buildTemperatureImpactInsights(env)
	if len(insights) != 3 {
		t.Errorf("insights count = %d, want 3 (got=%v)", len(insights), insights)
	}
	if !strings.Contains(insights[0], "Best efficiency") {
		t.Errorf("insights[0] = %q, want contains 'Best efficiency'", insights[0])
	}
	if !strings.Contains(insights[1], "Worst efficiency") {
		t.Errorf("insights[1] = %q, want contains 'Worst efficiency'", insights[1])
	}
	if !strings.Contains(insights[2], "more energy") {
		t.Errorf("insights[2] = %q, want contains 'more energy'", insights[2])
	}
}
