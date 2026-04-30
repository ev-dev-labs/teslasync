package condition

import (
	"encoding/json"
	"testing"
	"time"
)

// ─── Config Parsing Tests ───────────────────────────────

func TestDecodeCooldownSpec_Valid(t *testing.T) {
	raw := json.RawMessage(`{"type": "cooldown", "minutes": 30}`)

	cfg, err := DecodeCooldownSpec(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Type != "cooldown" {
		t.Fatalf("expected type 'cooldown', got %q", cfg.Type)
	}
	if cfg.Minutes != 30 {
		t.Fatalf("expected minutes 30, got %d", cfg.Minutes)
	}
}

func TestDecodeCooldownSpec_MinimalValid(t *testing.T) {
	raw := json.RawMessage(`{"minutes": 10}`)
	cfg, err := DecodeCooldownSpec(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Minutes != 10 {
		t.Fatalf("expected minutes 10, got %d", cfg.Minutes)
	}
}

func TestDecodeCooldownSpec_Errors(t *testing.T) {
	tests := []struct {
		name string
		json string
	}{
		{"empty", ""},
		{"invalid json", "{bad"},
		{"wrong type", `{"type": "other", "minutes": 30}`},
		{"zero minutes", `{"type": "cooldown", "minutes": 0}`},
		{"negative minutes", `{"type": "cooldown", "minutes": -5}`},
		{"missing minutes", `{"type": "cooldown"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := DecodeCooldownSpec(json.RawMessage(tt.json))
			if err == nil {
				t.Fatalf("expected error for %q, got nil", tt.name)
			}
		})
	}
}

// ─── Evaluation Tests ───────────────────────────────────

func TestEvaluateCooldown_NeverTriggered(t *testing.T) {
	cfg := &CooldownConfig{Type: "cooldown", Minutes: 30}
	now := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)

	result, snapshot, err := EvaluateCooldown(cfg, nil, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Errorf("expected met=true when never triggered, got false: %s", result.Reason)
	}
	if snapshot == nil {
		t.Fatal("expected non-nil snapshot")
	}
}

func TestEvaluateCooldown_CooldownElapsed(t *testing.T) {
	cfg := &CooldownConfig{Type: "cooldown", Minutes: 30}
	now := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	lastTriggered := time.Date(2026, 4, 18, 11, 0, 0, 0, time.UTC) // 60 min ago

	result, _, err := EvaluateCooldown(cfg, &lastTriggered, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Errorf("expected met=true (60m elapsed, 30m cooldown), got false: %s", result.Reason)
	}
}

func TestEvaluateCooldown_ExactlyAtBoundary(t *testing.T) {
	cfg := &CooldownConfig{Type: "cooldown", Minutes: 30}
	now := time.Date(2026, 4, 18, 12, 30, 0, 0, time.UTC)
	lastTriggered := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC) // exactly 30m ago

	result, _, err := EvaluateCooldown(cfg, &lastTriggered, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Met {
		t.Errorf("expected met=true at exact cooldown boundary (30m elapsed, 30m cooldown), got false: %s",
			result.Reason)
	}
}

func TestEvaluateCooldown_StillInCooldown(t *testing.T) {
	cfg := &CooldownConfig{Type: "cooldown", Minutes: 30}
	now := time.Date(2026, 4, 18, 12, 10, 0, 0, time.UTC)
	lastTriggered := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC) // 10 min ago

	result, _, err := EvaluateCooldown(cfg, &lastTriggered, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Met {
		t.Errorf("expected met=false (10m elapsed, 30m cooldown), got true: %s", result.Reason)
	}
}

func TestEvaluateCooldown_JustUnderCooldown(t *testing.T) {
	cfg := &CooldownConfig{Type: "cooldown", Minutes: 30}
	now := time.Date(2026, 4, 18, 12, 29, 59, 0, time.UTC)
	lastTriggered := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC) // 29m59s ago

	result, _, err := EvaluateCooldown(cfg, &lastTriggered, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Met {
		t.Errorf("expected met=false (29m59s elapsed, 30m cooldown), got true: %s", result.Reason)
	}
}

func TestEvaluateCooldown_VariousDurations(t *testing.T) {
	tests := []struct {
		name       string
		minutes    int
		elapsedMin int
		wantMet    bool
	}{
		{"1 min cooldown, 0 elapsed", 1, 0, false},
		{"1 min cooldown, 1 elapsed", 1, 1, true},
		{"1 min cooldown, 2 elapsed", 1, 2, true},
		{"60 min cooldown, 30 elapsed", 60, 30, false},
		{"60 min cooldown, 60 elapsed", 60, 60, true},
		{"60 min cooldown, 120 elapsed", 60, 120, true},
		{"5 min cooldown, 4 elapsed", 5, 4, false},
		{"5 min cooldown, 5 elapsed", 5, 5, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &CooldownConfig{Type: "cooldown", Minutes: tt.minutes}
			now := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
			lastTriggered := now.Add(-time.Duration(tt.elapsedMin) * time.Minute)

			result, _, err := EvaluateCooldown(cfg, &lastTriggered, now)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Met != tt.wantMet {
				t.Errorf("got met=%v, want %v (reason: %s)", result.Met, tt.wantMet, result.Reason)
			}
		})
	}
}

func TestEvaluateCooldown_SnapshotContent(t *testing.T) {
	cfg := &CooldownConfig{Type: "cooldown", Minutes: 30}
	now := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	lastTriggered := time.Date(2026, 4, 18, 11, 45, 0, 0, time.UTC) // 15 min ago

	_, snapshot, err := EvaluateCooldown(cfg, &lastTriggered, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var snap cooldownSnapshot
	if err := json.Unmarshal(snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}

	if snap.CooldownMinutes != 30 {
		t.Errorf("expected cooldown_minutes 30, got %d", snap.CooldownMinutes)
	}
	if snap.ElapsedMinutes != 15.0 {
		t.Errorf("expected elapsed_minutes 15.0, got %f", snap.ElapsedMinutes)
	}
	if snap.Met {
		t.Error("expected met=false in snapshot")
	}
	if snap.LastTriggeredAt == nil {
		t.Error("expected non-nil last_triggered_at in snapshot")
	}
}

func TestEvaluateCooldown_SnapshotNeverTriggered(t *testing.T) {
	cfg := &CooldownConfig{Type: "cooldown", Minutes: 10}
	now := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)

	_, snapshot, err := EvaluateCooldown(cfg, nil, now)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var snap cooldownSnapshot
	if err := json.Unmarshal(snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}

	if snap.LastTriggeredAt != nil {
		t.Errorf("expected nil last_triggered_at, got %v", snap.LastTriggeredAt)
	}
	if snap.ElapsedMinutes != -1 {
		t.Errorf("expected elapsed_minutes -1, got %f", snap.ElapsedMinutes)
	}
	if !snap.Met {
		t.Error("expected met=true in snapshot")
	}
}

func TestEvaluateCooldown_ReasonStrings(t *testing.T) {
	cfg := &CooldownConfig{Type: "cooldown", Minutes: 30}

	// Never triggered.
	result, _, _ := EvaluateCooldown(cfg, nil, time.Now())
	if result.Reason != "never triggered, cooldown is 30m" {
		t.Errorf("unexpected never-triggered reason: %q", result.Reason)
	}

	// Cooldown elapsed (60m ago).
	now := time.Date(2026, 4, 18, 13, 0, 0, 0, time.UTC)
	lastTriggered := time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
	result, _, _ = EvaluateCooldown(cfg, &lastTriggered, now)
	if result.Reason != "last triggered 60m ago, cooldown is 30m" {
		t.Errorf("unexpected elapsed reason: %q", result.Reason)
	}

	// Still in cooldown (5m ago).
	lastTriggered = time.Date(2026, 4, 18, 12, 55, 0, 0, time.UTC)
	result, _, _ = EvaluateCooldown(cfg, &lastTriggered, now)
	if result.Reason != "last triggered 5m ago, cooldown is 30m (25m remaining)" {
		t.Errorf("unexpected in-cooldown reason: %q", result.Reason)
	}
}
