package drivingcoach

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
)

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

// fakeCoachRepo is the in-memory driveCoachingRepository used by the handler
// tests. It records the arguments of the single CoachingDrives call the
// handler makes so tests can pin the vehicle_id / days-window contract, and it
// can be primed with either a drive slice or an error.
type fakeCoachRepo struct {
	drives []driveAnalysis
	err    error

	calls        int
	gotVehicleID int64
	gotSince     time.Time
}

func (f *fakeCoachRepo) CoachingDrives(_ context.Context, vehicleID int64, since time.Time) ([]driveAnalysis, error) {
	f.calls++
	f.gotVehicleID = vehicleID
	f.gotSince = since
	if f.err != nil {
		return nil, f.err
	}
	return f.drives, nil
}

var _ driveCoachingRepository = (*fakeCoachRepo)(nil)

func newHandlerForTest(repo driveCoachingRepository) *DrivingCoachHandler {
	return &DrivingCoachHandler{repo: repo}
}

func coachRequest(query string) *http.Request {
	target := "/analytics/driving-coach"
	if query != "" {
		target += "?" + query
	}
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// mkDrive builds a driveAnalysis fixture with hasPowerRange=false (the shape
// the production SQL currently emits — powerMin is always NULL).
func mkDrive(id int64, date time.Time, distance, speedMax, speedAvg, powerMax, socStart, socEnd, temp float64) driveAnalysis {
	return driveAnalysis{
		id:          id,
		date:        date,
		distance:    distance,
		speedMax:    speedMax,
		speedAvg:    speedAvg,
		powerMax:    powerMax,
		socStart:    socStart,
		socEnd:      socEnd,
		outsideTemp: temp,
	}
}

func decodeCoach(t *testing.T, rec *httptest.ResponseRecorder) coachResponse {
	t.Helper()
	var got coachResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v\nbody=%s", err, rec.Body.String())
	}
	return got
}

// ---------------------------------------------------------------------------
// classifyDrivingStyle — pure function, all branches + boundaries
// ---------------------------------------------------------------------------

func TestClassifyDrivingStyle(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name          string
		powerMax      float64
		powerMin      float64
		speedMax      float64
		speedAvg      float64
		hasPowerRange bool
		want          string
	}{
		{"aggressive_by_power", 151, 0, 50, 40, false, "aggressive"},
		{"aggressive_by_speed", 50, 0, 131, 40, false, "aggressive"},
		{"power_boundary_150_not_aggressive", 150, 0, 130, 40, false, "moderate"},
		{"speed_boundary_130_not_aggressive", 50, 0, 130, 100, false, "moderate"},
		{"efficient_no_range", 50, 0, 60, 40, false, "efficient"},
		{"efficient_spread_boundary_30_moderate", 50, 0, 70, 40, false, "moderate"},
		{"efficient_power_boundary_80_moderate", 80, 0, 60, 40, false, "moderate"},
		{"moderate_no_range", 100, 0, 60, 40, false, "moderate"},
		{"efficient_with_range_and_regen", 50, -20, 60, 40, true, "efficient"},
		{"range_regen_boundary_0_3_moderate", 50, -15, 60, 40, true, "moderate"},
		{"range_zero_power_no_regen_ratio", 0, -10, 20, 10, true, "moderate"},
		{"range_low_regen_moderate", 50, -5, 60, 40, true, "moderate"},
		{"range_high_power_moderate", 80, -40, 60, 40, true, "moderate"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := classifyDrivingStyle(tc.powerMax, tc.powerMin, tc.speedMax, tc.speedAvg, tc.hasPowerRange)
			if got != tc.want {
				t.Errorf("classifyDrivingStyle(%v,%v,%v,%v,%v) = %q, want %q",
					tc.powerMax, tc.powerMin, tc.speedMax, tc.speedAvg, tc.hasPowerRange, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// buildDrivingRecommendations — pure function, all branches + boundaries
// ---------------------------------------------------------------------------

type catImpact struct{ category, impact string }

func TestBuildDrivingRecommendations(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		p      coachPatterns
		avgEff float64
		want   []catImpact
	}{
		{
			name: "all_clean_yields_general",
			want: []catImpact{{"general", "low"}},
		},
		{
			name: "hard_accel_high",
			p:    coachPatterns{HardAccelPct: 41},
			want: []catImpact{{"acceleration", "high"}},
		},
		{
			name: "hard_accel_boundary_40_is_medium",
			p:    coachPatterns{HardAccelPct: 40},
			want: []catImpact{{"acceleration", "medium"}},
		},
		{
			name: "hard_accel_medium",
			p:    coachPatterns{HardAccelPct: 21},
			want: []catImpact{{"acceleration", "medium"}},
		},
		{
			name: "hard_accel_boundary_20_none",
			p:    coachPatterns{HardAccelPct: 20},
			want: []catImpact{{"general", "low"}},
		},
		{
			name: "highway_high",
			p:    coachPatterns{HighwayPct: 71},
			want: []catImpact{{"speed", "high"}},
		},
		{
			name: "highway_boundary_70_none",
			p:    coachPatterns{HighwayPct: 70},
			want: []catImpact{{"general", "low"}},
		},
		{
			name: "short_trip_medium",
			p:    coachPatterns{ShortTripPct: 51},
			want: []catImpact{{"trips", "medium"}},
		},
		{
			name: "short_trip_boundary_50_is_low",
			p:    coachPatterns{ShortTripPct: 50},
			want: []catImpact{{"trips", "low"}},
		},
		{
			name: "short_trip_low",
			p:    coachPatterns{ShortTripPct: 31},
			want: []catImpact{{"trips", "low"}},
		},
		{
			name: "short_trip_boundary_30_none",
			p:    coachPatterns{ShortTripPct: 30},
			want: []catImpact{{"general", "low"}},
		},
		{
			name: "cold_start_medium",
			p:    coachPatterns{ColdStartPct: 31},
			want: []catImpact{{"climate", "medium"}},
		},
		{
			name: "cold_start_boundary_30_none",
			p:    coachPatterns{ColdStartPct: 30},
			want: []catImpact{{"general", "low"}},
		},
		{
			name:   "efficiency_medium",
			avgEff: 181,
			want:   []catImpact{{"efficiency", "medium"}},
		},
		{
			name:   "efficiency_boundary_180_none",
			avgEff: 180,
			want:   []catImpact{{"general", "low"}},
		},
		{
			name: "hard_brake_medium",
			p:    coachPatterns{HardBrakePct: 31},
			want: []catImpact{{"braking", "medium"}},
		},
		{
			name: "hard_brake_boundary_30_none",
			p:    coachPatterns{HardBrakePct: 30},
			want: []catImpact{{"general", "low"}},
		},
		{
			name:   "combined_multiple_no_general",
			p:      coachPatterns{HardAccelPct: 45, HighwayPct: 80, ShortTripPct: 60, ColdStartPct: 40, HardBrakePct: 35},
			avgEff: 200,
			want: []catImpact{
				{"acceleration", "high"},
				{"speed", "high"},
				{"trips", "medium"},
				{"climate", "medium"},
				{"efficiency", "medium"},
				{"braking", "medium"},
			},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := buildDrivingRecommendations(tc.p, tc.avgEff)

			if len(got) != len(tc.want) {
				t.Fatalf("recommendation count = %d, want %d\ngot=%+v", len(got), len(tc.want), got)
			}
			gotSet := make(map[catImpact]int, len(got))
			for _, r := range got {
				gotSet[catImpact{r.Category, r.Impact}]++
				if r.Tip == "" {
					t.Errorf("recommendation %+v has empty tip", r)
				}
			}
			for _, w := range tc.want {
				if gotSet[w] == 0 {
					t.Errorf("missing recommendation %+v\ngot=%+v", w, got)
				}
			}
			// "general" is the fallback and must never coexist with a
			// substantive recommendation.
			if len(tc.want) > 1 {
				if _, present := gotSet[catImpact{"general", "low"}]; present {
					t.Errorf("general fallback leaked into a populated recommendation set: %+v", got)
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// GetCoaching — input validation
// ---------------------------------------------------------------------------

func TestGetCoaching_Validation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name  string
		query string
	}{
		{"missing_vehicle_id", ""},
		{"empty_vehicle_id", "vehicle_id="},
		{"non_numeric_vehicle_id", "vehicle_id=abc"},
		{"float_vehicle_id", "vehicle_id=1.5"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeCoachRepo{}
			h := newHandlerForTest(repo)
			rec := httptest.NewRecorder()

			h.GetCoaching(rec, coachRequest(tc.query))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if repo.calls != 0 {
				t.Errorf("repo called %d times on invalid input; must validate first", repo.calls)
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode error body: %v", err)
			}
			if body["error"] == "" {
				t.Errorf("error body missing 'error' field: %s", rec.Body.String())
			}
			if body["code"] != "BAD_REQUEST" {
				t.Errorf("code = %q, want BAD_REQUEST", body["code"])
			}
		})
	}
}

// ---------------------------------------------------------------------------
// GetCoaching — days-window parsing / clamping
// ---------------------------------------------------------------------------

func TestGetCoaching_DaysWindow(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		query    string
		wantDays int
	}{
		{"default_when_absent", "vehicle_id=7", 30},
		{"invalid_falls_back_to_default", "vehicle_id=7&days=abc", 30},
		{"zero_falls_back_to_default", "vehicle_id=7&days=0", 30},
		{"negative_falls_back_to_default", "vehicle_id=7&days=-5", 30},
		{"above_max_falls_back_to_default", "vehicle_id=7&days=366", 30},
		{"max_inclusive", "vehicle_id=7&days=365", 365},
		{"custom", "vehicle_id=7&days=14", 14},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeCoachRepo{drives: nil} // empty -> 200 empty envelope
			h := newHandlerForTest(repo)
			rec := httptest.NewRecorder()

			before := time.Now()
			h.GetCoaching(rec, coachRequest(tc.query))
			after := time.Now()

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
			}
			if repo.calls != 1 {
				t.Fatalf("repo calls = %d, want 1", repo.calls)
			}
			if repo.gotVehicleID != 7 {
				t.Errorf("repo vehicleID = %d, want 7", repo.gotVehicleID)
			}
			// since must sit in [after-days, before-days]; AddDate keeps the
			// wall-clock offset so a small delta covers the time.Now() skew
			// between the handler and this test.
			lo := after.AddDate(0, 0, -tc.wantDays).Add(-2 * time.Second)
			hi := before.AddDate(0, 0, -tc.wantDays).Add(2 * time.Second)
			if repo.gotSince.Before(lo) || repo.gotSince.After(hi) {
				t.Errorf("since = %v, want ~%d days back (window [%v, %v])",
					repo.gotSince, tc.wantDays, lo, hi)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// GetCoaching — repository error surfaces as 500
// ---------------------------------------------------------------------------

func TestGetCoaching_RepoError(t *testing.T) {
	t.Parallel()

	repo := &fakeCoachRepo{err: errors.New("simulated pgx connection lost")}
	h := newHandlerForTest(repo)
	rec := httptest.NewRecorder()

	h.GetCoaching(rec, coachRequest("vehicle_id=42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body: %v", err)
	}
	if body["code"] != "INTERNAL_ERROR" {
		t.Errorf("code = %q, want INTERNAL_ERROR", body["code"])
	}
}

// ---------------------------------------------------------------------------
// GetCoaching — empty result set returns the well-formed empty envelope
// ---------------------------------------------------------------------------

func TestGetCoaching_Empty(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name   string
		drives []driveAnalysis
	}{
		{"nil_slice", nil},
		{"empty_slice", []driveAnalysis{}},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeCoachRepo{drives: tc.drives}
			h := newHandlerForTest(repo)
			rec := httptest.NewRecorder()

			h.GetCoaching(rec, coachRequest("vehicle_id=42"))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
				t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
			}

			got := decodeCoach(t, rec)
			if got.TotalDrivesAnalyzed != 0 {
				t.Errorf("total_drives_analyzed = %d, want 0", got.TotalDrivesAnalyzed)
			}
			if got.OverallScore != 0 {
				t.Errorf("overall_score = %d, want 0", got.OverallScore)
			}
			wantStyle := map[string]int{"efficient": 0, "moderate": 0, "aggressive": 0}
			for k, v := range wantStyle {
				if got.StyleBreakdown[k] != v {
					t.Errorf("style_breakdown[%q] = %d, want %d", k, got.StyleBreakdown[k], v)
				}
			}
			// Arrays must serialise as [] (non-nil) so the frontend can map
			// over them without a null guard.
			if got.WeeklyTrend == nil {
				t.Error("weekly_trend is nil; want []")
			}
			if got.Recommendations == nil {
				t.Error("recommendations is nil; want []")
			}
			if got.PerDriveScores == nil {
				t.Error("per_drive_scores is nil; want []")
			}
			for _, raw := range []string{`"weekly_trend":[]`, `"recommendations":[]`, `"per_drive_scores":[]`} {
				if !contains(rec.Body.String(), raw) {
					t.Errorf("body missing %s (empty arrays must not be null)\nbody=%s", raw, rec.Body.String())
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// GetCoaching — full happy-path computation
// ---------------------------------------------------------------------------

func TestGetCoaching_HappyPath(t *testing.T) {
	t.Parallel()

	// Three drives in the same ISO week (2026-06-15 is a Monday), newest
	// first, chosen so every derived field is hand-verifiable.
	d0 := mkDrive(101, time.Date(2026, 6, 17, 8, 0, 0, 0, time.UTC), 10, 60, 40, 30, 80, 70, 20) // efficient, eff 750
	d1 := mkDrive(102, time.Date(2026, 6, 16, 8, 0, 0, 0, time.UTC), 20, 90, 85, 120, 90, 60, 10) // moderate, eff 1125
	d2 := mkDrive(103, time.Date(2026, 6, 15, 8, 0, 0, 0, time.UTC), 3, 140, 30, 200, 50, 48, 0)   // aggressive, eff 500

	repo := &fakeCoachRepo{drives: []driveAnalysis{d0, d1, d2}}
	h := newHandlerForTest(repo)
	rec := httptest.NewRecorder()

	h.GetCoaching(rec, coachRequest("vehicle_id=42&days=60"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	got := decodeCoach(t, rec)

	if got.TotalDrivesAnalyzed != 3 {
		t.Errorf("total_drives_analyzed = %d, want 3", got.TotalDrivesAnalyzed)
	}

	wantStyle := map[string]int{"efficient": 1, "moderate": 1, "aggressive": 1}
	for k, v := range wantStyle {
		if got.StyleBreakdown[k] != v {
			t.Errorf("style_breakdown[%q] = %d, want %d", k, got.StyleBreakdown[k], v)
		}
	}

	if got.BestEfficiencyWhKm != 500 {
		t.Errorf("best_efficiency_wh_km = %v, want 500", got.BestEfficiencyWhKm)
	}
	// weighted average efficiency: (750*1 + 1125*0.95 + 500*0.9025)/2.8525
	if got.EfficiencyWhKm != 795.8 {
		t.Errorf("efficiency_wh_km = %v, want 795.8", got.EfficiencyWhKm)
	}
	// weighted average score: round((66*1 + 44*0.95 + 100*0.9025)/2.8525)
	if got.OverallScore != 69 {
		t.Errorf("overall_score = %d, want 69", got.OverallScore)
	}

	wantPatterns := coachPatterns{
		HardAccelPct: 66.7,
		HardBrakePct: 0,
		HighwayPct:   33.3,
		ShortTripPct: 33.3,
		ColdStartPct: 33.3,
	}
	if got.Patterns != wantPatterns {
		t.Errorf("patterns = %+v, want %+v", got.Patterns, wantPatterns)
	}

	// per-drive scores preserve repo (newest-first) order and shape.
	if len(got.PerDriveScores) != 3 {
		t.Fatalf("per_drive_scores len = %d, want 3", len(got.PerDriveScores))
	}
	wantEntries := []driveScoreEntry{
		{DriveID: 101, Date: "2026-06-17", Score: 66, Style: "efficient", Efficiency: 750, Distance: 10},
		{DriveID: 102, Date: "2026-06-16", Score: 44, Style: "moderate", Efficiency: 1125, Distance: 20},
		{DriveID: 103, Date: "2026-06-15", Score: 100, Style: "aggressive", Efficiency: 500, Distance: 3},
	}
	for i, w := range wantEntries {
		if got.PerDriveScores[i] != w {
			t.Errorf("per_drive_scores[%d] = %+v, want %+v", i, got.PerDriveScores[i], w)
		}
	}

	// single ISO week aggregate.
	if len(got.WeeklyTrend) != 1 {
		t.Fatalf("weekly_trend len = %d, want 1", len(got.WeeklyTrend))
	}
	yr, wk := d0.date.ISOWeek()
	wantWeek := isoWeekKey(yr, wk)
	wt := got.WeeklyTrend[0]
	if wt.Week != wantWeek {
		t.Errorf("weekly_trend[0].week = %q, want %q", wt.Week, wantWeek)
	}
	if wt.Drives != 3 {
		t.Errorf("weekly_trend[0].drives = %d, want 3", wt.Drives)
	}
	if wt.Score != 70 { // (66+44+100)/3
		t.Errorf("weekly_trend[0].score = %d, want 70", wt.Score)
	}
	if wt.Efficiency != 791.7 { // round((750+1125+500)/3, .1)
		t.Errorf("weekly_trend[0].efficiency = %v, want 791.7", wt.Efficiency)
	}

	if len(got.Recommendations) == 0 {
		t.Error("recommendations empty; want at least one")
	}

	// JSON wire shape: snake_case keys must all be present.
	for _, k := range []string{
		"overall_score", "efficiency_wh_km", "best_efficiency_wh_km",
		"total_drives_analyzed", "style_breakdown", "patterns",
		"weekly_trend", "recommendations", "per_drive_scores",
	} {
		if !contains(rec.Body.String(), `"`+k+`"`) {
			t.Errorf("response missing key %q\nbody=%s", k, rec.Body.String())
		}
	}
}

// ---------------------------------------------------------------------------
// GetCoaching — per-drive list is capped at 50 while totals count everything
// ---------------------------------------------------------------------------

func TestGetCoaching_PerDriveCap(t *testing.T) {
	t.Parallel()

	base := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	drives := make([]driveAnalysis, 0, 61)
	for i := 0; i < 61; i++ {
		// distinct SoC drop keeps every drive's efficiency > 0 so it scores.
		drives = append(drives, mkDrive(
			int64(1000+i),
			base.AddDate(0, 0, -i),
			10, 55, 40, 40,
			80, 70, 20,
		))
	}
	repo := &fakeCoachRepo{drives: drives}
	h := newHandlerForTest(repo)
	rec := httptest.NewRecorder()

	h.GetCoaching(rec, coachRequest("vehicle_id=42&days=365"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	got := decodeCoach(t, rec)

	if got.TotalDrivesAnalyzed != 61 {
		t.Errorf("total_drives_analyzed = %d, want 61", got.TotalDrivesAnalyzed)
	}
	if len(got.PerDriveScores) != 50 {
		t.Errorf("per_drive_scores len = %d, want 50 (cap)", len(got.PerDriveScores))
	}
}

// ---------------------------------------------------------------------------
// GetCoaching — weekly-trend grouping across ISO weeks is sorted ascending
// ---------------------------------------------------------------------------

func TestGetCoaching_WeeklyTrendGrouping(t *testing.T) {
	t.Parallel()

	// Two drives in ISO week A (2026-06-15/16) and one the prior Monday
	// (2026-06-08, ISO week A-1). Repo yields newest-first.
	weekA0 := mkDrive(1, time.Date(2026, 6, 16, 9, 0, 0, 0, time.UTC), 12, 60, 40, 40, 80, 70, 20)
	weekA1 := mkDrive(2, time.Date(2026, 6, 15, 9, 0, 0, 0, time.UTC), 8, 60, 40, 40, 70, 60, 20)
	weekB := mkDrive(3, time.Date(2026, 6, 8, 9, 0, 0, 0, time.UTC), 10, 60, 40, 40, 90, 80, 20)

	repo := &fakeCoachRepo{drives: []driveAnalysis{weekA0, weekA1, weekB}}
	h := newHandlerForTest(repo)
	rec := httptest.NewRecorder()

	h.GetCoaching(rec, coachRequest("vehicle_id=42&days=90"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	got := decodeCoach(t, rec)

	if len(got.WeeklyTrend) != 2 {
		t.Fatalf("weekly_trend len = %d, want 2\ntrend=%+v", len(got.WeeklyTrend), got.WeeklyTrend)
	}
	// Ascending week order.
	if got.WeeklyTrend[0].Week >= got.WeeklyTrend[1].Week {
		t.Errorf("weekly_trend not ascending: %q then %q",
			got.WeeklyTrend[0].Week, got.WeeklyTrend[1].Week)
	}

	yrB, wkB := weekB.date.ISOWeek()
	yrA, wkA := weekA0.date.ISOWeek()
	if got.WeeklyTrend[0].Week != isoWeekKey(yrB, wkB) {
		t.Errorf("first week = %q, want %q", got.WeeklyTrend[0].Week, isoWeekKey(yrB, wkB))
	}
	if got.WeeklyTrend[1].Week != isoWeekKey(yrA, wkA) {
		t.Errorf("second week = %q, want %q", got.WeeklyTrend[1].Week, isoWeekKey(yrA, wkA))
	}
	if got.WeeklyTrend[0].Drives != 1 {
		t.Errorf("week B drives = %d, want 1", got.WeeklyTrend[0].Drives)
	}
	if got.WeeklyTrend[1].Drives != 2 {
		t.Errorf("week A drives = %d, want 2", got.WeeklyTrend[1].Drives)
	}
}

// ---------------------------------------------------------------------------
// GetCoaching — drives with no usable efficiency still return 200 safely
// ---------------------------------------------------------------------------

func TestGetCoaching_NoEfficiency(t *testing.T) {
	t.Parallel()

	// socStart <= socEnd (battery rose / flat) -> efficiency stays 0 -> score
	// 0 -> overall 0, best 0; the handler must not divide by zero or panic.
	drives := []driveAnalysis{
		mkDrive(1, time.Date(2026, 5, 2, 9, 0, 0, 0, time.UTC), 10, 60, 40, 30, 60, 60, 20),
		mkDrive(2, time.Date(2026, 5, 1, 9, 0, 0, 0, time.UTC), 10, 60, 40, 30, 50, 55, 20),
	}
	repo := &fakeCoachRepo{drives: drives}
	h := newHandlerForTest(repo)
	rec := httptest.NewRecorder()

	h.GetCoaching(rec, coachRequest("vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	got := decodeCoach(t, rec)

	if got.TotalDrivesAnalyzed != 2 {
		t.Errorf("total_drives_analyzed = %d, want 2", got.TotalDrivesAnalyzed)
	}
	if got.OverallScore != 0 {
		t.Errorf("overall_score = %d, want 0", got.OverallScore)
	}
	if got.BestEfficiencyWhKm != 0 {
		t.Errorf("best_efficiency_wh_km = %v, want 0", got.BestEfficiencyWhKm)
	}
	if got.EfficiencyWhKm != 0 {
		t.Errorf("efficiency_wh_km = %v, want 0", got.EfficiencyWhKm)
	}
	for _, e := range got.PerDriveScores {
		if e.Score != 0 {
			t.Errorf("drive %d score = %d, want 0 (no efficiency)", e.DriveID, e.Score)
		}
	}
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

// isoWeekKey mirrors the handler's weekly-trend key format ("%d-W%02d").
func isoWeekKey(year, week int) string {
	return fmt.Sprintf("%d-W%02d", year, week)
}

func contains(haystack, needle string) bool {
	return strings.Contains(haystack, needle)
}
