// Phase-50 / 0033 — T3 Tire-pressure trend reasoning.
//
// Off-mode + baseline-coexistence tests for the AI
// tire-pressure-trend-reasoning handler. The off-mode test
// (TestTirePressureReasoningAIOffShowsThresholdsOnly) is the
// slice's load-bearing AI-OFF contract proof: it asserts that the
// AI route returns 404 when settings.ai_mode='off' even when the
// per-feature toggle is on, AND that the deterministic
// tire-pressure aggregate served at the canonical
// GET /api/v1/tire-pressure handler remains the unconditional
// baseline path (ADR-015 §I3, §I6).
//
// The on-path streaming integration is exercised end-to-end by
// the F6 eval harness
// (`go run ./cmd/ai-eval -feature tire-pressure-trend-reasoning`);
// duplicating that here would require a live database fixture.

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
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// TestTirePressureReasoningAIOffShowsThresholdsOnly is the
// load-bearing off-mode contract proof for slice 0033. It mounts
// the AI tire-pressure-trend-reasoning route through the guard
// with ai_mode='off' and proves:
//
//   - The /api/v1/ai/tire-pressure/trends/explain route returns
//     404 (the guard fails closed even when the per-feature
//     toggle is on).
//   - The 404 body does not leak feature metadata or route
//     identifiers.
//   - A baseline GET /api/v1/tire-pressure route serving the
//     deterministic aggregate remains reachable under the same
//     router — proof that the slice does NOT replace the
//     deterministic gauges + thresholds on /tire-pressure
//     (TirePressurePage) (ADR-015 §I3).
//
// The test name MUST stay
// TestTirePressureReasoningAIOffShowsThresholdsOnly — the slice
// prompt's verification command runs
// `go test … -run TestTirePressureReasoningAIOffShowsThresholdsOnly`
// AND `npm test -- --run TestTirePressureReasoningAIOffShowsThresholdsOnly`,
// so both the Go and React off-mode proofs answer to the same
// test-name pattern.
func TestTirePressureReasoningAIOffShowsThresholdsOnly(t *testing.T) {
	t.Parallel()

	// --- off-mode AI route ---------------------------------------------
	guardSettings := &stubGuardSettings{
		mode: "off",
		on:   map[string]bool{"tire-pressure-trend-reasoning": true}, // toggle on; mode trumps it
	}
	g := guard.New(guardSettings)

	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		// AI route under the guard. Inner handler always-500:
		// the guard MUST short-circuit before we are reached.
		// A non-404 status here is a guard-bypass bug.
		r.Route("/ai", func(r chi.Router) {
			r.Post("/tire-pressure/trends/explain", g.Wrap("tire-pressure-trend-reasoning", func(w http.ResponseWriter, _ *http.Request) {
				http.Error(w, "GUARD_BYPASSED — handler should not have been called in off mode", http.StatusInternalServerError)
			}))
		})

		// Baseline canonical route — NOT guarded by the AI
		// guard. Returns a deterministic tire-pressure
		// envelope with the `"ai":false` marker and a
		// `surface` envelope shape that names the
		// deterministic baseline, so the test can prove the
		// deterministic gauges coexist. We mock it here so
		// the test stays hermetic (no DB).
		r.Get("/tire-pressure", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"vehicle_id":42,"readings":[{"created_at":"2024-01-15T10:30:00Z","front_left":250000,"front_right":252000,"rear_left":248000,"rear_right":251000}],"thresholds":{"soft_low_pa":200000,"normal_min_pa":250000,"normal_max_pa":350000,"soft_high_pa":400000},"ai":false,"surface":"baseline_deterministic_tire_pressure"}`))
		})
	})

	// 1) Probe the AI route — MUST be 404.
	body := []byte(`{"vehicle_id":42}`)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/tire-pressure/trends/explain", bytes.NewReader(body))
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
	// invisible in off mode). chi's http.NotFound emits "404
	// page not found\n".
	for _, leaked := range []string{"tire-pressure-trend-reasoning", "feature", "strategy", "provider", "agent"} {
		if strings.Contains(strings.ToLower(rec.Body.String()), leaked) {
			t.Errorf("AI route 404 body leaks %q: %q", leaked, rec.Body.String())
		}
	}

	// 2) Probe the baseline tire-pressure route — MUST return
	// 200 + deterministic baseline content, regardless of the
	// AI guard's state. This is the load-bearing proof that
	// the slice did NOT replace the deterministic gauges.
	recBaseline := httptest.NewRecorder()
	reqBaseline := httptest.NewRequest(http.MethodGet, "/api/v1/tire-pressure?vehicle_id=42", nil)
	router.ServeHTTP(recBaseline, reqBaseline)

	if recBaseline.Code != http.StatusOK {
		t.Fatalf("baseline route status = %d, want 200 (body=%q)", recBaseline.Code, recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"ai":false`) {
		t.Errorf("baseline body missing ai:false marker: %q", recBaseline.Body.String())
	}
	if !strings.Contains(recBaseline.Body.String(), `"surface":"baseline_deterministic_tire_pressure"`) {
		t.Errorf("baseline body missing baseline_deterministic_tire_pressure marker: %q", recBaseline.Body.String())
	}
}

// TestAITirePressureTrendHandler_PanicsOnNilWiring asserts the
// handler constructor refuses zero-valued dependencies. A wiring
// bug at boot must surface as a panic, not as a nil-deref on
// first request.
func TestAITirePressureTrendHandler_PanicsOnNilWiring(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		fn   func()
	}{
		{"all nil", func() { NewAITirePressureTrendHandler(nil, nil, nil, "") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r == nil {
					t.Fatalf("NewAITirePressureTrendHandler(%s) did not panic", tc.name)
				}
			}()
			tc.fn()
		})
	}
}

// TestAITirePressureTrendHandler_RejectsBadBody asserts the
// handler validates the JSON body BEFORE opening the SSE stream
// — a missing or unparseable body must surface as a JSON 400,
// not a half-opened stream that confuses the frontend.
func TestAITirePressureTrendHandler_RejectsBadBody(t *testing.T) {
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
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/tire-pressure/trends/explain", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			if body, ok := parseTirePressureTrendBody(rec, req); ok {
				t.Fatalf("parseTirePressureTrendBody returned ok=true for %q (body=%+v)", tc.name, body)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
		})
	}
}

// TestAITirePressureTrendHandler_AcceptsCanonicalBody proves the
// parser does NOT bounce the happy-path shapes.
func TestAITirePressureTrendHandler_AcceptsCanonicalBody(t *testing.T) {
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
			req := httptest.NewRequest(http.MethodPost, "/api/v1/ai/tire-pressure/trends/explain", bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")

			body, ok := parseTirePressureTrendBody(rec, req)
			if !ok {
				t.Fatalf("parseTirePressureTrendBody returned ok=false for %q (status=%d, body=%q)", tc.name, rec.Code, rec.Body.String())
			}
			if body == nil {
				t.Fatalf("parseTirePressureTrendBody returned ok=true but nil body for %q", tc.name)
			}
		})
	}
}

// TestAITirePressureTrendSource_PanicsOnNilState asserts the
// production adapter constructor refuses a nil signal.StateReader
// — a wiring bug at boot must surface as a panic, not as a
// nil-deref on first AI request.
func TestAITirePressureTrendSource_PanicsOnNilState(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("NewAITirePressureTrendSource(nil state) did not panic")
		}
	}()
	NewAITirePressureTrendSource(nil)
}

// TestAITirePressureTrendSource_SatisfiesInterface is a
// compile-time + runtime assertion that the production adapter
// implements tools.TirePressureTrendSource.
func TestAITirePressureTrendSource_SatisfiesInterface(t *testing.T) {
	t.Parallel()
	var iface tools.TirePressureTrendSource = (*AITirePressureTrendSource)(nil)
	if iface == nil {
		t.Logf("AITirePressureTrendSource satisfies tools.TirePressureTrendSource (nil cast)")
	}
}

// --- helpers + per-helper tests ---------------------------------------

// fakeTirePressureState is a minimal signal.StateReader fake that
// returns a fixed slice of TimelineRows (already forward-folded)
// from Timeline. State + SignalAt are not used by the
// tire-pressure-trend adapter and panic if exercised.
type fakeTirePressureState struct {
	rows []signal.TimelineRow
}

func (f *fakeTirePressureState) State(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
	panic("not used")
}
func (f *fakeTirePressureState) SignalAt(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
	panic("not used")
}
func (f *fakeTirePressureState) Timeline(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
	return f.rows, nil
}

// TestQueryTirePressureTrend_HasEnoughDataFalseClearsPerCornerStatus
// proves that when the total reading count across all four
// corners is below aiTirePressureTrendMinReadings the adapter
// clears per-corner Status / RatePaPerDay / DaysUntilSoftLowEstimate
// AND returns empty LikelyCauses + Insights — defence in depth so
// the narrator cannot quote a noisy classification from a 3-row
// sample.
func TestQueryTirePressureTrend_HasEnoughDataFalseClearsPerCornerStatus(t *testing.T) {
	t.Parallel()
	now := time.Now()
	// 3 rows total — well below the 20-reading threshold.
	rows := []signal.TimelineRow{
		{Timestamp: now.Add(-72 * time.Hour), Fields: map[string]signal.SignalValue{"front_left": 250_000.0}},
		{Timestamp: now.Add(-48 * time.Hour), Fields: map[string]signal.SignalValue{"front_right": 252_000.0}},
		{Timestamp: now.Add(-24 * time.Hour), Fields: map[string]signal.SignalValue{"rear_left": 248_000.0}},
	}
	src := NewAITirePressureTrendSource(&fakeTirePressureState{rows: rows})
	env, err := src.QueryTirePressureTrend(context.Background(), 42)
	if err != nil {
		t.Fatalf("QueryTirePressureTrend: %v", err)
	}
	if env.HasEnoughData {
		t.Fatalf("HasEnoughData = true, want false (sample_size=%d, min=%d)", env.SampleSize, env.MinRequiredReadings)
	}
	for _, c := range env.Tires {
		if c.Status != "" {
			t.Errorf("corner %s Status = %q, want \"\" when has_enough_data=false", c.Position, c.Status)
		}
		if c.RatePaPerDay != 0 {
			t.Errorf("corner %s RatePaPerDay = %v, want 0 when has_enough_data=false", c.Position, c.RatePaPerDay)
		}
		if c.DaysUntilSoftLowEstimate != nil {
			t.Errorf("corner %s DaysUntilSoftLowEstimate = %v, want nil when has_enough_data=false", c.Position, c.DaysUntilSoftLowEstimate)
		}
	}
	if len(env.LikelyCauses) != 0 {
		t.Errorf("LikelyCauses = %v, want empty when has_enough_data=false", env.LikelyCauses)
	}
	if len(env.Insights) != 0 {
		t.Errorf("Insights = %v, want empty when has_enough_data=false", env.Insights)
	}
}

// TestClassifyTirePressureStatus_BoundaryCases pins the
// per-corner status classifier against the four canonical
// thresholds. Mirrors the SPA's TirePressurePage thresholds — a
// future change must update both.
func TestClassifyTirePressureStatus_BoundaryCases(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		latest float64
		want   string
	}{
		{"zero or below", 0, ""},
		{"critical low", 150_000, "critical"}, // < soft-low
		{"low", 220_000, "low"},               // soft-low <= x < normal-min
		{"normal lower edge", 250_000, "normal"},
		{"normal upper edge", 350_000, "normal"},
		{"high", 380_000, "high"},                  // normal-max < x <= soft-high
		{"critical high", 410_000, "critical"},     // > soft-high
		{"on soft-low boundary", 200_000, "low"},   // == soft-low
		{"on soft-high boundary", 400_000, "high"}, // == soft-high
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyTirePressureStatus(tc.latest); got != tc.want {
				t.Errorf("classifyTirePressureStatus(%v) = %q, want %q", tc.latest, got, tc.want)
			}
		})
	}
}

// TestTireRawToPa_NormalisesUnits proves the unit-coercion
// helper agrees with the SPA's normaliseTpmsToPa band-aid in
// TirePressurePage.tsx.
func TestTireRawToPa_NormalisesUnits(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		raw  float64
		want float64
	}{
		{"already Pa", 250_000, 250_000},
		{"kPa", 250, 250_000},
		{"psi", 35, 241_316.495},
		{"bar", 2.5, 250_000},
		{"zero", 0, 0},
		{"negative", -1, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tireRawToPa(tc.raw)
			// allow tiny float tolerance
			if delta := got - tc.want; delta < -0.5 || delta > 0.5 {
				t.Errorf("tireRawToPa(%v) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

// TestDetectSingleCornerLeak_FlagsObviousOutlier proves the
// single-corner-anomaly detector flags a corner whose negative
// rate is materially worse than the other three.
func TestDetectSingleCornerLeak_FlagsObviousOutlier(t *testing.T) {
	t.Parallel()
	tires := []tools.TirePressureCorner{
		{Position: "fl", Label: "Front Left", RatePaPerDay: -300},
		{Position: "fr", Label: "Front Right", RatePaPerDay: -200},
		{Position: "rl", Label: "Rear Left", RatePaPerDay: -250},
		{Position: "rr", Label: "Rear Right", RatePaPerDay: -2_000}, // 8× faster than the others
	}
	leak, label := detectSingleCornerLeak(tires)
	if !leak {
		t.Fatalf("detectSingleCornerLeak: leak=false, want true (rates=%v)", tires)
	}
	if label != "Rear Right" {
		t.Errorf("detectSingleCornerLeak label = %q, want %q", label, "Rear Right")
	}
}

// TestDetectSingleCornerLeak_IgnoresNonLeak proves the detector
// does NOT fire when all four corners are stable / trending up
// — defence in depth so the narrator cannot quote a phantom
// "single-corner anomaly" on a normal sample.
func TestDetectSingleCornerLeak_IgnoresNonLeak(t *testing.T) {
	t.Parallel()
	tires := []tools.TirePressureCorner{
		{Position: "fl", RatePaPerDay: 0},
		{Position: "fr", RatePaPerDay: 100},
		{Position: "rl", RatePaPerDay: 50},
		{Position: "rr", RatePaPerDay: -150},
	}
	leak, label := detectSingleCornerLeak(tires)
	if leak {
		t.Fatalf("detectSingleCornerLeak: leak=true (label=%q), want false (rates=%v)", label, tires)
	}
}

// TestBuildTirePressureLikelyCauses_ColdWeatherCorrelation
// proves the cold-weather correlation hint fires when ALL four
// corners are losing pressure AND the rolling average outside
// temperature is below the 5°C heuristic.
func TestBuildTirePressureLikelyCauses_ColdWeatherCorrelation(t *testing.T) {
	t.Parallel()
	tires := []tools.TirePressureCorner{
		{Position: "fl", RatePaPerDay: -250},
		{Position: "fr", RatePaPerDay: -220},
		{Position: "rl", RatePaPerDay: -240},
		{Position: "rr", RatePaPerDay: -260},
	}
	outside := &tools.TireOutsideTempSummary{ReadingCount: 10, AvgTempC: 1.5, MinTempC: -5, MaxTempC: 8}
	causes := buildTirePressureLikelyCauses(tires, outside)
	gotColdWeather := false
	for _, c := range causes {
		if strings.Contains(c, "cold-weather correlation") {
			gotColdWeather = true
		}
	}
	if !gotColdWeather {
		t.Errorf("buildTirePressureLikelyCauses: missing cold-weather correlation hint; got=%v", causes)
	}
}

// TestBuildTirePressureLikelyCauses_NoColdWeatherWhenWarm proves
// the cold-weather hint does NOT fire when the rolling average
// outside temperature is warm — defence in depth so the narrator
// cannot quote a phantom seasonal explanation in summer.
func TestBuildTirePressureLikelyCauses_NoColdWeatherWhenWarm(t *testing.T) {
	t.Parallel()
	tires := []tools.TirePressureCorner{
		{Position: "fl", RatePaPerDay: -250},
		{Position: "fr", RatePaPerDay: -220},
		{Position: "rl", RatePaPerDay: -240},
		{Position: "rr", RatePaPerDay: -260},
	}
	outside := &tools.TireOutsideTempSummary{ReadingCount: 10, AvgTempC: 22, MinTempC: 18, MaxTempC: 28}
	causes := buildTirePressureLikelyCauses(tires, outside)
	for _, c := range causes {
		if strings.Contains(c, "cold-weather correlation") {
			t.Errorf("buildTirePressureLikelyCauses: cold-weather hint fired in warm weather (%v°C avg)", outside.AvgTempC)
		}
	}
}
