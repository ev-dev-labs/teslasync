package condition

import (
	"encoding/json"
	"testing"
	"time"
)

// ─── Config Parsing Tests ───────────────────────────────

func TestParseDayFilterConfig_Valid(t *testing.T) {
	raw := json.RawMessage(`{
		"type": "day_filter",
		"days": [1, 2, 3, 4, 5],
		"timezone": "America/Los_Angeles"
	}`)

	cfg, err := ParseDayFilterConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Type != "day_filter" {
		t.Fatalf("expected type 'day_filter', got %q", cfg.Type)
	}
	if len(cfg.Days) != 5 {
		t.Fatalf("expected 5 days, got %d", len(cfg.Days))
	}
	if cfg.Timezone != "America/Los_Angeles" {
		t.Fatalf("expected timezone 'America/Los_Angeles', got %q", cfg.Timezone)
	}
}

func TestParseDayFilterConfig_MinimalValid(t *testing.T) {
	raw := json.RawMessage(`{"days": [0]}`)
	cfg, err := ParseDayFilterConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Timezone != "" {
		t.Fatalf("expected empty timezone, got %q", cfg.Timezone)
	}
	if len(cfg.Days) != 1 || cfg.Days[0] != 0 {
		t.Fatalf("expected days=[0], got %v", cfg.Days)
	}
}

func TestParseDayFilterConfig_Errors(t *testing.T) {
	tests := []struct {
		name string
		json string
	}{
		{"empty", ""},
		{"invalid json", "{bad"},
		{"wrong type", `{"type": "other", "days": [1]}`},
		{"missing days", `{"type": "day_filter"}`},
		{"empty days", `{"days": []}`},
		{"day below range", `{"days": [-1]}`},
		{"day above range", `{"days": [7]}`},
		{"duplicate day", `{"days": [1, 3, 1]}`},
		{"invalid timezone", `{"days": [1], "timezone": "Mars/Olympus"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseDayFilterConfig(json.RawMessage(tt.json))
			if err == nil {
				t.Fatalf("expected error for %q, got nil", tt.name)
			}
		})
	}
}

// ─── Evaluation Tests ───────────────────────────────────

func TestEvaluateDayFilter_Weekdays(t *testing.T) {
	cfg := &DayFilterConfig{
		Type: "day_filter",
		Days: []int{1, 2, 3, 4, 5}, // Mon-Fri
	}

	tests := []struct {
		name    string
		date    time.Time // chosen for known weekday
		wantMet bool
	}{
		{"Monday", time.Date(2026, 4, 13, 12, 0, 0, 0, time.UTC), true},
		{"Tuesday", time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC), true},
		{"Wednesday", time.Date(2026, 4, 15, 12, 0, 0, 0, time.UTC), true},
		{"Thursday", time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC), true},
		{"Friday", time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC), true},
		{"Saturday", time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC), false},
		{"Sunday", time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, snapshot, err := EvaluateDayFilter(cfg, tt.date)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("EvaluateDayFilter on %s: got met=%v, want %v (reason: %s)",
					tt.name, result.Met, tt.wantMet, result.Reason)
			}
			if snapshot == nil {
				t.Fatal("expected non-nil snapshot")
			}
		})
	}
}

func TestEvaluateDayFilter_WeekendOnly(t *testing.T) {
	cfg := &DayFilterConfig{
		Days: []int{0, 6}, // Sun, Sat
	}

	tests := []struct {
		name    string
		date    time.Time
		wantMet bool
	}{
		{"Saturday", time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC), true},
		{"Sunday", time.Date(2026, 4, 19, 12, 0, 0, 0, time.UTC), true},
		{"Monday", time.Date(2026, 4, 13, 12, 0, 0, 0, time.UTC), false},
		{"Wednesday", time.Date(2026, 4, 15, 12, 0, 0, 0, time.UTC), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, _, err := EvaluateDayFilter(cfg, tt.date)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("on %s: got met=%v, want %v (reason: %s)",
					tt.name, result.Met, tt.wantMet, result.Reason)
			}
		})
	}
}

func TestEvaluateDayFilter_SingleDay(t *testing.T) {
	cfg := &DayFilterConfig{
		Days: []int{3}, // Wednesday only
	}

	// Wednesday 2026-04-15
	result, _, err := EvaluateDayFilter(cfg, time.Date(2026, 4, 15, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Errorf("expected met=true on Wednesday, got false: %s", result.Reason)
	}

	// Thursday 2026-04-16
	result, _, err = EvaluateDayFilter(cfg, time.Date(2026, 4, 16, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Met {
		t.Errorf("expected met=false on Thursday, got true: %s", result.Reason)
	}
}

func TestEvaluateDayFilter_WithTimezone(t *testing.T) {
	cfg := &DayFilterConfig{
		Days:     []int{5}, // Friday only
		Timezone: "America/Los_Angeles",
	}

	la, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("failed to load timezone: %v", err)
	}

	tests := []struct {
		name    string
		now     time.Time
		wantMet bool
	}{
		{
			"Friday noon LA time → allowed",
			time.Date(2026, 4, 17, 12, 0, 0, 0, la),
			true,
		},
		{
			"Saturday noon LA time → not allowed",
			time.Date(2026, 4, 18, 12, 0, 0, 0, la),
			false,
		},
		{
			// UTC Saturday 02:00 = LA Friday 19:00 (PDT -7) → Friday → allowed
			"UTC Saturday 02:00 = LA Friday 19:00 → allowed",
			time.Date(2026, 4, 18, 2, 0, 0, 0, time.UTC),
			true,
		},
		{
			// UTC Saturday 10:00 = LA Saturday 03:00 (PDT -7) → Saturday → not allowed
			"UTC Saturday 10:00 = LA Saturday 03:00 → not allowed",
			time.Date(2026, 4, 18, 10, 0, 0, 0, time.UTC),
			false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, _, err := EvaluateDayFilter(cfg, tt.now)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("got met=%v, want %v (reason: %s)", result.Met, tt.wantMet, result.Reason)
			}
		})
	}
}

func TestEvaluateDayFilter_EmptyTimezoneDefaultsUTC(t *testing.T) {
	cfg := &DayFilterConfig{
		Days: []int{6}, // Saturday
	}

	// Saturday 2026-04-18 in UTC
	result, _, err := EvaluateDayFilter(cfg, time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Errorf("expected met=true for Saturday in UTC, got false: %s", result.Reason)
	}
}

func TestEvaluateDayFilter_SnapshotContent(t *testing.T) {
	cfg := &DayFilterConfig{
		Type:     "day_filter",
		Days:     []int{1, 2, 3, 4, 5},
		Timezone: "UTC",
	}

	// Tuesday 2026-04-14
	now := time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC)
	_, snapshot, err := EvaluateDayFilter(cfg, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var snap dayFilterSnapshot
	if err := json.Unmarshal(snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}

	if snap.CurrentDay != "Tuesday" {
		t.Errorf("expected current_day 'Tuesday', got %q", snap.CurrentDay)
	}
	if snap.DayNumber != 2 {
		t.Errorf("expected day_number 2, got %d", snap.DayNumber)
	}
	if snap.AllowedDays != "[Mon-Fri]" {
		t.Errorf("expected allowed_days '[Mon-Fri]', got %q", snap.AllowedDays)
	}
	if !snap.Met {
		t.Error("expected met=true in snapshot")
	}
	if snap.Timezone != "UTC" {
		t.Errorf("expected timezone 'UTC', got %q", snap.Timezone)
	}
}

func TestEvaluateDayFilter_ReasonStrings(t *testing.T) {
	cfg := &DayFilterConfig{
		Days: []int{1, 2, 3, 4, 5},
	}

	// Tuesday (allowed) — 2026-04-14
	result, _, _ := EvaluateDayFilter(cfg, time.Date(2026, 4, 14, 12, 0, 0, 0, time.UTC))
	if result.Reason != "Tuesday is in allowed days [Mon-Fri] (UTC)" {
		t.Errorf("unexpected inside reason: %q", result.Reason)
	}

	// Saturday (not allowed) — 2026-04-18
	result, _, _ = EvaluateDayFilter(cfg, time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC))
	if result.Reason != "Saturday is not in allowed days [Mon-Fri] (UTC)" {
		t.Errorf("unexpected outside reason: %q", result.Reason)
	}
}

func TestEvaluateDayFilter_AllDays(t *testing.T) {
	cfg := &DayFilterConfig{
		Days: []int{0, 1, 2, 3, 4, 5, 6},
	}

	// Every day of the week should match.
	for d := 13; d <= 19; d++ {
		now := time.Date(2026, 4, d, 12, 0, 0, 0, time.UTC)
		result, _, err := EvaluateDayFilter(cfg, now)
		if err != nil {
			t.Fatalf("unexpected error on day %d: %v", d, err)
		}
		if !result.Met {
			t.Errorf("expected met=true on %s, got false: %s",
				now.Weekday().String(), result.Reason)
		}
	}
}

// ─── formatDayList Tests ────────────────────────────────

func TestFormatDayList(t *testing.T) {
	tests := []struct {
		name string
		days []int
		want string
	}{
		{"empty", []int{}, "[]"},
		{"single day", []int{3}, "[Wed]"},
		{"weekdays", []int{1, 2, 3, 4, 5}, "[Mon-Fri]"},
		{"weekend", []int{0, 6}, "[Sun, Sat]"},
		{"all days", []int{0, 1, 2, 3, 4, 5, 6}, "[Sun-Sat]"},
		{"non-consecutive", []int{1, 3, 5}, "[Mon, Wed, Fri]"},
		{"mixed runs", []int{0, 1, 2, 5, 6}, "[Sun-Tue, Fri-Sat]"},
		{"pair", []int{2, 3}, "[Tue-Wed]"},
		{"unsorted input", []int{5, 1, 3}, "[Mon, Wed, Fri]"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatDayList(tt.days)
			if got != tt.want {
				t.Errorf("formatDayList(%v) = %q, want %q", tt.days, got, tt.want)
			}
		})
	}
}

// ─── sortDays Tests ─────────────────────────────────────

func TestSortDays(t *testing.T) {
	tests := []struct {
		name string
		in   []int
		want []int
	}{
		{"already sorted", []int{0, 1, 2}, []int{0, 1, 2}},
		{"reverse", []int{6, 5, 4}, []int{4, 5, 6}},
		{"mixed", []int{3, 0, 6, 1}, []int{0, 1, 3, 6}},
		{"single", []int{4}, []int{4}},
		{"empty", []int{}, []int{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := make([]int, len(tt.in))
			copy(got, tt.in)
			sortDays(got)
			for i := range got {
				if got[i] != tt.want[i] {
					t.Errorf("sortDays(%v) = %v, want %v", tt.in, got, tt.want)
					break
				}
			}
		})
	}
}
