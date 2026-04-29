package safety

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ─── Mock History Counter ───────────────────────────────

type mockHistoryCounter struct {
	counts    map[int64]int // automationID → count
	returnErr error
	lastSince time.Time
}

func newMockCounter(counts map[int64]int) *mockHistoryCounter {
	return &mockHistoryCounter{counts: counts}
}

func (m *mockHistoryCounter) CountSinceByAutomation(_ context.Context, automationID int64, since time.Time) (int, error) {
	m.lastSince = since
	if m.returnErr != nil {
		return 0, m.returnErr
	}
	return m.counts[automationID], nil
}

// ─── Helpers ────────────────────────────────────────────

func fixedNow() time.Time {
	return time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
}

func newTestRateLimiter(counter HistoryCounter) *RateLimiter {
	rl := NewRateLimiter(counter)
	rl.nowFunc = fixedNow
	return rl
}

// ─── Check Tests ────────────────────────────────────────

func TestCheck_Unlimited(t *testing.T) {
	counter := newMockCounter(map[int64]int{1: 999})
	rl := newTestRateLimiter(counter)

	result, err := rl.Check(context.Background(), 1, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Allowed {
		t.Errorf("expected allowed=true for unlimited (max=0), got false: %s", result.Reason)
	}
	if result.Reason != "rate limit disabled (unlimited)" {
		t.Errorf("unexpected reason: %q", result.Reason)
	}
}

func TestCheck_UnderLimit(t *testing.T) {
	counter := newMockCounter(map[int64]int{1: 5})
	rl := newTestRateLimiter(counter)

	result, err := rl.Check(context.Background(), 1, 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Allowed {
		t.Errorf("expected allowed=true (5/10), got false: %s", result.Reason)
	}
	if result.ExecutionsUsed != 5 {
		t.Errorf("expected executions_used=5, got %d", result.ExecutionsUsed)
	}
	if result.MaxAllowed != 10 {
		t.Errorf("expected max_allowed=10, got %d", result.MaxAllowed)
	}
}

func TestCheck_AtLimit(t *testing.T) {
	counter := newMockCounter(map[int64]int{1: 10})
	rl := newTestRateLimiter(counter)

	result, err := rl.Check(context.Background(), 1, 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Allowed {
		t.Errorf("expected allowed=false when at limit (10/10), got true")
	}
	if result.ExecutionsUsed != 10 {
		t.Errorf("expected executions_used=10, got %d", result.ExecutionsUsed)
	}
}

func TestCheck_OverLimit(t *testing.T) {
	counter := newMockCounter(map[int64]int{1: 15})
	rl := newTestRateLimiter(counter)

	result, err := rl.Check(context.Background(), 1, 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Allowed {
		t.Errorf("expected allowed=false when over limit (15/10), got true")
	}
	if result.ExecutionsUsed != 15 {
		t.Errorf("expected executions_used=15, got %d", result.ExecutionsUsed)
	}
}

func TestCheck_NegativeMaxIsInvalid(t *testing.T) {
	counter := newMockCounter(map[int64]int{1: 0})
	rl := newTestRateLimiter(counter)

	result, err := rl.Check(context.Background(), 1, -5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Allowed {
		t.Errorf("expected allowed=false for negative max_executions_hour, got true")
	}
	if result.MaxAllowed != -5 {
		t.Errorf("expected max_allowed=-5, got %d", result.MaxAllowed)
	}
}

func TestCheck_CounterError(t *testing.T) {
	counter := newMockCounter(nil)
	counter.returnErr = fmt.Errorf("database connection lost")
	rl := newTestRateLimiter(counter)

	_, err := rl.Check(context.Background(), 1, 10)
	if err == nil {
		t.Fatal("expected error to propagate from counter, got nil")
	}
}

func TestCheck_ZeroExecutions(t *testing.T) {
	counter := newMockCounter(map[int64]int{1: 0})
	rl := newTestRateLimiter(counter)

	result, err := rl.Check(context.Background(), 1, 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Allowed {
		t.Errorf("expected allowed=true (0/5), got false: %s", result.Reason)
	}
	if result.ExecutionsUsed != 0 {
		t.Errorf("expected executions_used=0, got %d", result.ExecutionsUsed)
	}
}

func TestCheck_OneBeforeLimit(t *testing.T) {
	counter := newMockCounter(map[int64]int{1: 9})
	rl := newTestRateLimiter(counter)

	result, err := rl.Check(context.Background(), 1, 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Allowed {
		t.Errorf("expected allowed=true (9/10), got false: %s", result.Reason)
	}
}

func TestCheck_MaxOne(t *testing.T) {
	tests := []struct {
		name    string
		count   int
		allowed bool
	}{
		{"zero of one", 0, true},
		{"one of one", 1, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			counter := newMockCounter(map[int64]int{1: tt.count})
			rl := newTestRateLimiter(counter)

			result, err := rl.Check(context.Background(), 1, 1)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.Allowed != tt.allowed {
				t.Errorf("got allowed=%v, want %v (reason: %s)", result.Allowed, tt.allowed, result.Reason)
			}
		})
	}
}

func TestCheck_QueryWindowIsOneHour(t *testing.T) {
	counter := newMockCounter(map[int64]int{1: 0})
	rl := newTestRateLimiter(counter)

	_, err := rl.Check(context.Background(), 1, 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expectedSince := fixedNow().Add(-1 * time.Hour)
	if !counter.lastSince.Equal(expectedSince) {
		t.Errorf("expected since=%v, got %v", expectedSince, counter.lastSince)
	}
}

func TestCheck_DifferentAutomationIDs(t *testing.T) {
	counter := newMockCounter(map[int64]int{
		1: 10, // at limit
		2: 3,  // under limit
	})
	rl := newTestRateLimiter(counter)

	r1, _ := rl.Check(context.Background(), 1, 10)
	r2, _ := rl.Check(context.Background(), 2, 10)

	if r1.Allowed {
		t.Error("automation 1 should be rate limited")
	}
	if !r2.Allowed {
		t.Error("automation 2 should be allowed")
	}
}

// ─── DefaultLimit Tests ─────────────────────────────────

func TestDefaultLimit_AllTriggerTypes(t *testing.T) {
	tests := []struct {
		triggerType string
		want        int
	}{
		{models.AutomationStepKindTriggerSchedule, DefaultRateLimitSchedule},
		{models.AutomationStepKindTriggerSignal, DefaultRateLimitSignal},
		{models.AutomationStepKindTriggerGeofence, DefaultRateLimitGeofence},
		{models.AutomationStepKindTriggerEvent, DefaultRateLimitEvent},
	}

	for _, tt := range tests {
		t.Run(tt.triggerType, func(t *testing.T) {
			got := DefaultLimit(tt.triggerType)
			if got != tt.want {
				t.Errorf("DefaultLimit(%q) = %d, want %d", tt.triggerType, got, tt.want)
			}
		})
	}
}

func TestDefaultLimit_LegacyTriggerFamiliesUnavailable(t *testing.T) {
	legacyTypes := []string{
		"calendar",
		"mqtt",
		"webhook",
		"sunrise_sunset",
		"vehicle_state",
		"battery",
		"energy",
	}

	for _, triggerType := range legacyTypes {
		t.Run(triggerType, func(t *testing.T) {
			got := DefaultLimit(triggerType)
			if got != 0 {
				t.Errorf("DefaultLimit(%q) = %d, want 0 for unsupported legacy trigger family", triggerType, got)
			}
		})
	}
}

func TestDefaultLimit_UnknownType(t *testing.T) {
	got := DefaultLimit("unknown_trigger")
	if got != 0 {
		t.Errorf("DefaultLimit(\"unknown_trigger\") = %d, want 0 (unlimited)", got)
	}
}

func TestDefaultLimit_EmptyString(t *testing.T) {
	got := DefaultLimit("")
	if got != 0 {
		t.Errorf("DefaultLimit(\"\") = %d, want 0 (unlimited)", got)
	}
}

// ─── Result Reason Strings ──────────────────────────────

func TestCheck_ReasonStrings(t *testing.T) {
	counter := newMockCounter(map[int64]int{1: 5})
	rl := newTestRateLimiter(counter)

	// Under limit
	result, _ := rl.Check(context.Background(), 1, 10)
	expected := "within rate limit: 5/10 executions in the last hour"
	if result.Reason != expected {
		t.Errorf("under-limit reason: got %q, want %q", result.Reason, expected)
	}

	// At limit
	counter.counts[1] = 10
	result, _ = rl.Check(context.Background(), 1, 10)
	expected = "rate limited: 10/10 executions in the last hour"
	if result.Reason != expected {
		t.Errorf("at-limit reason: got %q, want %q", result.Reason, expected)
	}

	// Unlimited
	result, _ = rl.Check(context.Background(), 1, 0)
	if result.Reason != "rate limit disabled (unlimited)" {
		t.Errorf("unlimited reason: got %q", result.Reason)
	}

	// Negative
	result, _ = rl.Check(context.Background(), 1, -3)
	expected = "invalid max_executions_hour: -3 (must be >= 0)"
	if result.Reason != expected {
		t.Errorf("negative reason: got %q, want %q", result.Reason, expected)
	}
}
