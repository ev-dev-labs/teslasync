package condition

import (
	"encoding/json"
	"testing"
	"time"
)

// ─── Config Parsing Tests ───────────────────────────────

func TestParseTimeWindowConfig_Valid(t *testing.T) {
	raw := json.RawMessage(`{
		"type": "time_window",
		"start_time": "22:00",
		"end_time": "06:00",
		"timezone": "America/Los_Angeles"
	}`)

	cfg, err := ParseTimeWindowConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Type != "time_window" {
		t.Fatalf("expected type 'time_window', got %q", cfg.Type)
	}
	if cfg.StartTime != "22:00" {
		t.Fatalf("expected start_time '22:00', got %q", cfg.StartTime)
	}
	if cfg.EndTime != "06:00" {
		t.Fatalf("expected end_time '06:00', got %q", cfg.EndTime)
	}
	if cfg.Timezone != "America/Los_Angeles" {
		t.Fatalf("expected timezone 'America/Los_Angeles', got %q", cfg.Timezone)
	}
}

func TestParseTimeWindowConfig_MinimalValid(t *testing.T) {
	raw := json.RawMessage(`{"start_time": "09:00", "end_time": "17:00"}`)
	cfg, err := ParseTimeWindowConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Timezone != "" {
		t.Fatalf("expected empty timezone, got %q", cfg.Timezone)
	}
}

func TestParseTimeWindowConfig_Errors(t *testing.T) {
	tests := []struct {
		name string
		json string
	}{
		{"empty", ""},
		{"invalid json", "{bad"},
		{"missing start_time", `{"end_time": "06:00"}`},
		{"missing end_time", `{"start_time": "22:00"}`},
		{"wrong type", `{"type": "other", "start_time": "22:00", "end_time": "06:00"}`},
		{"equal times", `{"start_time": "12:00", "end_time": "12:00"}`},
		{"bad start format short", `{"start_time": "9:00", "end_time": "17:00"}`},
		{"bad start format no colon", `{"start_time": "0900", "end_time": "17:00"}`},
		{"bad end format", `{"start_time": "09:00", "end_time": "170"}`},
		{"hour out of range", `{"start_time": "24:00", "end_time": "06:00"}`},
		{"minute out of range", `{"start_time": "12:60", "end_time": "14:00"}`},
		{"invalid timezone", `{"start_time": "09:00", "end_time": "17:00", "timezone": "Mars/Olympus"}`},
		{"non-digit chars", `{"start_time": "AB:CD", "end_time": "12:00"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseTimeWindowConfig(json.RawMessage(tt.json))
			if err == nil {
				t.Fatalf("expected error for %q, got nil", tt.name)
			}
		})
	}
}

// ─── parseHHMM Tests ────────────────────────────────────

func TestParseHHMM(t *testing.T) {
	tests := []struct {
		input   string
		wantH   int
		wantM   int
		wantErr bool
	}{
		{"00:00", 0, 0, false},
		{"12:30", 12, 30, false},
		{"23:59", 23, 59, false},
		{"09:05", 9, 5, false},
		{"24:00", 0, 0, true},
		{"12:60", 0, 0, true},
		{"9:00", 0, 0, true},   // not zero-padded
		{"0900", 0, 0, true},   // no colon
		{"", 0, 0, true},       // empty
		{"AB:CD", 0, 0, true},  // non-digits
		{"12:3", 0, 0, true},   // short minute
		{"1:30", 0, 0, true},   // short hour
		{"12:30:00", 0, 0, true}, // too long
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			h, m, err := parseHHMM(tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("parseHHMM(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
			}
			if !tt.wantErr {
				if h != tt.wantH || m != tt.wantM {
					t.Fatalf("parseHHMM(%q) = (%d, %d), want (%d, %d)", tt.input, h, m, tt.wantH, tt.wantM)
				}
			}
		})
	}
}

// ─── Evaluation Tests ───────────────────────────────────

func TestEvaluateTimeWindow_SameDay(t *testing.T) {
	cfg := &TimeWindowConfig{
		Type:      "time_window",
		StartTime: "09:00",
		EndTime:   "17:00",
	}

	tests := []struct {
		name    string
		hour    int
		minute  int
		wantMet bool
	}{
		{"before window", 8, 0, false},
		{"at start", 9, 0, true},
		{"mid window", 12, 30, true},
		{"just before end", 16, 59, true},
		{"at end (exclusive)", 17, 0, false},
		{"after window", 20, 0, false},
		{"midnight", 0, 0, false},
		{"just before start", 8, 59, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			now := time.Date(2026, 4, 18, tt.hour, tt.minute, 0, 0, time.UTC)
			result, snapshot, err := EvaluateTimeWindow(cfg, now)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("EvaluateTimeWindow at %02d:%02d: got met=%v, want %v (reason: %s)",
					tt.hour, tt.minute, result.Met, tt.wantMet, result.Reason)
			}
			if snapshot == nil {
				t.Fatal("expected non-nil snapshot")
			}
		})
	}
}

func TestEvaluateTimeWindow_Overnight(t *testing.T) {
	cfg := &TimeWindowConfig{
		Type:      "time_window",
		StartTime: "22:00",
		EndTime:   "06:00",
	}

	tests := []struct {
		name    string
		hour    int
		minute  int
		wantMet bool
	}{
		{"before window daytime", 12, 0, false},
		{"just before start", 21, 59, false},
		{"at start", 22, 0, true},
		{"late evening", 23, 15, true},
		{"just before midnight", 23, 59, true},
		{"midnight", 0, 0, true},
		{"early morning", 3, 30, true},
		{"just before end", 5, 59, true},
		{"at end (exclusive)", 6, 0, false},
		{"after end morning", 7, 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			now := time.Date(2026, 4, 18, tt.hour, tt.minute, 0, 0, time.UTC)
			result, _, err := EvaluateTimeWindow(cfg, now)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("EvaluateTimeWindow at %02d:%02d: got met=%v, want %v (reason: %s)",
					tt.hour, tt.minute, result.Met, tt.wantMet, result.Reason)
			}
		})
	}
}

func TestEvaluateTimeWindow_WithTimezone(t *testing.T) {
	cfg := &TimeWindowConfig{
		Type:      "time_window",
		StartTime: "22:00",
		EndTime:   "06:00",
		Timezone:  "America/Los_Angeles",
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
			"23:15 LA time → inside overnight window",
			time.Date(2026, 4, 18, 23, 15, 0, 0, la),
			true,
		},
		{
			"03:00 LA time → inside overnight window",
			time.Date(2026, 4, 19, 3, 0, 0, 0, la),
			true,
		},
		{
			"12:00 LA time → outside window",
			time.Date(2026, 4, 18, 12, 0, 0, 0, la),
			false,
		},
		{
			"06:00 LA time → at end, exclusive",
			time.Date(2026, 4, 19, 6, 0, 0, 0, la),
			false,
		},
		{
			"UTC 06:15 = LA 23:15 (PDT -7) → inside window",
			time.Date(2026, 4, 19, 6, 15, 0, 0, time.UTC),
			true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, _, err := EvaluateTimeWindow(cfg, tt.now)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("got met=%v, want %v (reason: %s)", result.Met, tt.wantMet, result.Reason)
			}
		})
	}
}

func TestEvaluateTimeWindow_EmptyTimezoneDefaultsUTC(t *testing.T) {
	cfg := &TimeWindowConfig{
		StartTime: "10:00",
		EndTime:   "14:00",
	}

	now := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	result, _, err := EvaluateTimeWindow(cfg, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Errorf("expected met=true for 12:00 UTC in 10:00-14:00 window, got false: %s", result.Reason)
	}
}

func TestEvaluateTimeWindow_SnapshotContent(t *testing.T) {
	cfg := &TimeWindowConfig{
		Type:      "time_window",
		StartTime: "09:00",
		EndTime:   "17:00",
		Timezone:  "UTC",
	}

	now := time.Date(2026, 4, 18, 12, 30, 0, 0, time.UTC)
	_, snapshot, err := EvaluateTimeWindow(cfg, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var snap timeWindowSnapshot
	if err := json.Unmarshal(snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}

	if snap.CurrentTime != "12:30" {
		t.Errorf("expected current_time '12:30', got %q", snap.CurrentTime)
	}
	if snap.WindowKind != "same_day" {
		t.Errorf("expected window_kind 'same_day', got %q", snap.WindowKind)
	}
	if !snap.Met {
		t.Error("expected met=true in snapshot")
	}
	if snap.Timezone != "UTC" {
		t.Errorf("expected timezone 'UTC', got %q", snap.Timezone)
	}
}

func TestEvaluateTimeWindow_MidnightBoundary(t *testing.T) {
	// Window from 23:00 to 01:00 — a narrow overnight window.
	cfg := &TimeWindowConfig{
		StartTime: "23:00",
		EndTime:   "01:00",
	}

	tests := []struct {
		name    string
		hour    int
		minute  int
		wantMet bool
	}{
		{"22:59 → outside", 22, 59, false},
		{"23:00 → inside (start)", 23, 0, true},
		{"23:30 → inside", 23, 30, true},
		{"00:00 → inside (midnight)", 0, 0, true},
		{"00:30 → inside", 0, 30, true},
		{"00:59 → inside", 0, 59, true},
		{"01:00 → outside (end, exclusive)", 1, 0, false},
		{"12:00 → outside", 12, 0, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			now := time.Date(2026, 4, 18, tt.hour, tt.minute, 0, 0, time.UTC)
			result, _, err := EvaluateTimeWindow(cfg, now)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("at %02d:%02d: got met=%v, want %v (reason: %s)",
					tt.hour, tt.minute, result.Met, tt.wantMet, result.Reason)
			}
		})
	}
}

func TestEvaluateTimeWindow_ReasonStrings(t *testing.T) {
	cfg := &TimeWindowConfig{
		StartTime: "09:00",
		EndTime:   "17:00",
	}

	// Inside window.
	now := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	result, _, _ := EvaluateTimeWindow(cfg, now)
	if result.Reason != "current time 12:00 is within 09:00–17:00 (UTC)" {
		t.Errorf("unexpected inside reason: %q", result.Reason)
	}

	// Outside window.
	now = time.Date(2026, 4, 18, 20, 0, 0, 0, time.UTC)
	result, _, _ = EvaluateTimeWindow(cfg, now)
	if result.Reason != "current time 20:00 is outside 09:00–17:00 (UTC)" {
		t.Errorf("unexpected outside reason: %q", result.Reason)
	}
}
