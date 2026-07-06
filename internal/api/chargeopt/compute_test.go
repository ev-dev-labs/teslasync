package chargeopt

import (
	"math"
	"reflect"
	"testing"
	"time"
)

// at builds a UTC timestamp on the given calendar day at hour h.
func at(y int, mo time.Month, d, h int) time.Time {
	return time.Date(y, mo, d, h, 0, 0, 0, time.UTC)
}

// approx reports whether a and b are within eps. Outputs are rounded to
// 2–3 decimals, so a small epsilon absorbs float representation noise
// (e.g. 0.15 is not exactly representable).
func approx(a, b, eps float64) bool { return math.Abs(a-b) <= eps }

const eps = 1e-6

func TestRound2(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   float64
		want float64
	}{
		{"already_two_dp", 1.23, 1.23},
		{"round_down", 1.2345, 1.23},
		{"round_half_up", 1.235, 1.24},
		{"round_up", 1.239, 1.24},
		{"zero", 0, 0},
		{"negative_half", -1.235, -1.24},
		{"large", 1234.5678, 1234.57},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := round2(c.in); !approx(got, c.want, eps) {
				t.Errorf("round2(%v) = %v, want %v", c.in, got, c.want)
			}
		})
	}
}

func TestRound3(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		in   float64
		want float64
	}{
		{"already_three_dp", 0.123, 0.123},
		{"round_down", 0.12344, 0.123},
		{"round_half_up", 0.1235, 0.124},
		{"zero", 0, 0},
		{"negative", -0.1235, -0.124},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := round3(c.in); !approx(got, c.want, eps) {
				t.Errorf("round3(%v) = %v, want %v", c.in, got, c.want)
			}
		})
	}
}

func TestAnalyzeSchedule(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		sessions []sessionRow
		want     currentSchedule
	}{
		{
			name:     "empty_defaults",
			sessions: nil,
			want: currentSchedule{
				MostCommonStartHour: 0,
				MostCommonDay:       "weekday",
				AvgSessionsPerWeek:  0,
				AvgChargeToPct:      0,
			},
		},
		{
			name: "single_weekday_session",
			sessions: []sessionRow{
				{startDate: at(2026, time.June, 3, 14), endBattery: 80}, // Wed
			},
			want: currentSchedule{
				MostCommonStartHour: 14,
				MostCommonDay:       "weekday",
				AvgSessionsPerWeek:  1, // weeks clamped to 1
				AvgChargeToPct:      80,
			},
		},
		{
			// index 0 is newest (SQL returns DESC). Span is exactly 14
			// days -> weeks = 2. Hour 23 is the unique modal start hour.
			// Weekend sessions (3) outnumber weekday (1). The endBattery=0
			// session is excluded from the average charge-to.
			name: "weekend_majority_two_week_span",
			sessions: []sessionRow{
				{startDate: at(2026, time.June, 7, 23), endBattery: 90}, // Sun
				{startDate: at(2026, time.June, 6, 23), endBattery: 80}, // Sat
				{startDate: at(2026, time.June, 3, 8), endBattery: 0},   // Wed, excluded from avg
				{startDate: at(2026, time.May, 24, 23), endBattery: 70}, // Sun (14d before newest)
			},
			want: currentSchedule{
				MostCommonStartHour: 23,
				MostCommonDay:       "weekend",
				AvgSessionsPerWeek:  2,  // 4 sessions / 2 weeks
				AvgChargeToPct:      80, // (90+80+70)/3
			},
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := analyzeSchedule(c.sessions)
			if got.MostCommonStartHour != c.want.MostCommonStartHour {
				t.Errorf("MostCommonStartHour = %d, want %d", got.MostCommonStartHour, c.want.MostCommonStartHour)
			}
			if got.MostCommonDay != c.want.MostCommonDay {
				t.Errorf("MostCommonDay = %q, want %q", got.MostCommonDay, c.want.MostCommonDay)
			}
			if !approx(got.AvgSessionsPerWeek, c.want.AvgSessionsPerWeek, eps) {
				t.Errorf("AvgSessionsPerWeek = %v, want %v", got.AvgSessionsPerWeek, c.want.AvgSessionsPerWeek)
			}
			if !approx(got.AvgChargeToPct, c.want.AvgChargeToPct, eps) {
				t.Errorf("AvgChargeToPct = %v, want %v", got.AvgChargeToPct, c.want.AvgChargeToPct)
			}
		})
	}
}

func TestDetectHome(t *testing.T) {
	t.Parallel()

	home := func(lat, lon float64) sessionRow { return sessionRow{lat: lat, lon: lon} }

	cases := []struct {
		name      string
		sessions  []sessionRow
		wantCount int
		wantPct   float64
	}{
		{"empty", nil, 0, 0},
		{
			name:      "all_zero_coords_ignored",
			sessions:  []sessionRow{home(0, 0), home(0, 0)},
			wantCount: 0,
			wantPct:   0,
		},
		{
			// Three points inside a ~100 m cluster + one far outlier.
			name: "clustered_majority",
			sessions: []sessionRow{
				home(37.7749, -122.4194),
				home(37.7750, -122.4195),
				home(37.7748, -122.4193),
				home(40.0000, -70.0000),
			},
			wantCount: 3,
			wantPct:   75, // 3 / 4 total
		},
		{
			// Home percentage divides by TOTAL sessions, including the
			// two with no coordinates — so two clustered home sessions out
			// of four total is 50%, not 100%.
			name: "pct_diluted_by_missing_coords",
			sessions: []sessionRow{
				home(37.7749, -122.4194),
				home(37.7750, -122.4195),
				home(0, 0),
				home(0, 0),
			},
			wantCount: 2,
			wantPct:   50,
		},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			gotCount, gotPct := detectHome(c.sessions)
			if gotCount != c.wantCount {
				t.Errorf("homeCount = %d, want %d", gotCount, c.wantCount)
			}
			if !approx(gotPct, c.wantPct, eps) {
				t.Errorf("homePct = %v, want %v", gotPct, c.wantPct)
			}
		})
	}
}

func TestAnalyzeCosts_Empty(t *testing.T) {
	t.Parallel()
	heatmap, ca := analyzeCosts(nil, 0)
	if heatmap == nil {
		t.Fatal("heatmap = nil, want non-nil empty slice")
	}
	if len(heatmap) != 0 {
		t.Errorf("len(heatmap) = %d, want 0", len(heatmap))
	}
	if ca.PeakHours == nil || ca.OffpeakHours == nil {
		t.Fatalf("peak/offpeak hours must be non-nil empty slices, got %+v", ca)
	}
	if len(ca.PeakHours) != 0 || len(ca.OffpeakHours) != 0 {
		t.Errorf("expected empty peak/offpeak, got peak=%v offpeak=%v", ca.PeakHours, ca.OffpeakHours)
	}
	if ca.PeakCostPerKWh != 0 || ca.OffpeakCostPerKWh != 0 || ca.SessionsDuringPeakPct != 0 || ca.PotentialMonthlySavings != 0 {
		t.Errorf("expected all-zero cost analysis, got %+v", ca)
	}
}

func TestAnalyzeCosts_SingleHour(t *testing.T) {
	t.Parallel()
	// One session: cost 5 over 10 kWh -> 0.5 $/kWh. With a single hour the
	// off/peak split collapses onto the same hour (offCut clamps to 1).
	sessions := []sessionRow{
		{startDate: at(2026, time.June, 3, 22), cost: 5, kwh: 10},
	}
	heatmap, ca := analyzeCosts(sessions, 0)

	if len(heatmap) != 1 {
		t.Fatalf("len(heatmap) = %d, want 1", len(heatmap))
	}
	if !approx(heatmap[0].AvgCostPerKWh, 0.5, eps) {
		t.Errorf("heatmap avg cost/kWh = %v, want 0.5", heatmap[0].AvgCostPerKWh)
	}
	if heatmap[0].Hour != 22 || heatmap[0].Sessions != 1 {
		t.Errorf("heatmap entry = %+v, want hour 22 / 1 session", heatmap[0])
	}
	if len(ca.PeakHours) != 1 || ca.PeakHours[0] != 22 {
		t.Errorf("PeakHours = %v, want [22]", ca.PeakHours)
	}
	if len(ca.OffpeakHours) != 1 || ca.OffpeakHours[0] != 22 {
		t.Errorf("OffpeakHours = %v, want [22]", ca.OffpeakHours)
	}
	if !approx(ca.SessionsDuringPeakPct, 100, eps) {
		t.Errorf("SessionsDuringPeakPct = %v, want 100", ca.SessionsDuringPeakPct)
	}
	// peakCPK == offpeakCPK so there is nothing to save.
	if !approx(ca.PotentialMonthlySavings, 0, eps) {
		t.Errorf("PotentialMonthlySavings = %v, want 0", ca.PotentialMonthlySavings)
	}
}

func TestAnalyzeCosts_PeakOffpeakSplit(t *testing.T) {
	t.Parallel()
	// Six hours on the same day, each 10 kWh, cost = hour+1 so the cost
	// per kWh rises monotonically 0.1 -> 0.6. offCut = 6/3 = 2 so the two
	// cheapest hours (0,1) are off-peak and the two dearest (4,5) peak.
	var sessions []sessionRow
	for h := 0; h < 6; h++ {
		sessions = append(sessions, sessionRow{
			startDate: at(2026, time.June, 3, h),
			cost:      float64(h + 1),
			kwh:       10,
		})
	}
	heatmap, ca := analyzeCosts(sessions, 0)

	// Heatmap sorted by (day, hour); all same weekday so hours 0..5 ascend.
	if len(heatmap) != 6 {
		t.Fatalf("len(heatmap) = %d, want 6", len(heatmap))
	}
	for i, e := range heatmap {
		if e.Hour != i {
			t.Errorf("heatmap[%d].Hour = %d, want %d (must be hour-sorted)", i, e.Hour, i)
		}
	}

	if !reflect.DeepEqual(ca.OffpeakHours, []int{0, 1}) {
		t.Errorf("OffpeakHours = %v, want [0 1]", ca.OffpeakHours)
	}
	if !reflect.DeepEqual(ca.PeakHours, []int{4, 5}) {
		t.Errorf("PeakHours = %v, want [4 5]", ca.PeakHours)
	}
	if !approx(ca.OffpeakCostPerKWh, 0.15, eps) {
		t.Errorf("OffpeakCostPerKWh = %v, want 0.15", ca.OffpeakCostPerKWh)
	}
	if !approx(ca.PeakCostPerKWh, 0.55, eps) {
		t.Errorf("PeakCostPerKWh = %v, want 0.55", ca.PeakCostPerKWh)
	}
	if !approx(ca.SessionsDuringPeakPct, 33.33, 0.01) {
		t.Errorf("SessionsDuringPeakPct = %v, want ~33.33", ca.SessionsDuringPeakPct)
	}
	// 60 kWh/month * 0.3333 peak fraction * (0.55-0.15) delta = 8.0.
	if !approx(ca.PotentialMonthlySavings, 8, 0.01) {
		t.Errorf("PotentialMonthlySavings = %v, want ~8", ca.PotentialMonthlySavings)
	}
}

func TestComputeBatteryHealthScore(t *testing.T) {
	t.Parallel()

	// build makes n identical sessions with the given knobs.
	build := func(n int, endBattery int, power, temp float64) []sessionRow {
		out := make([]sessionRow, 0, n)
		for i := 0; i < n; i++ {
			out = append(out, sessionRow{endBattery: endBattery, power: power, outsideTemp: temp})
		}
		return out
	}
	// mix concatenates two cohorts to hit fractional percentages.
	mix := func(a, b []sessionRow) []sessionRow { return append(append([]sessionRow{}, a...), b...) }

	cases := []struct {
		name     string
		sessions []sessionRow
		want     int
	}{
		{"empty_is_perfect", nil, 100},
		// power 11 => home style (<=22); 100% home adds +5 but clamps at 100.
		{"all_home_clamps_100", build(10, 70, 11, 20), 100},
		// 100% full charges (-25) with home bonus (+5) => 80.
		{"full_charges_heavy", build(10, 100, 11, 20), 80},
		// 100% DC fast (power 150, no home bonus) => -20 => 80.
		{"dc_fast_heavy", build(10, 70, 150, 20), 80},
		// 100% extreme temp (+home bonus) => -15 +5 => 90.
		{"extreme_temp_heavy", build(10, 70, 11, 45), 90},
		// power 30 isolates fullPct (no DC>50, not home<=22).
		{"full_30pct_tier", mix(build(3, 96, 30, 20), build(7, 70, 30, 20)), 85}, // >25 -> -15
		{"full_20pct_tier", mix(build(2, 96, 30, 20), build(8, 70, 30, 20)), 95}, // >10 -> -5
		{"full_10pct_no_penalty", mix(build(1, 96, 30, 20), build(9, 70, 30, 20)), 100},
		// extreme temp mid tiers, power 30, no full charges.
		{"extreme_20pct_tier", mix(build(2, 70, 30, 50), build(8, 70, 30, 20)), 92}, // >15 -> -8
		// DC mid tier: 30% power 60 (>50, no home) -> -10.
		{"dc_30pct_tier", mix(build(3, 70, 60, 20), build(7, 70, 30, 20)), 90},
		// Worst realistic stack: full + dc + extreme, no home bonus.
		{"worst_stack", build(10, 100, 150, -10), 40}, // 100-25-20-15
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := computeBatteryHealthScore(c.sessions)
			if got != c.want {
				t.Errorf("computeBatteryHealthScore = %d, want %d", got, c.want)
			}
			if got < 0 || got > 100 {
				t.Errorf("score %d out of [0,100]", got)
			}
		})
	}
}

// sessionsAt makes n sessions all starting at hour h with the given power.
func sessionsAt(n, h int, power float64) []sessionRow {
	out := make([]sessionRow, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, sessionRow{startDate: at(2026, time.June, 3, h), power: power})
	}
	return out
}

func TestBuildOptimizerRecommendations(t *testing.T) {
	t.Parallel()

	// nonMorningLowPower avoids triggering the precondition (C) and
	// battery (D) recs: half the sessions are in the 06–09 window (>=20%
	// morning) and all use low power (<=50, no DC fast). Used to isolate
	// the rec under test.
	nonMorningLowPower := func() []sessionRow {
		return append(sessionsAt(5, 8, 11), sessionsAt(5, 20, 11)...)
	}

	t.Run("no_signals_yields_general_excellent", func(t *testing.T) {
		t.Parallel()
		recs := buildOptimizerRecommendations(currentSchedule{}, costAnalysis{}, 100, nil)
		if len(recs) != 1 {
			t.Fatalf("len(recs) = %d, want 1", len(recs))
		}
		if recs[0].Type != "general" || recs[0].Priority != "low" {
			t.Errorf("rec = %+v, want type=general priority=low", recs[0])
		}
	})

	t.Run("schedule_rec_medium", func(t *testing.T) {
		t.Parallel()
		ca := costAnalysis{SessionsDuringPeakPct: 30, PotentialMonthlySavings: 10}
		recs := buildOptimizerRecommendations(currentSchedule{AvgChargeToPct: 50, HomeChargingPct: 80}, ca, 100, nonMorningLowPower())
		got := findRec(recs, "schedule")
		if got == nil {
			t.Fatalf("no schedule rec in %+v", recs)
		}
		if got.Priority != "medium" {
			t.Errorf("priority = %q, want medium", got.Priority)
		}
		if !approx(got.EstimatedSavings, 10, eps) {
			t.Errorf("EstimatedSavings = %v, want 10", got.EstimatedSavings)
		}
		if len(recs) != 1 {
			t.Errorf("expected only the schedule rec, got %d recs: %+v", len(recs), recs)
		}
	})

	t.Run("schedule_rec_high_when_savings_large", func(t *testing.T) {
		t.Parallel()
		ca := costAnalysis{SessionsDuringPeakPct: 30, PotentialMonthlySavings: 20}
		recs := buildOptimizerRecommendations(currentSchedule{AvgChargeToPct: 50, HomeChargingPct: 80}, ca, 100, nonMorningLowPower())
		got := findRec(recs, "schedule")
		if got == nil || got.Priority != "high" {
			t.Fatalf("want high-priority schedule rec, got %+v", recs)
		}
	})

	t.Run("limit_rec_when_charge_target_high", func(t *testing.T) {
		t.Parallel()
		recs := buildOptimizerRecommendations(currentSchedule{AvgChargeToPct: 95, HomeChargingPct: 80}, costAnalysis{}, 100, nonMorningLowPower())
		if findRec(recs, "limit") == nil {
			t.Fatalf("no limit rec in %+v", recs)
		}
	})

	t.Run("precondition_rec_when_few_morning", func(t *testing.T) {
		t.Parallel()
		// All sessions at 14:00 => 0% morning => precondition fires.
		recs := buildOptimizerRecommendations(currentSchedule{AvgChargeToPct: 50, HomeChargingPct: 80}, costAnalysis{}, 100, sessionsAt(6, 14, 11))
		got := findRec(recs, "precondition")
		if got == nil || got.Priority != "low" {
			t.Fatalf("want low-priority precondition rec, got %+v", recs)
		}
	})

	t.Run("battery_rec_when_dc_heavy", func(t *testing.T) {
		t.Parallel()
		// All power 150 (100% DC) but 30% morning so precondition stays off.
		sessions := append(sessionsAt(3, 8, 150), sessionsAt(7, 20, 150)...)
		recs := buildOptimizerRecommendations(currentSchedule{AvgChargeToPct: 50, HomeChargingPct: 80}, costAnalysis{}, 100, sessions)
		got := findRec(recs, "battery")
		if got == nil || got.Priority != "high" {
			t.Fatalf("want high-priority battery rec, got %+v", recs)
		}
	})

	t.Run("cost_rec_when_home_ratio_low", func(t *testing.T) {
		t.Parallel()
		recs := buildOptimizerRecommendations(currentSchedule{AvgChargeToPct: 50, HomeChargingPct: 30}, costAnalysis{}, 100, nonMorningLowPower())
		if findRec(recs, "cost") == nil {
			t.Fatalf("no cost rec in %+v", recs)
		}
	})

	t.Run("priority_sort_high_medium_low", func(t *testing.T) {
		t.Parallel()
		// A (schedule, high via savings 20) + B (limit, medium) + C
		// (precondition, low): all sessions at 14:00 (no morning) low power.
		ca := costAnalysis{SessionsDuringPeakPct: 30, PotentialMonthlySavings: 20}
		recs := buildOptimizerRecommendations(currentSchedule{AvgChargeToPct: 95, HomeChargingPct: 80}, ca, 100, sessionsAt(6, 14, 11))
		if len(recs) < 3 {
			t.Fatalf("want >=3 recs, got %+v", recs)
		}
		rank := map[string]int{"high": 0, "medium": 1, "low": 2}
		for i := 1; i < len(recs); i++ {
			if rank[recs[i-1].Priority] > rank[recs[i].Priority] {
				t.Errorf("recs not priority-sorted: [%d]=%s before [%d]=%s",
					i-1, recs[i-1].Priority, i, recs[i].Priority)
			}
		}
		for _, typ := range []string{"schedule", "limit", "precondition"} {
			if findRec(recs, typ) == nil {
				t.Errorf("missing %q rec in %+v", typ, recs)
			}
		}
	})
}

// findRec returns the first rec of the given type, or nil.
func findRec(recs []optimizerRec, typ string) *optimizerRec {
	for i := range recs {
		if recs[i].Type == typ {
			return &recs[i]
		}
	}
	return nil
}
