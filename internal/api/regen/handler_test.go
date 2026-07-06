package regen

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Test doubles / helpers
// ---------------------------------------------------------------------------

func fptr(v float64) *float64 { return &v }
func i64ptr(v int64) *int64   { return &v }

func almostEqual(a, b float64) bool { return math.Abs(a-b) < 1e-6 }

// regenCall records the arguments a repo method was invoked with so the
// tests can assert vehicle-id / window propagation.
type regenCall struct {
	vehicleID int64
	hasRange  bool
	start     time.Time
	end       time.Time
}

// fakeRegenRepo is an in-memory regenRepository. Each field seeds a
// method's return; the *Err fields force the corresponding failure.
type fakeRegenRepo struct {
	drives     []driveRegenRow
	drivesErr  error
	monthly    []monthlyRegenRow
	monthlyErr error
	regenWh    float64
	driveWh    float64
	energyErr  error
	vin        string
	model      string
	modelErr   error

	driveCalls   []regenCall
	monthlyCalls []regenCall
	energyCalls  []regenCall
	modelCalls   []int64
	order        []string
}

func (f *fakeRegenRepo) DriveRegens(_ context.Context, vehicleID int64, hasRange bool, start, end time.Time) ([]driveRegenRow, error) {
	f.driveCalls = append(f.driveCalls, regenCall{vehicleID, hasRange, start, end})
	f.order = append(f.order, "drives")
	if f.drivesErr != nil {
		return nil, f.drivesErr
	}
	return f.drives, nil
}

func (f *fakeRegenRepo) MonthlyRegens(_ context.Context, vehicleID int64, hasRange bool, start, end time.Time) ([]monthlyRegenRow, error) {
	f.monthlyCalls = append(f.monthlyCalls, regenCall{vehicleID, hasRange, start, end})
	f.order = append(f.order, "monthly")
	if f.monthlyErr != nil {
		return nil, f.monthlyErr
	}
	return f.monthly, nil
}

func (f *fakeRegenRepo) LifetimeEnergy(_ context.Context, vehicleID int64, hasRange bool, start, end time.Time) (float64, float64, error) {
	f.energyCalls = append(f.energyCalls, regenCall{vehicleID, hasRange, start, end})
	f.order = append(f.order, "energy")
	if f.energyErr != nil {
		return 0, 0, f.energyErr
	}
	return f.regenWh, f.driveWh, nil
}

func (f *fakeRegenRepo) VehicleModel(_ context.Context, vehicleID int64) (string, string, error) {
	f.modelCalls = append(f.modelCalls, vehicleID)
	f.order = append(f.order, "model")
	if f.modelErr != nil {
		return "", "", f.modelErr
	}
	return f.vin, f.model, nil
}

func regenRequest(target string) *http.Request {
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// statsResp mirrors the Stats JSON envelope. driveRegen / monthlySummary
// are reused from the package so a decode also validates their JSON tags.
type statsResp struct {
	VehicleID         int64            `json:"vehicle_id"`
	TotalRegenWh      float64          `json:"total_regen_wh"`
	TotalDriveWh      float64          `json:"total_drive_wh"`
	RegenRatio        float64          `json:"regen_ratio"`
	MonthlyAvgRegen   float64          `json:"monthly_avg_regen"`
	FreeCharges       float64          `json:"free_charges"`
	MonthlySummary    []monthlySummary `json:"monthly_summary"`
	Drives            []driveRegen     `json:"drives"`
	BatteryCapacityWh float64          `json:"battery_capacity_wh"`
	CapacitySource    string           `json:"capacity_source"`
}

// ---------------------------------------------------------------------------
// estimateBatteryCapacityWh — pure function
// ---------------------------------------------------------------------------

func TestEstimateBatteryCapacityWh(t *testing.T) {
	t.Parallel()
	// vinWith produces an 8-char VIN whose battery-type character (index 7)
	// is c, so the switch branch under test is deterministically selected.
	vinWith := func(c byte) string { return "TESLA00" + string(c) }

	cases := []struct {
		name       string
		vin        string
		model      string
		wantWh     float64
		wantSource string
	}{
		{"vin_E_standard", vinWith('E'), "", standardCapacityWh, "vin_estimate"},
		{"vin_F_standard", vinWith('F'), "", standardCapacityWh, "vin_estimate"},
		{"vin_K_default", vinWith('K'), "", defaultCapacityWh, "vin_estimate"},
		{"vin_L_default", vinWith('L'), "", defaultCapacityWh, "vin_estimate"},
		{"vin_M_default", vinWith('M'), "", defaultCapacityWh, "vin_estimate"},
		{"vin_S_large", vinWith('S'), "", largeCapacityWh, "vin_estimate"},
		{"vin_A_large", vinWith('A'), "", largeCapacityWh, "vin_estimate"},
		{"vin_P_large", vinWith('P'), "", largeCapacityWh, "vin_estimate"},
		// VIN battery char takes precedence over the model name.
		{"vin_wins_over_model", vinWith('S'), "Model 3", largeCapacityWh, "vin_estimate"},
		// Unknown battery char falls through to the model-name heuristic.
		{"unknown_char_model_s", vinWith('Z'), "Model S", largeCapacityWh, "model_estimate"},
		{"unknown_char_model_x_lower", vinWith('Z'), "model x long range", largeCapacityWh, "model_estimate"},
		{"unknown_char_model_3", vinWith('Z'), "Model 3", defaultCapacityWh, "default"},
		// Short / empty VIN → model heuristic only.
		{"short_vin_model_s", "1234567", "Model S Plaid", largeCapacityWh, "model_estimate"},
		{"empty_vin_model_x", "", "MODEL X", largeCapacityWh, "model_estimate"},
		{"empty_vin_model_y", "", "Model Y", defaultCapacityWh, "default"},
		{"empty_all", "", "", defaultCapacityWh, "default"},
		// Real-length VIN with battery char 'A' at index 7.
		{"full_vin_A", "5YJ3E7EA691234567", "Model 3", largeCapacityWh, "vin_estimate"},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			gotWh, gotSource := estimateBatteryCapacityWh(c.vin, c.model)
			if !almostEqual(gotWh, c.wantWh) {
				t.Errorf("capacity = %v, want %v", gotWh, c.wantWh)
			}
			if gotSource != c.wantSource {
				t.Errorf("source = %q, want %q", gotSource, c.wantSource)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// regenScore — pure function
// ---------------------------------------------------------------------------

func TestRegenScore(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		power *float64
		speed *float64
		want  float64
	}{
		{"nil_power_is_zero", nil, fptr(20), 0},
		{"nil_power_nil_speed", nil, nil, 0},
		{"speed_nil_falls_back_to_one", fptr(-1000), nil, 1.0},
		{"speed_zero_falls_back_to_one", fptr(-1000), fptr(0), 1.0},
		{"speed_negative_falls_back_to_one", fptr(-1000), fptr(-3), 1.0},
		{"negative_power_abs", fptr(-250), fptr(mpsPerMph), 2.5},
		{"positive_power_abs_same", fptr(250), fptr(mpsPerMph), 2.5},
		{"capped_at_100", fptr(-1000000), fptr(mpsPerMph), 100},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := regenScore(c.power, c.speed); !almostEqual(got, c.want) {
				t.Errorf("regenScore(%v, %v) = %v, want %v", c.power, c.speed, got, c.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// regenRatio / avgMonthlyRegen / freeChargesEquivalent — pure functions
// ---------------------------------------------------------------------------

func TestRegenRatio(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name         string
		regen, drive float64
		want         float64
	}{
		{"both_zero", 0, 0, 0},
		{"zero_drive_guard", 50, 0, 0},
		{"negative_drive_guard", 50, -10, 0},
		{"half", 50, 100, 50},
		{"quarter", 30, 120, 25},
		{"ten_percent", 5, 50, 10},
		{"full", 100, 100, 100},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := regenRatio(c.regen, c.drive); !almostEqual(got, c.want) {
				t.Errorf("regenRatio(%v,%v) = %v, want %v", c.regen, c.drive, got, c.want)
			}
		})
	}
}

func TestAvgMonthlyRegen(t *testing.T) {
	t.Parallel()
	mk := func(vals ...float64) []monthlySummary {
		out := make([]monthlySummary, 0, len(vals))
		for _, v := range vals {
			out = append(out, monthlySummary{AvgRegenPower: v})
		}
		return out
	}
	cases := []struct {
		name string
		in   []monthlySummary
		want float64
	}{
		{"empty_is_zero", nil, 0},
		{"empty_slice_is_zero", mk(), 0},
		{"single", mk(12.5), 12.5},
		{"two_average", mk(10, 20), 15},
		{"three_average", mk(10, 11, 12), 11},
		{"rounds_to_one_decimal", mk(10.04, 10.04), 10.0},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := avgMonthlyRegen(c.in); !almostEqual(got, c.want) {
				t.Errorf("avgMonthlyRegen(%v) = %v, want %v", c.in, got, c.want)
			}
		})
	}
}

func TestFreeChargesEquivalent(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name            string
		regen, capacity float64
		want            float64
	}{
		{"zero_regen", 0, 75000, 0},
		{"zero_capacity", 75000, 0, 0},
		{"negative_regen", -5, 75000, 0},
		{"exactly_one", 75000, 75000, 1.0},
		{"two", 150000, 75000, 2.0},
		{"one_and_half", 112500, 75000, 1.5},
		{"rounds_to_one_decimal", 80000, 75000, 1.1},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := freeChargesEquivalent(c.regen, c.capacity); !almostEqual(got, c.want) {
				t.Errorf("freeChargesEquivalent(%v,%v) = %v, want %v", c.regen, c.capacity, got, c.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// build helpers — null-safety ([] not null) + field mapping
// ---------------------------------------------------------------------------

func TestBuildDriveRegens_NilInputIsNonNilEmpty(t *testing.T) {
	t.Parallel()
	got := buildDriveRegens(nil)
	if got == nil {
		t.Fatal("buildDriveRegens(nil) returned nil slice — must be [] for JSON null-safety")
	}
	if len(got) != 0 {
		t.Fatalf("len = %d, want 0", len(got))
	}
	b, _ := json.Marshal(got)
	if string(b) != "[]" {
		t.Errorf("marshalled = %s, want []", b)
	}
}

func TestBuildDriveRegens_MapsFieldsAndConversions(t *testing.T) {
	t.Parallel()
	rows := []driveRegenRow{{
		ID:          7,
		DistanceM:   fptr(16093.44), // 10 miles
		DurationS:   i64ptr(600),
		SpeedAvgMps: fptr(20),
		PowerAvgW:   fptr(15000),
		PowerMinW:   fptr(-5000),
		StartSocPct: fptr(80),
		EndSocPct:   fptr(75),
		Efficiency:  42,
	}}
	got := buildDriveRegens(rows)
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	d := got[0]
	if d.ID != 7 {
		t.Errorf("ID = %d, want 7", d.ID)
	}
	if !almostEqual(d.Distance, 10) {
		t.Errorf("Distance = %v, want 10 (miles)", d.Distance)
	}
	if !almostEqual(d.DurationS, 600) {
		t.Errorf("DurationS = %v, want 600", d.DurationS)
	}
	if d.PowerMaxW == nil || !almostEqual(*d.PowerMaxW, 15000) {
		t.Errorf("PowerMaxW = %v, want 15000 (avg_power_w passthrough)", d.PowerMaxW)
	}
	if !almostEqual(d.RegenScore, 1.1) {
		t.Errorf("RegenScore = %v, want 1.1", d.RegenScore)
	}
}

func TestBuildMonthlyRegens_NilInputIsNonNilEmpty(t *testing.T) {
	t.Parallel()
	got := buildMonthlyRegens(nil)
	if got == nil || len(got) != 0 {
		t.Fatalf("buildMonthlyRegens(nil) = %v, want non-nil empty", got)
	}
	b, _ := json.Marshal(got)
	if string(b) != "[]" {
		t.Errorf("marshalled = %s, want []", b)
	}
}

// ---------------------------------------------------------------------------
// Stats handler — validation
// ---------------------------------------------------------------------------

func TestStats_Validation(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		query    string
		wantBody string
	}{
		{"missing", "", "vehicle_id is required"},
		{"empty", "vehicle_id=", "vehicle_id is required"},
		{"non_numeric", "vehicle_id=abc", "invalid vehicle_id"},
		{"float", "vehicle_id=1.5", "invalid vehicle_id"},
		{"zero", "vehicle_id=0", "vehicle_id must be positive"},
		{"negative", "vehicle_id=-5", "vehicle_id must be positive"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeRegenRepo{}
			h := newRegenHandlerForTest(repo)
			rec := httptest.NewRecorder()
			h.Stats(rec, regenRequest("/analytics/regen?"+c.query))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), c.wantBody) {
				t.Errorf("body missing %q\nbody=%s", c.wantBody, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
				t.Errorf("Content-Type = %q, want application/json; charset=utf-8", ct)
			}
			// No repository work must happen for a rejected request.
			if len(repo.order) != 0 {
				t.Errorf("repo called %v for invalid request — must validate first", repo.order)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Stats handler — success envelope
// ---------------------------------------------------------------------------

func TestStats_Success(t *testing.T) {
	t.Parallel()
	started := time.Date(2026, 1, 15, 10, 0, 0, 0, time.UTC)
	repo := &fakeRegenRepo{
		vin: "TESLA00K", // index 7 == 'K' -> default capacity, vin_estimate
		drives: []driveRegenRow{
			{
				ID: 1, StartDate: started,
				DistanceM: fptr(16093.44), DurationS: i64ptr(600),
				SpeedAvgMps: fptr(20), PowerAvgW: fptr(15000), PowerMinW: fptr(-5000),
				StartSocPct: fptr(80), EndSocPct: fptr(75), Efficiency: 42,
			},
			{ID: 2, StartDate: started.Add(time.Hour)}, // all-nil optionals
		},
		monthly: []monthlyRegenRow{
			{Month: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), DriveCount: 5, AvgPowerW: fptr(12000), AvgSpeedMps: fptr(20), AvgEff: fptr(42.5)},
			{Month: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC), DriveCount: 3, AvgPowerW: fptr(8000)},
		},
		regenWh: 150000,
		driveWh: 600000,
	}
	h := newRegenHandlerForTest(repo)
	rec := httptest.NewRecorder()
	h.Stats(rec, regenRequest("/analytics/regen?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}

	var resp statsResp
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}

	if resp.VehicleID != 42 {
		t.Errorf("vehicle_id = %d, want 42", resp.VehicleID)
	}
	if !almostEqual(resp.TotalRegenWh, 150000) {
		t.Errorf("total_regen_wh = %v, want 150000", resp.TotalRegenWh)
	}
	if !almostEqual(resp.TotalDriveWh, 600000) {
		t.Errorf("total_drive_wh = %v, want 600000", resp.TotalDriveWh)
	}
	if !almostEqual(resp.RegenRatio, 25) {
		t.Errorf("regen_ratio = %v, want 25", resp.RegenRatio)
	}
	if !almostEqual(resp.MonthlyAvgRegen, 10000) {
		t.Errorf("monthly_avg_regen = %v, want 10000 (avg of 12000,8000 watts)", resp.MonthlyAvgRegen)
	}
	if !almostEqual(resp.FreeCharges, 2) {
		t.Errorf("free_charges = %v, want 2", resp.FreeCharges)
	}
	if !almostEqual(resp.BatteryCapacityWh, defaultCapacityWh) {
		t.Errorf("battery_capacity_wh = %v, want %v", resp.BatteryCapacityWh, defaultCapacityWh)
	}
	if resp.CapacitySource != "vin_estimate" {
		t.Errorf("capacity_source = %q, want vin_estimate", resp.CapacitySource)
	}

	// Drives
	if len(resp.Drives) != 2 {
		t.Fatalf("drives len = %d, want 2", len(resp.Drives))
	}
	d0 := resp.Drives[0]
	if !d0.StartDate.Equal(started) {
		t.Errorf("drives[0].start_date = %v, want %v", d0.StartDate, started)
	}
	if !almostEqual(d0.Distance, 10) {
		t.Errorf("drives[0].distance = %v, want 10 miles", d0.Distance)
	}
	if !almostEqual(d0.DurationS, 600) {
		t.Errorf("drives[0].duration_s = %v, want 600", d0.DurationS)
	}
	if d0.SpeedAvgMps == nil || !almostEqual(*d0.SpeedAvgMps, 20) {
		t.Errorf("drives[0].avg_speed_mps = %v, want 20 (raw m/s)", d0.SpeedAvgMps)
	}
	if !almostEqual(d0.RegenScore, 1.1) {
		t.Errorf("drives[0].regen_score = %v, want 1.1", d0.RegenScore)
	}
	// Second drive has all-nil optionals -> nulls preserved, score 0.
	d1 := resp.Drives[1]
	if d1.SpeedAvgMps != nil || d1.PowerMaxW != nil || d1.PowerMinW != nil || d1.StartSocPct != nil {
		t.Errorf("drives[1] optionals should be null, got %+v", d1)
	}
	if !almostEqual(d1.Distance, 0) || !almostEqual(d1.RegenScore, 0) {
		t.Errorf("drives[1] distance/score = %v/%v, want 0/0", d1.Distance, d1.RegenScore)
	}

	// Monthly
	if len(resp.MonthlySummary) != 2 {
		t.Fatalf("monthly len = %d, want 2", len(resp.MonthlySummary))
	}
	m0 := resp.MonthlySummary[0]
	if m0.Month != "2026-01" {
		t.Errorf("monthly[0].month = %q, want 2026-01", m0.Month)
	}
	if m0.DriveCount != 5 {
		t.Errorf("monthly[0].drive_count = %d, want 5", m0.DriveCount)
	}
	if !almostEqual(m0.AvgRegenPower, 12000) {
		t.Errorf("monthly[0].avg_regen_power_kw = %v, want 12000 (SI watts passthrough)", m0.AvgRegenPower)
	}
	if !almostEqual(m0.AvgSpeed, 44.7) {
		t.Errorf("monthly[0].avg_speed = %v, want 44.7 (mph)", m0.AvgSpeed)
	}
	if !almostEqual(m0.AvgEfficiency, 42.5) {
		t.Errorf("monthly[0].avg_efficiency = %v, want 42.5", m0.AvgEfficiency)
	}
	m1 := resp.MonthlySummary[1]
	if m1.Month != "2026-02" || !almostEqual(m1.AvgSpeed, 0) || !almostEqual(m1.AvgEfficiency, 0) {
		t.Errorf("monthly[1] = %+v, want {2026-02, avg_speed 0, avg_eff 0}", m1)
	}

	// Full request without a date range -> repo sees hasRange=false and
	// every data method sees the same vehicle id.
	if len(repo.driveCalls) != 1 || repo.driveCalls[0].vehicleID != 42 || repo.driveCalls[0].hasRange {
		t.Errorf("driveCalls = %+v, want one call vehicleID=42 hasRange=false", repo.driveCalls)
	}
	if len(repo.modelCalls) != 1 || repo.modelCalls[0] != 42 {
		t.Errorf("modelCalls = %v, want [42]", repo.modelCalls)
	}
}

// ---------------------------------------------------------------------------
// Stats handler — empty data (null-safe [] envelopes)
// ---------------------------------------------------------------------------

func TestStats_EmptyData(t *testing.T) {
	t.Parallel()
	repo := &fakeRegenRepo{vin: "unknownvin", model: "Roadster"} // -> default capacity
	h := newRegenHandlerForTest(repo)
	rec := httptest.NewRecorder()
	h.Stats(rec, regenRequest("/analytics/regen?vehicle_id=9"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	// Arrays must serialise as [] not null (frontend null-safety contract).
	if !strings.Contains(body, `"drives":[]`) {
		t.Errorf("drives not [] in body: %s", body)
	}
	if !strings.Contains(body, `"monthly_summary":[]`) {
		t.Errorf("monthly_summary not [] in body: %s", body)
	}

	var resp statsResp
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Drives) != 0 || len(resp.MonthlySummary) != 0 {
		t.Errorf("want empty slices, got drives=%d monthly=%d", len(resp.Drives), len(resp.MonthlySummary))
	}
	if !almostEqual(resp.RegenRatio, 0) || !almostEqual(resp.MonthlyAvgRegen, 0) || !almostEqual(resp.FreeCharges, 0) {
		t.Errorf("expected zeroed aggregates, got %+v", resp)
	}
	if !almostEqual(resp.BatteryCapacityWh, defaultCapacityWh) || resp.CapacitySource != "default" {
		t.Errorf("capacity = %v/%q, want %v/default", resp.BatteryCapacityWh, resp.CapacitySource, defaultCapacityWh)
	}
}

// ---------------------------------------------------------------------------
// Stats handler — repository failures
// ---------------------------------------------------------------------------

func TestStats_DrivesError_500(t *testing.T) {
	t.Parallel()
	repo := &fakeRegenRepo{drivesErr: errors.New("boom")}
	h := newRegenHandlerForTest(repo)
	rec := httptest.NewRecorder()
	h.Stats(rec, regenRequest("/analytics/regen?vehicle_id=42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "failed to get regen data") {
		t.Errorf("body = %s", rec.Body.String())
	}
	// Drives failure short-circuits before monthly / energy.
	if len(repo.monthlyCalls) != 0 || len(repo.energyCalls) != 0 {
		t.Errorf("monthly/energy should not run after drives error: %v", repo.order)
	}
}

func TestStats_MonthlyError_500(t *testing.T) {
	t.Parallel()
	repo := &fakeRegenRepo{monthlyErr: errors.New("boom")}
	h := newRegenHandlerForTest(repo)
	rec := httptest.NewRecorder()
	h.Stats(rec, regenRequest("/analytics/regen?vehicle_id=42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.energyCalls) != 0 {
		t.Errorf("energy should not run after monthly error: %v", repo.order)
	}
}

func TestStats_LifetimeEnergyError_NonFatal(t *testing.T) {
	t.Parallel()
	repo := &fakeRegenRepo{
		energyErr: errors.New("cagg down"),
		drives:    []driveRegenRow{{ID: 1, DistanceM: fptr(16093.44)}},
		monthly:   []monthlyRegenRow{{Month: time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC), DriveCount: 1, AvgPowerW: fptr(9000)}},
		vin:       "TESLA00S", // large capacity
	}
	h := newRegenHandlerForTest(repo)
	rec := httptest.NewRecorder()
	h.Stats(rec, regenRequest("/analytics/regen?vehicle_id=42"))

	// A lifetime-energy failure degrades gauges to zero but the response
	// still succeeds with the per-drive and monthly data intact.
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (energy failure must be non-fatal)", rec.Code)
	}
	var resp statsResp
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !almostEqual(resp.TotalRegenWh, 0) || !almostEqual(resp.TotalDriveWh, 0) || !almostEqual(resp.RegenRatio, 0) || !almostEqual(resp.FreeCharges, 0) {
		t.Errorf("energy-derived fields should be zero, got %+v", resp)
	}
	if len(resp.Drives) != 1 || len(resp.MonthlySummary) != 1 {
		t.Errorf("drives/monthly should survive energy failure: %d/%d", len(resp.Drives), len(resp.MonthlySummary))
	}
}

// ---------------------------------------------------------------------------
// Stats handler — capacity provenance + non-404 on unknown vehicle
// ---------------------------------------------------------------------------

func TestStats_Capacity(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		vin        string
		model      string
		modelErr   error
		wantWh     float64
		wantSource string
	}{
		{"vin_estimate_large", "TESLA00S", "", nil, largeCapacityWh, "vin_estimate"},
		{"vin_estimate_standard", "TESLA00E", "", nil, standardCapacityWh, "vin_estimate"},
		{"model_estimate", "shortvin", "Model X", nil, largeCapacityWh, "model_estimate"},
		{"default_when_unknown", "shortvin", "Model 3", nil, defaultCapacityWh, "default"},
		{"repo_error_falls_back_default", "", "", errors.New("no such vehicle"), defaultCapacityWh, "default"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeRegenRepo{vin: c.vin, model: c.model, modelErr: c.modelErr}
			h := newRegenHandlerForTest(repo)
			rec := httptest.NewRecorder()
			h.Stats(rec, regenRequest("/analytics/regen?vehicle_id=123"))

			// Unknown vehicle is NOT a 404: regen reports data for any id.
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			var resp statsResp
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Fatalf("decode: %v", err)
			}
			if !almostEqual(resp.BatteryCapacityWh, c.wantWh) {
				t.Errorf("battery_capacity_wh = %v, want %v", resp.BatteryCapacityWh, c.wantWh)
			}
			if resp.CapacitySource != c.wantSource {
				t.Errorf("capacity_source = %q, want %q", resp.CapacitySource, c.wantSource)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Stats handler — date-range propagation
// ---------------------------------------------------------------------------

func TestStats_DateRangePropagation(t *testing.T) {
	t.Parallel()

	t.Run("with_range", func(t *testing.T) {
		t.Parallel()
		repo := &fakeRegenRepo{}
		h := newRegenHandlerForTest(repo)
		rec := httptest.NewRecorder()
		h.Stats(rec, regenRequest("/analytics/regen?vehicle_id=42&start=2026-01-01&end=2026-01-31"))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		for _, calls := range [][]regenCall{repo.driveCalls, repo.monthlyCalls, repo.energyCalls} {
			if len(calls) != 1 {
				t.Fatalf("want exactly one call per data method, got %d", len(calls))
			}
			c := calls[0]
			if !c.hasRange {
				t.Errorf("hasRange = false, want true when start & end supplied")
			}
			if c.start.Year() != 2026 || c.start.Month() != time.January || c.start.Day() != 1 {
				t.Errorf("start = %v, want 2026-01-01", c.start)
			}
			if c.end.Year() != 2026 || c.end.Month() != time.January || c.end.Day() != 31 {
				t.Errorf("end = %v, want 2026-01-31", c.end)
			}
		}
	})

	t.Run("without_range", func(t *testing.T) {
		t.Parallel()
		repo := &fakeRegenRepo{}
		h := newRegenHandlerForTest(repo)
		rec := httptest.NewRecorder()
		h.Stats(rec, regenRequest("/analytics/regen?vehicle_id=42"))

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if len(repo.driveCalls) != 1 {
			t.Fatalf("want one drive call")
		}
		c := repo.driveCalls[0]
		if c.hasRange || !c.start.IsZero() || !c.end.IsZero() {
			t.Errorf("no range expected, got hasRange=%v start=%v end=%v", c.hasRange, c.start, c.end)
		}
	})
}

// ---------------------------------------------------------------------------
// Constructor smoke — the exported wiring path
// ---------------------------------------------------------------------------

func TestNewRegenHandler(t *testing.T) {
	t.Parallel()
	if h := NewRegenHandler(nil); h == nil || h.repo == nil {
		t.Fatal("NewRegenHandler(nil) must return a wired handler")
	}
}
