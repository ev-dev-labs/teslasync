package condition

import (
	"encoding/json"
	"testing"
	"time"
)

// ─── Config Parsing Tests ───────────────────────────────

func TestParseSeasonalConfig_Valid(t *testing.T) {
	raw := json.RawMessage(`{
		"type": "seasonal",
		"start_month": 11,
		"end_month": 3
	}`)

	cfg, err := ParseSeasonalConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Type != "seasonal" {
		t.Fatalf("expected type 'seasonal', got %q", cfg.Type)
	}
	if cfg.StartMonth != 11 {
		t.Fatalf("expected start_month 11, got %d", cfg.StartMonth)
	}
	if cfg.EndMonth != 3 {
		t.Fatalf("expected end_month 3, got %d", cfg.EndMonth)
	}
}

func TestParseSeasonalConfig_MinimalValid(t *testing.T) {
	raw := json.RawMessage(`{"start_month": 4, "end_month": 9}`)
	cfg, err := ParseSeasonalConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.StartMonth != 4 || cfg.EndMonth != 9 {
		t.Fatalf("expected 4–9, got %d–%d", cfg.StartMonth, cfg.EndMonth)
	}
}

func TestParseSeasonalConfig_Errors(t *testing.T) {
	tests := []struct {
		name string
		json string
	}{
		{"empty", ""},
		{"invalid json", "{bad"},
		{"wrong type", `{"type": "other", "start_month": 1, "end_month": 6}`},
		{"start_month zero", `{"start_month": 0, "end_month": 6}`},
		{"start_month 13", `{"start_month": 13, "end_month": 6}`},
		{"end_month zero", `{"start_month": 1, "end_month": 0}`},
		{"end_month 13", `{"start_month": 1, "end_month": 13}`},
		{"negative start", `{"start_month": -1, "end_month": 6}`},
		{"negative end", `{"start_month": 1, "end_month": -1}`},
		{"equal months", `{"start_month": 6, "end_month": 6}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ParseSeasonalConfig(json.RawMessage(tt.json))
			if err == nil {
				t.Fatalf("expected error for %q, got nil", tt.name)
			}
		})
	}
}

// ─── Evaluation Tests ───────────────────────────────────

func TestEvaluateSeasonal_YearWrap(t *testing.T) {
	// Winter: November through March (year-wrap).
	cfg := &SeasonalConfig{
		Type:       "seasonal",
		StartMonth: 11,
		EndMonth:   3,
	}

	tests := []struct {
		name    string
		month   time.Month
		wantMet bool
	}{
		{"January", time.January, true},
		{"February", time.February, true},
		{"March", time.March, true},
		{"April", time.April, false},
		{"May", time.May, false},
		{"June", time.June, false},
		{"July", time.July, false},
		{"August", time.August, false},
		{"September", time.September, false},
		{"October", time.October, false},
		{"November", time.November, true},
		{"December", time.December, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			now := time.Date(2026, tt.month, 15, 12, 0, 0, 0, time.UTC)
			result, snapshot, err := EvaluateSeasonal(cfg, now)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("EvaluateSeasonal in %s: got met=%v, want %v (reason: %s)",
					tt.name, result.Met, tt.wantMet, result.Reason)
			}
			if snapshot == nil {
				t.Fatal("expected non-nil snapshot")
			}
		})
	}
}

func TestEvaluateSeasonal_SameYear(t *testing.T) {
	// Summer: April through September (same-year).
	cfg := &SeasonalConfig{
		Type:       "seasonal",
		StartMonth: 4,
		EndMonth:   9,
	}

	tests := []struct {
		name    string
		month   time.Month
		wantMet bool
	}{
		{"January", time.January, false},
		{"February", time.February, false},
		{"March", time.March, false},
		{"April", time.April, true},
		{"May", time.May, true},
		{"June", time.June, true},
		{"July", time.July, true},
		{"August", time.August, true},
		{"September", time.September, true},
		{"October", time.October, false},
		{"November", time.November, false},
		{"December", time.December, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			now := time.Date(2026, tt.month, 15, 12, 0, 0, 0, time.UTC)
			result, _, err := EvaluateSeasonal(cfg, now)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("EvaluateSeasonal in %s: got met=%v, want %v (reason: %s)",
					tt.name, result.Met, tt.wantMet, result.Reason)
			}
		})
	}
}

func TestEvaluateSeasonal_SnapshotContent(t *testing.T) {
	cfg := &SeasonalConfig{
		Type:       "seasonal",
		StartMonth: 11,
		EndMonth:   3,
	}

	// April → outside winter season.
	now := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	_, snapshot, err := EvaluateSeasonal(cfg, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var snap seasonalSnapshot
	if err := json.Unmarshal(snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}

	if snap.CurrentMonth != "April" {
		t.Errorf("expected current_month 'April', got %q", snap.CurrentMonth)
	}
	if snap.MonthNumber != 4 {
		t.Errorf("expected month_number 4, got %d", snap.MonthNumber)
	}
	if snap.StartMonth != "November" {
		t.Errorf("expected start_month 'November', got %q", snap.StartMonth)
	}
	if snap.EndMonth != "March" {
		t.Errorf("expected end_month 'March', got %q", snap.EndMonth)
	}
	if snap.RangeKind != "year_wrap" {
		t.Errorf("expected range_kind 'year_wrap', got %q", snap.RangeKind)
	}
	if snap.Met {
		t.Error("expected met=false in snapshot")
	}
}

func TestEvaluateSeasonal_ReasonStrings(t *testing.T) {
	cfg := &SeasonalConfig{
		StartMonth: 11,
		EndMonth:   3,
	}

	// Inside season — January.
	now := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC)
	result, _, _ := EvaluateSeasonal(cfg, now)
	if result.Reason != "January is within November–March season" {
		t.Errorf("unexpected inside reason: %q", result.Reason)
	}

	// Outside season — April.
	now = time.Date(2026, 4, 15, 12, 0, 0, 0, time.UTC)
	result, _, _ = EvaluateSeasonal(cfg, now)
	if result.Reason != "April is outside November–March season" {
		t.Errorf("unexpected outside reason: %q", result.Reason)
	}
}

func TestEvaluateSeasonal_BoundaryMonths(t *testing.T) {
	cfg := &SeasonalConfig{
		StartMonth: 11,
		EndMonth:   3,
	}

	// Start boundary (November) — inclusive.
	result, _, err := EvaluateSeasonal(cfg, time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Errorf("expected met=true for November (start boundary), got false: %s", result.Reason)
	}

	// End boundary (March) — inclusive.
	result, _, err = EvaluateSeasonal(cfg, time.Date(2026, 3, 31, 23, 59, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Errorf("expected met=true for March (end boundary), got false: %s", result.Reason)
	}

	// Just outside start (October).
	result, _, err = EvaluateSeasonal(cfg, time.Date(2026, 10, 31, 23, 59, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Met {
		t.Errorf("expected met=false for October, got true: %s", result.Reason)
	}

	// Just outside end (April).
	result, _, err = EvaluateSeasonal(cfg, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Met {
		t.Errorf("expected met=false for April, got true: %s", result.Reason)
	}
}

func TestEvaluateSeasonal_DecemberToFebruary(t *testing.T) {
	// Narrow year-wrap: December through February.
	cfg := &SeasonalConfig{
		StartMonth: 12,
		EndMonth:   2,
	}

	tests := []struct {
		name    string
		month   time.Month
		wantMet bool
	}{
		{"November", time.November, false},
		{"December", time.December, true},
		{"January", time.January, true},
		{"February", time.February, true},
		{"March", time.March, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			now := time.Date(2026, tt.month, 15, 12, 0, 0, 0, time.UTC)
			result, _, err := EvaluateSeasonal(cfg, now)
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

func TestEvaluateSeasonal_AllMonthsCovered(t *testing.T) {
	// Same-year range covering 11 months: Jan–Nov.
	cfg := &SeasonalConfig{
		StartMonth: 1,
		EndMonth:   11,
	}

	for m := time.January; m <= time.December; m++ {
		now := time.Date(2026, m, 15, 12, 0, 0, 0, time.UTC)
		result, _, err := EvaluateSeasonal(cfg, now)
		if err != nil {
			t.Fatalf("unexpected error for month %d: %v", m, err)
		}
		wantMet := m >= time.January && m <= time.November
		if result.Met != wantMet {
			t.Errorf("month %s: got met=%v, want %v (reason: %s)",
				m.String(), result.Met, wantMet, result.Reason)
		}
	}
}
