package chargeopt

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// fakeOptimizerRepo satisfies optimizerRepo so the handler can be driven
// without a database. It records the vehicle ids it was asked about so
// tests can assert the handler never reaches the data layer for invalid
// input.
type fakeOptimizerRepo struct {
	sessions    []sessionRow
	sessionsErr error

	locs    map[int64]sessionLocation
	locsErr error

	gotSessionsVIDs []int64
	gotLocsVIDs     []int64
}

func (f *fakeOptimizerRepo) Sessions(_ context.Context, vehicleID int64) ([]sessionRow, error) {
	f.gotSessionsVIDs = append(f.gotSessionsVIDs, vehicleID)
	if f.sessionsErr != nil {
		return nil, f.sessionsErr
	}
	return f.sessions, nil
}

func (f *fakeOptimizerRepo) LocationEnrichment(_ context.Context, vehicleID int64) (map[int64]sessionLocation, error) {
	f.gotLocsVIDs = append(f.gotLocsVIDs, vehicleID)
	if f.locsErr != nil {
		return nil, f.locsErr
	}
	return f.locs, nil
}

// Compile-time assertion the fake matches the port.
var _ optimizerRepo = (*fakeOptimizerRepo)(nil)

func newHandlerForTest(repo optimizerRepo) *ChargingOptimizerHandler {
	return &ChargingOptimizerHandler{repo: repo}
}

func optReq(query string) *http.Request {
	return httptest.NewRequest(http.MethodGet, "/analytics/charging-optimizer?"+query, nil)
}

func fptr(v float64) *float64 { return &v }

// NewChargingOptimizerHandler must fail fast when wired with a nil pool —
// a nil pool is a deployment/wiring bug, not a runtime condition, so it
// should surface at construction rather than as a nil-deref on the first
// request.
func TestNewChargingOptimizerHandler_NilPoolPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic constructing handler with a nil pool")
		}
	}()
	_ = NewChargingOptimizerHandler(&database.DB{})
}

// ---------- vehicle_id validation ----------

func TestGetOptimization_BadVehicleID(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		query string
	}{
		{"missing", ""},
		{"empty", "vehicle_id="},
		{"non_numeric", "vehicle_id=abc"},
		{"zero", "vehicle_id=0"},
		{"negative", "vehicle_id=-5"},
		{"float", "vehicle_id=1.5"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeOptimizerRepo{}
			h := newHandlerForTest(repo)
			rec := httptest.NewRecorder()
			h.GetOptimization(rec, optReq(c.query))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if len(repo.gotSessionsVIDs) != 0 {
				t.Errorf("Sessions called for invalid vehicle_id %q — must validate first", c.query)
			}
			// Error envelope carries the machine code.
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode error body: %v", err)
			}
			if body["code"] != "BAD_REQUEST" {
				t.Errorf("code = %q, want BAD_REQUEST", body["code"])
			}
		})
	}
}

// ---------- repo error -> 500 ----------

func TestGetOptimization_SessionsError_500(t *testing.T) {
	t.Parallel()
	repo := &fakeOptimizerRepo{sessionsErr: errors.New("pgx connection lost")}
	h := newHandlerForTest(repo)
	rec := httptest.NewRecorder()
	h.GetOptimization(rec, optReq("vehicle_id=42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.gotLocsVIDs) != 0 {
		t.Errorf("LocationEnrichment must not run after a Sessions error")
	}
}

// ---------- empty sessions -> 200 with empty shape ----------

func TestGetOptimization_EmptySessions_200(t *testing.T) {
	t.Parallel()
	repo := &fakeOptimizerRepo{sessions: nil}
	h := newHandlerForTest(repo)
	rec := httptest.NewRecorder()
	h.GetOptimization(rec, optReq("vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	// Empty vehicle must short-circuit before enrichment.
	if len(repo.gotLocsVIDs) != 0 {
		t.Errorf("LocationEnrichment ran for an empty-session vehicle")
	}
	// Arrays must serialise as [] not null so the frontend safeArray works.
	body := rec.Body.String()
	for _, frag := range []string{`"peak_hours":[]`, `"offpeak_hours":[]`, `"recommendations":[]`, `"weekly_heatmap":[]`} {
		if !strings.Contains(body, frag) {
			t.Errorf("empty response missing %q\nbody=%s", frag, body)
		}
	}
}

// ---------- happy path ----------

func TestGetOptimization_HappyPath(t *testing.T) {
	t.Parallel()
	// Two sessions: one home-style, one DC-fast, spread across hours.
	repo := &fakeOptimizerRepo{
		sessions: []sessionRow{
			{id: 1, startDate: at(2026, time.June, 7, 23), cost: 5, kwh: 10, power: 11, endBattery: 80, startBattery: 20},
			{id: 2, startDate: at(2026, time.June, 3, 8), cost: 8, kwh: 12, power: 150, endBattery: 95, startBattery: 30},
		},
		locs: map[int64]sessionLocation{},
	}
	h := newHandlerForTest(repo)
	rec := httptest.NewRecorder()
	h.GetOptimization(rec, optReq("vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q, want application/json; charset=utf-8", got)
	}

	// Repo consulted with the parsed vehicle id, enrichment included.
	if len(repo.gotSessionsVIDs) != 1 || repo.gotSessionsVIDs[0] != 42 {
		t.Errorf("Sessions vehicle ids = %v, want [42]", repo.gotSessionsVIDs)
	}
	if len(repo.gotLocsVIDs) != 1 || repo.gotLocsVIDs[0] != 42 {
		t.Errorf("LocationEnrichment vehicle ids = %v, want [42]", repo.gotLocsVIDs)
	}

	var resp optimizerResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if resp.BatteryHealthScore < 0 || resp.BatteryHealthScore > 100 {
		t.Errorf("battery_health_score = %d, out of [0,100]", resp.BatteryHealthScore)
	}
	if len(resp.Recommendations) == 0 {
		t.Error("recommendations must never be empty (falls back to the general rec)")
	}
	if resp.CostAnalysis.PeakHours == nil || resp.CostAnalysis.OffpeakHours == nil {
		t.Error("cost analysis peak/offpeak hours must be non-nil")
	}

	// Snake-case wire keys.
	var raw map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode raw: %v", err)
	}
	for _, k := range []string{"current_schedule", "cost_analysis", "battery_health_score", "recommendations", "weekly_heatmap"} {
		if _, ok := raw[k]; !ok {
			t.Errorf("missing top-level key %q in body=%s", k, rec.Body.String())
		}
	}
}

// ---------- enrichment is best-effort ----------

func TestGetOptimization_EnrichmentError_StillOK(t *testing.T) {
	t.Parallel()
	repo := &fakeOptimizerRepo{
		sessions: []sessionRow{
			{id: 1, startDate: at(2026, time.June, 7, 23), cost: 5, kwh: 10, power: 11, endBattery: 80},
		},
		locsErr: errors.New("signal_log timeout"),
	}
	h := newHandlerForTest(repo)
	rec := httptest.NewRecorder()
	h.GetOptimization(rec, optReq("vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 despite enrichment failure (body=%s)", rec.Code, rec.Body.String())
	}
	var resp optimizerResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// No coordinates available => home detection reports 0%.
	if resp.CurrentSchedule.HomeChargingPct != 0 {
		t.Errorf("home_charging_pct = %v, want 0 when enrichment failed", resp.CurrentSchedule.HomeChargingPct)
	}
}

func TestGetOptimization_EnrichmentAppliesHomeDetection(t *testing.T) {
	t.Parallel()
	// Both sessions resolve to the same location => 100% home charging.
	repo := &fakeOptimizerRepo{
		sessions: []sessionRow{
			{id: 1, startDate: at(2026, time.June, 7, 23), cost: 5, kwh: 10, power: 11, endBattery: 80},
			{id: 2, startDate: at(2026, time.June, 6, 22), cost: 4, kwh: 9, power: 11, endBattery: 70},
		},
		locs: map[int64]sessionLocation{
			1: {lat: fptr(37.7749), lon: fptr(-122.4194), temp: fptr(18)},
			2: {lat: fptr(37.7750), lon: fptr(-122.4193), temp: fptr(17)},
		},
	}
	h := newHandlerForTest(repo)
	rec := httptest.NewRecorder()
	h.GetOptimization(rec, optReq("vehicle_id=7"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var resp optimizerResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !approx(resp.CurrentSchedule.HomeChargingPct, 100, eps) {
		t.Errorf("home_charging_pct = %v, want 100 (both sessions clustered)", resp.CurrentSchedule.HomeChargingPct)
	}
}

// ---------- missing lat/lon but present temp still enriches temp ----------

func TestGetOptimization_EnrichmentPartial_TempOnly(t *testing.T) {
	t.Parallel()
	// lat/lon nil (no home detection) but temp present — the handler must
	// still apply the temperature so battery-health extreme-temp logic sees it.
	repo := &fakeOptimizerRepo{
		sessions: []sessionRow{
			{id: 1, startDate: at(2026, time.June, 7, 23), cost: 5, kwh: 10, power: 11, endBattery: 80},
		},
		locs: map[int64]sessionLocation{
			1: {lat: nil, lon: nil, temp: fptr(45)},
		},
	}
	h := newHandlerForTest(repo)
	rec := httptest.NewRecorder()
	h.GetOptimization(rec, optReq("vehicle_id=7"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var resp optimizerResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// No coords => 0% home.
	if resp.CurrentSchedule.HomeChargingPct != 0 {
		t.Errorf("home_charging_pct = %v, want 0 (lat/lon nil)", resp.CurrentSchedule.HomeChargingPct)
	}
	// 45°C is extreme (>40) for 100% of sessions => health score penalised
	// (100 - 15 extreme + 5 home-style bonus = 90), proving temp was applied.
	if resp.BatteryHealthScore != 90 {
		t.Errorf("battery_health_score = %d, want 90 (extreme temp applied from enrichment)", resp.BatteryHealthScore)
	}
}
