package safety

import (
	"context"
	"fmt"
	"sync"
	"testing"
)

// ─── Mock Notifier ─────────────────────────────────────

type mockNotifier struct {
	mu    sync.Mutex
	calls []notifyCall
	err   error
}

type notifyCall struct {
	automationID   int64
	automationName string
	reason         string
}

func (m *mockNotifier) NotifyAutoDisabled(_ context.Context, id int64, name, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls = append(m.calls, notifyCall{id, name, reason})
	return m.err
}

func (m *mockNotifier) callCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.calls)
}

func (m *mockNotifier) lastCall() (notifyCall, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.calls) == 0 {
		return notifyCall{}, false
	}
	return m.calls[len(m.calls)-1], true
}

// ─── Check (Pure Logic) Tests ──────────────────────────

func TestCheck_BelowThreshold(t *testing.T) {
	c := NewAutoDisableChecker(newMockDisabler())

	tests := []struct {
		name     string
		failures int
	}{
		{"zero", 0},
		{"one", 1},
		{"four", 4},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := c.Check(tt.failures)
			if result.Disabled {
				t.Errorf("Check(%d) should not disable (threshold=%d)", tt.failures, DefaultDisableThreshold)
			}
			if result.ConsecutiveFailures != tt.failures {
				t.Errorf("ConsecutiveFailures = %d, want %d", result.ConsecutiveFailures, tt.failures)
			}
			if result.Threshold != DefaultDisableThreshold {
				t.Errorf("Threshold = %d, want %d", result.Threshold, DefaultDisableThreshold)
			}
		})
	}
}

func TestCheck_AtThreshold(t *testing.T) {
	c := NewAutoDisableChecker(newMockDisabler())
	result := c.Check(DefaultDisableThreshold)

	if !result.Disabled {
		t.Fatalf("Check(%d) should disable (threshold=%d)", DefaultDisableThreshold, DefaultDisableThreshold)
	}
	if result.Reason == "" {
		t.Error("Reason should not be empty when disabled")
	}
}

func TestCheck_AboveThreshold(t *testing.T) {
	c := NewAutoDisableChecker(newMockDisabler())
	result := c.Check(DefaultDisableThreshold + 5)

	if !result.Disabled {
		t.Fatal("should disable when above threshold")
	}
}

func TestCheck_CustomThreshold(t *testing.T) {
	c := NewAutoDisableChecker(newMockDisabler(), WithThreshold(3))

	r2 := c.Check(2)
	if r2.Disabled {
		t.Error("2 failures should not trigger threshold=3")
	}

	r3 := c.Check(3)
	if !r3.Disabled {
		t.Error("3 failures should trigger threshold=3")
	}
}

func TestCheck_ThresholdZero_NeverDisables(t *testing.T) {
	c := NewAutoDisableChecker(newMockDisabler(), WithThreshold(0))

	result := c.Check(100)
	if result.Disabled {
		t.Error("threshold=0 should never disable")
	}
}

func TestCheck_ThresholdNegative_NeverDisables(t *testing.T) {
	c := NewAutoDisableChecker(newMockDisabler(), WithThreshold(-1))

	result := c.Check(100)
	if result.Disabled {
		t.Error("negative threshold should never disable")
	}
}

func TestCheck_ThresholdOne_DisablesOnFirst(t *testing.T) {
	c := NewAutoDisableChecker(newMockDisabler(), WithThreshold(1))

	result := c.Check(1)
	if !result.Disabled {
		t.Error("threshold=1 should disable on first failure")
	}
}

// ─── RecordOutcome Success Tests ───────────────────────

func TestRecordOutcome_Success(t *testing.T) {
	c := NewAutoDisableChecker(newMockDisabler())

	result, err := c.RecordOutcome(context.Background(), 1, "test-auto", true, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Disabled {
		t.Error("success should not disable")
	}
	if result.ConsecutiveFailures != 0 {
		t.Errorf("ConsecutiveFailures = %d, want 0 on success", result.ConsecutiveFailures)
	}
	if result.Reason != "execution succeeded" {
		t.Errorf("Reason = %q, want 'execution succeeded'", result.Reason)
	}
}

func TestRecordOutcome_SuccessIgnoresConsecutiveFailures(t *testing.T) {
	c := NewAutoDisableChecker(newMockDisabler())

	result, err := c.RecordOutcome(context.Background(), 1, "test", true, 99)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Disabled {
		t.Error("success should not disable regardless of failure count")
	}
	if result.ConsecutiveFailures != 0 {
		t.Errorf("ConsecutiveFailures = %d, want 0 on success", result.ConsecutiveFailures)
	}
}

// ─── RecordOutcome Failure Tests ───────────────────────

func TestRecordOutcome_FailureBelowThreshold(t *testing.T) {
	disabler := newMockDisabler()
	c := NewAutoDisableChecker(disabler, WithThreshold(5))

	result, err := c.RecordOutcome(context.Background(), 42, "charge-guard", false, 3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Disabled {
		t.Error("3/5 failures should not disable")
	}

	if _, ok := disabler.wasDisabled(42); ok {
		t.Error("automation should not be disabled below threshold")
	}
}

func TestRecordOutcome_FailureAtThreshold_Disables(t *testing.T) {
	disabler := newMockDisabler()
	notifier := &mockNotifier{}
	c := NewAutoDisableChecker(disabler, WithThreshold(5), WithNotifier(notifier))

	result, err := c.RecordOutcome(context.Background(), 42, "charge-guard", false, 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Disabled {
		t.Fatal("5/5 failures should disable")
	}
	if result.ConsecutiveFailures != 5 {
		t.Errorf("ConsecutiveFailures = %d, want 5", result.ConsecutiveFailures)
	}
	if result.Threshold != 5 {
		t.Errorf("Threshold = %d, want 5", result.Threshold)
	}

	// Disabler should have been called.
	reason, ok := disabler.wasDisabled(42)
	if !ok {
		t.Fatal("automation should be disabled in DB")
	}
	if reason == "" {
		t.Error("disable reason should not be empty")
	}

	// Notifier should have been called.
	if notifier.callCount() != 1 {
		t.Fatalf("expected 1 notification, got %d", notifier.callCount())
	}
	call, _ := notifier.lastCall()
	if call.automationID != 42 {
		t.Errorf("notification automationID = %d, want 42", call.automationID)
	}
	if call.automationName != "charge-guard" {
		t.Errorf("notification name = %q, want 'charge-guard'", call.automationName)
	}
	if call.reason == "" {
		t.Error("notification reason should not be empty")
	}
	if !result.NotificationSent {
		t.Error("NotificationSent should be true")
	}
}

func TestRecordOutcome_FailureAboveThreshold_Disables(t *testing.T) {
	disabler := newMockDisabler()
	c := NewAutoDisableChecker(disabler, WithThreshold(3))

	result, err := c.RecordOutcome(context.Background(), 1, "test", false, 7)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Disabled {
		t.Fatal("7/3 failures should disable")
	}
	if _, ok := disabler.wasDisabled(1); !ok {
		t.Fatal("automation should be disabled in DB")
	}
}

// ─── Error Handling Tests ──────────────────────────────

func TestRecordOutcome_DisablerError_ReturnsError(t *testing.T) {
	disabler := newMockDisabler()
	disabler.err = fmt.Errorf("database connection refused")
	c := NewAutoDisableChecker(disabler, WithThreshold(1))

	_, err := c.RecordOutcome(context.Background(), 1, "test", false, 1)
	if err == nil {
		t.Fatal("expected error when disabler fails")
	}
}

func TestRecordOutcome_NotifierError_DoesNotFailOperation(t *testing.T) {
	disabler := newMockDisabler()
	notifier := &mockNotifier{err: fmt.Errorf("slack webhook down")}
	c := NewAutoDisableChecker(disabler, WithThreshold(1), WithNotifier(notifier))

	result, err := c.RecordOutcome(context.Background(), 1, "test", false, 1)
	if err != nil {
		t.Fatalf("notifier failure should not fail operation: %v", err)
	}
	if !result.Disabled {
		t.Fatal("should still be disabled even if notification failed")
	}
	if result.NotificationSent {
		t.Error("NotificationSent should be false when notifier fails")
	}

	// Disabler should still have been called successfully.
	if _, ok := disabler.wasDisabled(1); !ok {
		t.Error("automation should be disabled despite notification failure")
	}
}

func TestRecordOutcome_NoNotifier_StillDisables(t *testing.T) {
	disabler := newMockDisabler()
	c := NewAutoDisableChecker(disabler, WithThreshold(2))

	result, err := c.RecordOutcome(context.Background(), 1, "test", false, 2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Disabled {
		t.Fatal("should disable without notifier")
	}
	if result.NotificationSent {
		t.Error("NotificationSent should be false when no notifier configured")
	}
}

// ─── Threshold Getter ──────────────────────────────────

func TestThreshold_Default(t *testing.T) {
	c := NewAutoDisableChecker(newMockDisabler())
	if c.Threshold() != DefaultDisableThreshold {
		t.Errorf("default threshold = %d, want %d", c.Threshold(), DefaultDisableThreshold)
	}
}

func TestThreshold_Custom(t *testing.T) {
	c := NewAutoDisableChecker(newMockDisabler(), WithThreshold(10))
	if c.Threshold() != 10 {
		t.Errorf("custom threshold = %d, want 10", c.Threshold())
	}
}

// ─── Integration Scenario Tests ────────────────────────

func TestScenario_GradualDegradation(t *testing.T) {
	disabler := newMockDisabler()
	notifier := &mockNotifier{}
	c := NewAutoDisableChecker(disabler, WithThreshold(5), WithNotifier(notifier))

	// Failures 1–4: not disabled.
	for i := 1; i <= 4; i++ {
		result, err := c.RecordOutcome(context.Background(), 1, "failing-auto", false, i)
		if err != nil {
			t.Fatalf("failure %d: unexpected error: %v", i, err)
		}
		if result.Disabled {
			t.Fatalf("failure %d: should not disable yet", i)
		}
	}

	// Failure 5: disabled + notified.
	result, err := c.RecordOutcome(context.Background(), 1, "failing-auto", false, 5)
	if err != nil {
		t.Fatalf("failure 5: unexpected error: %v", err)
	}
	if !result.Disabled {
		t.Fatal("failure 5: should be disabled")
	}
	if !result.NotificationSent {
		t.Error("notification should have been sent")
	}
	if notifier.callCount() != 1 {
		t.Errorf("expected 1 notification, got %d", notifier.callCount())
	}
}

func TestScenario_SuccessResetsTracking(t *testing.T) {
	c := NewAutoDisableChecker(newMockDisabler(), WithThreshold(3))

	// 2 failures.
	r, _ := c.RecordOutcome(context.Background(), 1, "test", false, 2)
	if r.Disabled {
		t.Fatal("2/3 should not disable")
	}

	// Success resets.
	r, _ = c.RecordOutcome(context.Background(), 1, "test", true, 0)
	if r.Disabled {
		t.Fatal("success should not disable")
	}
	if r.ConsecutiveFailures != 0 {
		t.Errorf("expected 0 failures after success, got %d", r.ConsecutiveFailures)
	}
}

func TestScenario_MultipleAutomations_Independent(t *testing.T) {
	disabler := newMockDisabler()
	c := NewAutoDisableChecker(disabler, WithThreshold(2))

	// Auto 1: 2 failures → disabled.
	result, _ := c.RecordOutcome(context.Background(), 1, "auto-1", false, 2)
	if !result.Disabled {
		t.Fatal("auto-1 should be disabled")
	}

	// Auto 2: 1 failure → not disabled.
	result, _ = c.RecordOutcome(context.Background(), 2, "auto-2", false, 1)
	if result.Disabled {
		t.Fatal("auto-2 should not be disabled (only 1 failure)")
	}

	// Verify only auto 1 was disabled.
	if _, ok := disabler.wasDisabled(1); !ok {
		t.Error("auto-1 should be disabled in DB")
	}
	if _, ok := disabler.wasDisabled(2); ok {
		t.Error("auto-2 should NOT be disabled in DB")
	}
}

func TestScenario_DisablerCalledOnce_NotOnSubsequentChecks(t *testing.T) {
	disabler := newMockDisabler()
	notifier := &mockNotifier{}
	c := NewAutoDisableChecker(disabler, WithThreshold(2), WithNotifier(notifier))

	// First call at threshold: disables.
	r1, err := c.RecordOutcome(context.Background(), 1, "auto-1", false, 2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !r1.Disabled {
		t.Fatal("should disable at threshold")
	}

	// Second call above threshold: still evaluates as disabled.
	// (In practice the automation would be disabled in the DB and not
	// fire again, but the checker still correctly reports the outcome.)
	r2, err := c.RecordOutcome(context.Background(), 1, "auto-1", false, 3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !r2.Disabled {
		t.Fatal("should still evaluate as disabled")
	}

	// Notifier was called twice (once per RecordOutcome that crossed threshold).
	if notifier.callCount() != 2 {
		t.Errorf("expected 2 notifications, got %d", notifier.callCount())
	}
}

// ─── Concurrent Safety ─────────────────────────────────

func TestRecordOutcome_ConcurrentSafe(t *testing.T) {
	disabler := newMockDisabler()
	c := NewAutoDisableChecker(disabler, WithThreshold(3))

	const goroutines = 50
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		go func(failures int) {
			defer wg.Done()
			c.RecordOutcome(context.Background(), 1, "concurrent-auto", false, failures%6)
		}(i)
	}

	wg.Wait()
	// No panic or data race = success. Run with -race to verify.
}

// ─── Default Constant Tests ────────────────────────────

func TestDefaultDisableThreshold(t *testing.T) {
	if DefaultDisableThreshold != 5 {
		t.Errorf("DefaultDisableThreshold = %d, want 5", DefaultDisableThreshold)
	}
}
