package tou

import (
	"encoding/json"
	"testing"
	"time"
)

func TestSeasonForDateGoldens(t *testing.T) {
	for _, id := range []string{"pge-ev2a", "sce-tou-d", "sdge-tou-dr1"} {
		plan, ok := GetPlan(id)
		if !ok {
			t.Fatalf("missing plan %s", id)
		}
		for _, tc := range []struct {
			month int
			want  string
		}{
			{1, "Winter"}, {5, "Winter"}, {6, "Summer"}, {9, "Summer"},
			{10, "Winter"}, {12, "Winter"},
		} {
			got := SeasonForDate(plan, time.Date(2024, time.Month(tc.month), 29, 12, 0, 0, 0, time.UTC))
			if got != tc.want {
				t.Errorf("%s month %d: got season %q, want %q", id, tc.month, got, tc.want)
			}
		}
	}
}

func TestHourlyRateGoldens(t *testing.T) {
	tests := []struct {
		id    string
		hour  int
		tier  string
		cents float64
	}{
		{"pge-ev2a", 15, "OFF_PEAK", 35},
		{"pge-ev2a", 16, "ON_PEAK", 49},
		{"pge-ev2a", 21, "OFF_PEAK", 35},
		{"sce-tou-d", 0, "OFF_PEAK", 28},
		{"sce-tou-d", 8, "MID_PEAK", 41},
		{"sce-tou-d", 23, "OFF_PEAK", 28},
		{"sdge-tou-dr1", 16, "ON_PEAK", 71},
		{"sdge-tou-dr1", 21, "OFF_PEAK", 45},
	}
	for _, tc := range tests {
		plan, _ := GetPlan(tc.id)
		seasonName := SeasonForDate(plan, time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC))
		rates := BuildHourlyRates(plan.Seasons[seasonName])
		got := rates[tc.hour]
		if got.Tier != tc.tier || got.RateCents != tc.cents {
			t.Errorf("%s summer hour %d: got %+v, want tier=%s cents=%.0f", tc.id, tc.hour, got, tc.tier, tc.cents)
		}
	}
}

func TestParseClockGoldens(t *testing.T) {
	for _, value := range []string{"07:30", "00:00", "23:59"} {
		if _, _, err := ParseClock(value); err != nil {
			t.Errorf("ParseClock(%q): %v", value, err)
		}
	}
	for _, value := range []string{"7:30", "07:3", "24:00", "12:60", "07:30:00", " 07:30", "07-30"} {
		if _, _, err := ParseClock(value); err == nil {
			t.Errorf("ParseClock(%q) unexpectedly accepted", value)
		}
	}
}

func TestNextClockTimeDST(t *testing.T) {
	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Skipf("timezone database unavailable: %v", err)
	}
	spring := time.Date(2026, 3, 8, 6, 0, 0, 0, location)
	next, err := NextClockTime("07:30", spring)
	if err != nil {
		t.Fatal(err)
	}
	if next.Hour() != 7 || next.Minute() != 30 || next.Day() != 8 {
		t.Fatalf("spring next = %v, want 07:30 next wall-clock occurrence", next)
	}

	fall := time.Date(2026, 11, 1, 1, 0, 0, 0, location)
	next, err = NextClockTime("07:30", fall)
	if err != nil {
		t.Fatal(err)
	}
	if next.Hour() != 7 || next.Minute() != 30 || next.Day() != 1 {
		t.Fatalf("fall next = %v, want 07:30 wall time", next)
	}
}

func TestFindWindowGoldensDSTAndWrap(t *testing.T) {
	location, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Skipf("timezone database unavailable: %v", err)
	}
	tests := []struct {
		name     string
		now      time.Time
		deadline time.Time
	}{
		{
			name:     "DST start",
			now:      time.Date(2026, 3, 8, 0, 0, 0, 0, location),
			deadline: time.Date(2026, 3, 8, 8, 0, 0, 0, location),
		},
		{
			name:     "DST end",
			now:      time.Date(2026, 11, 1, 0, 0, 0, 0, location),
			deadline: time.Date(2026, 11, 1, 8, 0, 0, 0, location),
		},
		{
			name:     "summer rollover",
			now:      time.Date(2026, 7, 15, 18, 0, 0, 0, location),
			deadline: time.Date(2026, 7, 16, 7, 30, 0, 0, location),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := FindWindow(WindowInput{
				PlanID: "pge-ev2a", CurrentSOC: 40, TargetSOC: 80,
				Now: tc.now, Deadline: tc.deadline,
				BatteryCapacityKWh: 75, ChargerVoltage: 240, MaxAmps: 32,
			})
			if err != nil {
				t.Fatal(err)
			}
			if len(got.HourlyRates) != 24 {
				t.Fatalf("hourly rates len = %d, want 24", len(got.HourlyRates))
			}
			if got.Best.StartHour < 0 || got.Best.StartHour > 23 {
				t.Fatalf("invalid start hour %d", got.Best.StartHour)
			}
			if got.KWhNeeded <= 0 || got.DurationHours <= 0 {
				t.Fatalf("invalid energy/duration: %+v", got)
			}
			if got.DurationCeil <= 0 {
				t.Fatalf("duration ceil = %d, want positive", got.DurationCeil)
			}
		})
	}
}

func TestCostAndEqualCostTie(t *testing.T) {
	rates := make([]HourlyRate, 24)
	for i := range rates {
		rates[i] = HourlyRate{Hour: i, RateCents: 35, Tier: "OFF_PEAK"}
	}
	cost, avg := CostForWindow(rates, 23, 3, 30)
	if avg != 35 {
		t.Fatalf("avg cents = %.2f, want 35", avg)
	}
	if cost != 10.5 {
		t.Fatalf("cost = %.4f, want 10.5000", cost)
	}

	location := time.FixedZone("UTC-offset", 0)
	now := time.Date(2026, 1, 15, 0, 0, 0, 0, location)
	deadline := time.Date(2026, 1, 15, 4, 0, 0, 0, location)
	got, err := FindWindow(WindowInput{
		PlanID: "pge-ev2a", CurrentSOC: 50, TargetSOC: 70,
		Now: now, Deadline: deadline, BatteryCapacityKWh: 75,
		ChargerVoltage: 240, MaxAmps: 80,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Best.StartHour != 0 {
		t.Fatalf("equal-cost tie chose hour %d, want earliest hour 0", got.Best.StartHour)
	}
}

func TestWindowErrorsAndFallbacks(t *testing.T) {
	now := time.Date(2026, 1, 15, 18, 0, 0, 0, time.UTC)
	if _, err := FindWindow(WindowInput{PlanID: "pge-ev2a", CurrentSOC: 80, TargetSOC: 80, Now: now}); err == nil {
		t.Fatal("expected already-at-target error")
	}
	if _, err := FindWindow(WindowInput{PlanID: "missing", CurrentSOC: 40, TargetSOC: 80, Now: now}); err == nil {
		t.Fatal("expected unknown plan error")
	}
	if _, err := FindWindow(WindowInput{
		PlanID: "pge-ev2a", CurrentSOC: 0, TargetSOC: 100,
		Now: now, Deadline: now.Add(time.Hour),
	}); err == nil {
		t.Fatal("expected not-enough-time error")
	}
	if _, err := FindWindow(WindowInput{
		PlanID: "pge-ev2a", CurrentSOC: 40, TargetSOC: 40,
		Now: now, Deadline: now.Add(8 * time.Hour),
	}); err == nil {
		t.Fatal("expected 0/target boundary already-at-target error")
	}
}

func TestFullAndZeroSOCFallbacks(t *testing.T) {
	now := time.Date(2026, 7, 15, 18, 0, 0, 0, time.UTC)
	deadline := now.Add(24 * time.Hour)
	for _, tc := range []struct {
		current int
		target  int
		wantKWh float64
	}{
		{0, 100, 75},
		{100, 100, 0},
		{40, 80, 30},
	} {
		got, err := FindWindow(WindowInput{
			PlanID: "pge-ev2a", CurrentSOC: tc.current, TargetSOC: tc.target,
			Now: now, Deadline: deadline, BatteryCapacityKWh: 75,
			ChargerVoltage: 240, MaxAmps: 32,
		})
		if tc.current >= tc.target {
			if err == nil {
				t.Fatalf("SOC %d/%d: expected already-at-target error", tc.current, tc.target)
			}
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if Round2(got.KWhNeeded) != tc.wantKWh {
			t.Fatalf("SOC %d/%d kWh = %.2f, want %.2f", tc.current, tc.target, got.KWhNeeded, tc.wantKWh)
		}
	}
}

func TestGoldensJSONShape(t *testing.T) {
	rates := BuildHourlyRates(Season{Tiers: map[string][]RateBlock{
		"OFF_PEAK": {{Rate: 0.35, Start: 0, End: 24}},
	}})
	raw, err := json.Marshal(rates[:1])
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != `[{"hour":0,"rate_cents":35,"tier":"OFF_PEAK"}]` {
		t.Fatalf("golden JSON = %s", raw)
	}
}
