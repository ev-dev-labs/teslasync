package rul

import (
	"math"
	"testing"
	"time"
)

// A fixed clock so every date-emitting function is deterministic.
var testNow = time.Date(2024, 6, 1, 12, 0, 0, 0, time.UTC)

func approx(a, b, tol float64) bool { return math.Abs(a-b) <= tol }

// ---------------------------------------------------------------------------
// LinearFit
// ---------------------------------------------------------------------------

func TestLinearFit(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		pts       []Point
		wantSlope float64
		wantR2    float64
		wantN     int
		wantInt   float64
	}{
		{
			name:      "perfect declining line",
			pts:       []Point{{0, 100}, {10, 90}, {20, 80}, {30, 70}},
			wantSlope: -1, wantR2: 1, wantN: 4, wantInt: 100,
		},
		{
			name:      "empty",
			pts:       nil,
			wantSlope: 0, wantR2: 0, wantN: 0, wantInt: 0,
		},
		{
			name:      "single point carries Y as intercept",
			pts:       []Point{{5, 88}},
			wantSlope: 0, wantR2: 0, wantN: 1, wantInt: 88,
		},
		{
			name:      "zero X variance -> flat, mean intercept",
			pts:       []Point{{7, 90}, {7, 80}, {7, 100}},
			wantSlope: 0, wantR2: 0, wantN: 3, wantInt: 90,
		},
		{
			name:      "zero Y variance -> flat, R2 zero",
			pts:       []Point{{0, 95}, {10, 95}, {20, 95}},
			wantSlope: 0, wantR2: 0, wantN: 3, wantInt: 95,
		},
		{
			name:      "noisy positive trend has 0<R2<1",
			pts:       []Point{{0, 10}, {1, 12}, {2, 11}, {3, 15}, {4, 14}},
			wantSlope: 1.1, wantR2: 0.7035, wantN: 5, wantInt: 10.2,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := LinearFit(tc.pts)
			if got.N != tc.wantN {
				t.Errorf("N = %d, want %d", got.N, tc.wantN)
			}
			if !approx(got.Slope, tc.wantSlope, 1e-6) {
				t.Errorf("Slope = %v, want %v", got.Slope, tc.wantSlope)
			}
			if !approx(got.R2, tc.wantR2, 1e-3) {
				t.Errorf("R2 = %v, want %v", got.R2, tc.wantR2)
			}
			if !approx(got.Intercept, tc.wantInt, 1e-4) {
				t.Errorf("Intercept = %v, want %v", got.Intercept, tc.wantInt)
			}
			if math.IsNaN(got.Slope) || math.IsNaN(got.R2) || math.IsNaN(got.Intercept) {
				t.Errorf("NaN leaked: %+v", got)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Confidence scores
// ---------------------------------------------------------------------------

func TestRegressionConfidence(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		r2   float64
		n    int
		want float64
	}{
		{"tight fit, ample history", 1.0, 30, 1.0},
		{"tight fit, half history", 1.0, 15, 0.5},
		{"tight fit, sparse", 1.0, 3, 0.1},
		{"weak fit, ample history", 0.4, 60, 0.4},
		{"r2 above 1 is clamped", 1.5, 30, 1.0},
		{"negative r2 clamped to 0", -0.3, 30, 0.0},
		{"no data", 0.0, 0, 0.0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := RegressionConfidence(tc.r2, tc.n); !approx(got, tc.want, 1e-9) {
				t.Errorf("= %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSampleConfidence(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name             string
		samples          int
		adequate         float64
		want             float64
	}{
		{"at adequate", 40, 40, 1.0},
		{"above adequate clamps", 100, 40, 1.0},
		{"half", 20, 40, 0.5},
		{"zero samples", 0, 40, 0.0},
		{"zero adequate guarded", 10, 0, 0.0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := SampleConfidence(tc.samples, tc.adequate); !approx(got, tc.want, 1e-9) {
				t.Errorf("= %v, want %v", got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// RemainingDays
// ---------------------------------------------------------------------------

func TestRemainingDays(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		current  float64
		eol      float64
		rate     float64
		wantDays float64
		wantOK   bool
	}{
		{"healthy battery", 90, 70, 0.02, 1000, true},
		{"already below eol -> negative, ok", 68, 70, 0.02, -100, true},
		{"zero rate -> indeterminate", 90, 70, 0, 0, false},
		{"negative rate -> indeterminate", 90, 70, -0.01, 0, false},
		{"NaN rate -> indeterminate", 90, 70, math.NaN(), 0, false},
		{"tiny rate capped at horizon", 100, 0, 1e-9, maxProjectionDays, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			gotDays, gotOK := RemainingDays(tc.current, tc.eol, tc.rate)
			if gotOK != tc.wantOK {
				t.Fatalf("ok = %v, want %v", gotOK, tc.wantOK)
			}
			if !approx(gotDays, tc.wantDays, 1e-6) {
				t.Errorf("days = %v, want %v", gotDays, tc.wantDays)
			}
			if math.IsNaN(gotDays) || math.IsInf(gotDays, 0) {
				t.Errorf("non-finite days: %v", gotDays)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// LifeRemainingPct
// ---------------------------------------------------------------------------

func TestLifeRemainingPct(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name   string
		health float64
		eol    float64
		want   float64
	}{
		{"fresh battery at 100 vs eol 70", 100, 70, 100},
		{"battery at eol", 70, 70, 0},
		{"battery midway", 85, 70, 50},
		{"below eol clamps to 0", 60, 70, 0},
		{"wear part eol 0 == health", 42, 0, 42},
		{"degenerate span guarded", 90, 100, 90},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := LifeRemainingPct(tc.health, tc.eol); !approx(got, tc.want, 1e-6) {
				t.Errorf("= %v, want %v", got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// ClassifyStatus — every documented branch
// ---------------------------------------------------------------------------

func TestClassifyStatus(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name          string
		belowEOL      bool
		hasProjection bool
		remainingDays float64
		lifePct       float64
		want          Status
	}{
		{"health at/below eol -> overdue", true, true, 500, 0, StatusOverdue},
		{"projection past due -> overdue", false, true, -3, 40, StatusOverdue},
		{"low life -> replace_soon", false, false, 0, 5, StatusReplaceSoon},
		{"near-term projection -> replace_soon", false, true, 12, 40, StatusReplaceSoon},
		{"quarter life -> watch", false, true, 200, 20, StatusWatch},
		{"ample life -> healthy", false, true, 900, 80, StatusHealthy},
		{"sparse data (no projection, ample) -> healthy", false, false, 0, 90, StatusHealthy},
		{"missing data cannot fake overdue", false, false, 0, 100, StatusHealthy},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := ClassifyStatus(tc.belowEOL, tc.hasProjection, tc.remainingDays, tc.lifePct); got != tc.want {
				t.Errorf("= %v, want %v", got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// KmPerDay
// ---------------------------------------------------------------------------

func TestKmPerDay(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		km      float64
		span    float64
		want    float64
	}{
		{"normal", 900, 30, 30},
		{"span floored at 1 day", 50, 0.2, 50},
		{"zero km", 0, 30, 0},
		{"negative km guarded", -5, 30, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := KmPerDay(tc.km, tc.span); !approx(got, tc.want, 1e-9) {
				t.Errorf("= %v, want %v", got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// BuildSoHSeries
// ---------------------------------------------------------------------------

func TestBuildSoHSeries(t *testing.T) {
	t.Parallel()
	base := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	rows := []DailyBattery{
		{Day: base, MaxEnergyWh: 67500, MaxSocPct: 90},               // usable 75000 -> SoH 100
		{Day: base.AddDate(0, 0, 10), MaxEnergyWh: 20000, MaxSocPct: 40}, // low SoC -> dropped
		{Day: base.AddDate(0, 0, 20), MaxEnergyWh: 66000, MaxSocPct: 90}, // usable 73333 -> SoH ~97.8
		{Day: base.AddDate(0, 0, 30), MaxEnergyWh: 0, MaxSocPct: 95},     // no energy -> dropped
	}
	got := BuildSoHSeries(rows, 75000)
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2 (low-SoC and zero-energy rows dropped)", len(got))
	}
	if !approx(got[0].X, 0, 1e-9) || !approx(got[1].X, 20, 1e-9) {
		t.Errorf("X = [%v %v], want [0 20] (days since first retained)", got[0].X, got[1].X)
	}
	if !approx(got[0].Y, 100, 1e-6) {
		t.Errorf("Y[0] = %v, want 100 (capped)", got[0].Y)
	}
	if !approx(got[1].Y, 97.78, 1e-2) {
		t.Errorf("Y[1] = %v, want ~97.78", got[1].Y)
	}

	if BuildSoHSeries(rows, 0) != nil {
		t.Error("non-positive nominal capacity must yield nil series")
	}
	if BuildSoHSeries(nil, 75000) != nil {
		t.Error("empty input must yield nil series")
	}
}

// ---------------------------------------------------------------------------
// BatteryRUL
// ---------------------------------------------------------------------------

func batteryCfg() ComponentConfig {
	eol := 70.0
	km := 300000.0
	return ComponentConfig{Component: "hv_battery", NominalLifeKm: &km, EOLThreshold: &eol}
}

func TestBatteryRUL_DecliningSeries(t *testing.T) {
	t.Parallel()
	// SoH from 100 to ~94 over 300 days: slope -0.02 %/day, tight fit.
	var series []Point
	for i := 0; i <= 300; i += 10 {
		series = append(series, Point{X: float64(i), Y: 100 - 0.02*float64(i)})
	}
	c, pi := BatteryRUL(batteryCfg(), "High-Voltage Battery", series, testNow)

	if c.Status != string(StatusHealthy) {
		t.Errorf("status = %q, want healthy", c.Status)
	}
	if !approx(c.HealthPct, 94, 0.1) {
		t.Errorf("health = %v, want ~94", c.HealthPct)
	}
	if c.WearRatePerDay <= 0 {
		t.Errorf("wear rate = %v, want > 0", c.WearRatePerDay)
	}
	if c.Confidence <= 0.9 {
		t.Errorf("confidence = %v, want high (>0.9)", c.Confidence)
	}
	if c.ProjectedEOLDate == nil {
		t.Fatal("projected EOL date must be set for a declining battery")
	}
	// (94 - 70) / 0.02 = 1200 days from current.
	if !approx(c.RemainingDays, 1200, 30) {
		t.Errorf("remaining_days = %v, want ~1200", c.RemainingDays)
	}
	if pi.eolHealth != 70 {
		t.Errorf("proj eol health = %v, want 70", pi.eolHealth)
	}
}

func TestBatteryRUL_EmptySeries(t *testing.T) {
	t.Parallel()
	c, pi := BatteryRUL(batteryCfg(), "High-Voltage Battery", nil, testNow)
	if c.Status != string(StatusHealthy) {
		t.Errorf("status = %q, want healthy (sparse data never fails)", c.Status)
	}
	if c.Confidence != 0 {
		t.Errorf("confidence = %v, want 0", c.Confidence)
	}
	if c.ProjectedEOLDate != nil {
		t.Errorf("projected date = %v, want nil", *c.ProjectedEOLDate)
	}
	if c.RemainingDays != maxProjectionDays {
		t.Errorf("remaining_days = %v, want sentinel %v", c.RemainingDays, maxProjectionDays)
	}
	if pi.confidence != 0 {
		t.Errorf("proj confidence = %v, want 0", pi.confidence)
	}
}

func TestBatteryRUL_FlatSeriesNoProjection(t *testing.T) {
	t.Parallel()
	series := []Point{{0, 96}, {30, 96}, {60, 96}, {90, 96}}
	c, _ := BatteryRUL(batteryCfg(), "High-Voltage Battery", series, testNow)
	if c.Status != string(StatusHealthy) {
		t.Errorf("status = %q, want healthy", c.Status)
	}
	if c.ProjectedEOLDate != nil {
		t.Errorf("flat trend must not project a date, got %v", *c.ProjectedEOLDate)
	}
	if c.WearRatePerDay != 0 {
		t.Errorf("wear rate = %v, want 0 for a flat series", c.WearRatePerDay)
	}
}

// ---------------------------------------------------------------------------
// WearRUL
// ---------------------------------------------------------------------------

func wearCfg(nominalKm float64) ComponentConfig {
	return ComponentConfig{Component: "tires", NominalLifeKm: &nominalKm}
}

func TestWearRUL(t *testing.T) {
	t.Parallel()

	t.Run("replace_soon near end of tread life", func(t *testing.T) {
		t.Parallel()
		c, pi := WearRUL(wearCfg(50000), "Tires", 46000, 50, 45, testNow)
		if c.Status != string(StatusReplaceSoon) {
			t.Errorf("status = %q, want replace_soon (8%% life left)", c.Status)
		}
		if c.RemainingKm == nil || !approx(*c.RemainingKm, 4000, 1e-6) {
			t.Errorf("remaining_km = %v, want 4000", c.RemainingKm)
		}
		if !approx(c.RemainingDays, 80, 1) { // 4000 km / 50 km/day
			t.Errorf("remaining_days = %v, want ~80", c.RemainingDays)
		}
		if c.Confidence != 1 {
			t.Errorf("confidence = %v, want 1 (45 >= adequate drives)", c.Confidence)
		}
		if pi.eolHealth != 0 {
			t.Errorf("proj eol health = %v, want 0", pi.eolHealth)
		}
	})

	t.Run("overdue past nominal km", func(t *testing.T) {
		t.Parallel()
		c, _ := WearRUL(wearCfg(50000), "Tires", 55000, 40, 50, testNow)
		if c.Status != string(StatusOverdue) {
			t.Errorf("status = %q, want overdue", c.Status)
		}
		if c.RemainingKm == nil || *c.RemainingKm != 0 {
			t.Errorf("remaining_km = %v, want 0 (clamped)", c.RemainingKm)
		}
		if c.ProjectedEOLDate != nil {
			t.Errorf("overdue part must not project a future date, got %v", *c.ProjectedEOLDate)
		}
	})

	t.Run("healthy with plenty of tread", func(t *testing.T) {
		t.Parallel()
		c, _ := WearRUL(wearCfg(150000), "Brakes", 40000, 50, 45, testNow)
		if c.Status != string(StatusHealthy) {
			t.Errorf("status = %q, want healthy", c.Status)
		}
	})

	t.Run("no nominal configured -> healthy zero-confidence", func(t *testing.T) {
		t.Parallel()
		c, _ := WearRUL(ComponentConfig{Component: "tires"}, "Tires", 40000, 50, 45, testNow)
		if c.Status != string(StatusHealthy) || c.Confidence != 0 {
			t.Errorf("got status=%q confidence=%v, want healthy/0", c.Status, c.Confidence)
		}
		if c.HealthPct != 100 {
			t.Errorf("health = %v, want 100", c.HealthPct)
		}
	})

	t.Run("no measurable driving -> no projection, never NaN", func(t *testing.T) {
		t.Parallel()
		c, _ := WearRUL(wearCfg(50000), "Tires", 10000, 0, 0, testNow)
		if c.ProjectedEOLDate != nil {
			t.Errorf("zero km/day must not project, got %v", *c.ProjectedEOLDate)
		}
		if math.IsNaN(c.RemainingDays) || math.IsInf(c.RemainingDays, 0) {
			t.Errorf("remaining_days not finite: %v", c.RemainingDays)
		}
	})
}

// ---------------------------------------------------------------------------
// AgeRUL
// ---------------------------------------------------------------------------

func ageCfg(days int) ComponentConfig {
	return ComponentConfig{Component: "cabin_filter", NominalLifeDays: &days}
}

func TestAgeRUL(t *testing.T) {
	t.Parallel()

	t.Run("watch near end of calendar life", func(t *testing.T) {
		t.Parallel()
		c, pi := AgeRUL(ageCfg(365), "Cabin Air Filter", 300, testNow)
		if c.Status != string(StatusWatch) {
			t.Errorf("status = %q, want watch (~17.8%% life)", c.Status)
		}
		if !approx(c.RemainingDays, 65, 1) {
			t.Errorf("remaining_days = %v, want ~65", c.RemainingDays)
		}
		if c.Confidence != round2(ageConfidenceCap) {
			t.Errorf("confidence = %v, want capped %v", c.Confidence, ageConfidenceCap)
		}
		if c.ProjectedEOLDate == nil {
			t.Error("expected a projected date")
		}
		if pi.wearRatePerDay <= 0 {
			t.Errorf("proj wear rate = %v, want > 0", pi.wearRatePerDay)
		}
	})

	t.Run("overdue past calendar life", func(t *testing.T) {
		t.Parallel()
		c, _ := AgeRUL(ageCfg(365), "Cabin Air Filter", 400, testNow)
		if c.Status != string(StatusOverdue) {
			t.Errorf("status = %q, want overdue", c.Status)
		}
		if c.RemainingDays != 0 {
			t.Errorf("remaining_days = %v, want 0", c.RemainingDays)
		}
		if c.ProjectedEOLDate != nil {
			t.Errorf("overdue must not project a date, got %v", *c.ProjectedEOLDate)
		}
	})

	t.Run("fresh part is healthy", func(t *testing.T) {
		t.Parallel()
		c, _ := AgeRUL(ageCfg(1460), "12V Battery", 100, testNow)
		if c.Status != string(StatusHealthy) {
			t.Errorf("status = %q, want healthy", c.Status)
		}
	})

	t.Run("no nominal configured -> healthy zero-confidence", func(t *testing.T) {
		t.Parallel()
		c, _ := AgeRUL(ComponentConfig{Component: "cabin_filter"}, "Cabin Air Filter", 100, testNow)
		if c.Status != string(StatusHealthy) || c.Confidence != 0 || c.HealthPct != 100 {
			t.Errorf("got status=%q confidence=%v health=%v, want healthy/0/100", c.Status, c.Confidence, c.HealthPct)
		}
	})

	t.Run("negative age clamped", func(t *testing.T) {
		t.Parallel()
		c, _ := AgeRUL(ageCfg(365), "Cabin Air Filter", -20, testNow)
		if c.HealthPct != 100 {
			t.Errorf("health = %v, want 100 for a not-yet-aged part", c.HealthPct)
		}
	})
}

// ---------------------------------------------------------------------------
// NextServiceDue
// ---------------------------------------------------------------------------

func TestNextServiceDue(t *testing.T) {
	t.Parallel()
	mk := func(name, date string) ComponentRUL {
		d := date
		return ComponentRUL{Component: name, ProjectedEOLDate: &d}
	}

	t.Run("picks earliest date", func(t *testing.T) {
		t.Parallel()
		comps := []ComponentRUL{
			mk("brakes", "2030-01-01"),
			mk("cabin_filter", "2024-08-01"),
			mk("hv_battery", "2026-05-05"),
		}
		got := NextServiceDue(comps)
		if got == nil || got.Component != "cabin_filter" {
			t.Fatalf("= %+v, want cabin_filter", got)
		}
		if got.Date == nil || *got.Date != "2024-08-01" {
			t.Errorf("date = %v, want 2024-08-01", got.Date)
		}
	})

	t.Run("skips components without a date", func(t *testing.T) {
		t.Parallel()
		comps := []ComponentRUL{
			{Component: "hv_battery"}, // no date (overdue/flat)
			mk("tires", "2025-03-03"),
		}
		got := NextServiceDue(comps)
		if got == nil || got.Component != "tires" {
			t.Fatalf("= %+v, want tires", got)
		}
	})

	t.Run("nil when nothing projectable", func(t *testing.T) {
		t.Parallel()
		if got := NextServiceDue([]ComponentRUL{{Component: "a"}, {Component: "b"}}); got != nil {
			t.Errorf("= %+v, want nil", got)
		}
	})
}

// ---------------------------------------------------------------------------
// ProjectHealthSeries
// ---------------------------------------------------------------------------

func TestProjectHealthSeries_DecayAndBand(t *testing.T) {
	t.Parallel()
	// current 90, 0.1 %/day toward eol 70, horizon 200 days, confidence 0.8.
	got := ProjectHealthSeries(testNow, 90, 0.1, 70, 200, 0.8, 4)
	if len(got) != 5 {
		t.Fatalf("len = %d, want steps+1 = 5", len(got))
	}
	if got[0].Date != "2024-06-01" {
		t.Errorf("first date = %q, want today", got[0].Date)
	}
	if !approx(got[0].ProjectedHealth, 90, 1e-6) {
		t.Errorf("first health = %v, want 90", got[0].ProjectedHealth)
	}
	if !approx(got[4].ProjectedHealth, 70, 1e-6) {
		t.Errorf("last health = %v, want 70 (eol)", got[4].ProjectedHealth)
	}
	// Band is zero at t0 and widens; at horizon = (90-70)*0.35*(1-0.8) = 1.4.
	if got[0].ConfidenceLow != got[0].ProjectedHealth || got[0].ConfidenceHigh != got[0].ProjectedHealth {
		t.Errorf("band at t0 must be zero-width: %+v", got[0])
	}
	if !approx(got[4].ConfidenceLow, 68.6, 1e-1) || !approx(got[4].ConfidenceHigh, 71.4, 1e-1) {
		t.Errorf("horizon band = [%v %v], want ~[68.6 71.4]", got[4].ConfidenceLow, got[4].ConfidenceHigh)
	}
	// Monotonic non-increasing health, all finite.
	for i := 1; i < len(got); i++ {
		if got[i].ProjectedHealth > got[i-1].ProjectedHealth+1e-9 {
			t.Errorf("health not monotonic at %d: %v > %v", i, got[i].ProjectedHealth, got[i-1].ProjectedHealth)
		}
		if math.IsNaN(got[i].ProjectedHealth) || math.IsInf(got[i].ProjectedHealth, 0) {
			t.Errorf("non-finite health at %d", i)
		}
	}
}

func TestProjectHealthSeries_FlatHorizonFallback(t *testing.T) {
	t.Parallel()
	// Indeterminate horizon (<=0) falls back to a flat default-horizon curve.
	got := ProjectHealthSeries(testNow, 95, 0, 70, 0, 0.0, 4)
	if len(got) != 5 {
		t.Fatalf("len = %d, want 5", len(got))
	}
	for i, p := range got {
		if !approx(p.ProjectedHealth, 95, 1e-6) {
			t.Errorf("point %d health = %v, want flat 95", i, p.ProjectedHealth)
		}
	}
	// Under zero confidence the band widens to its max fraction at the horizon.
	last := got[len(got)-1]
	if last.ConfidenceHigh <= last.ProjectedHealth {
		t.Errorf("expected a widening band under low confidence, got %+v", last)
	}
}

func TestProjectHealthSeries_StepGuard(t *testing.T) {
	t.Parallel()
	if got := ProjectHealthSeries(testNow, 90, 0.1, 70, 100, 0.5, 0); len(got) != 2 {
		t.Errorf("steps<1 must floor to 1 segment (2 points), got %d", len(got))
	}
}
