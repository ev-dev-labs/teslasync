package automation

import (
	"sync"
	"testing"
	"time"
)

// ─── Happy Path ──────────────────────────────────────────

func TestHappyPath_WithCooldown(t *testing.T) {
	m := NewExecutionFSM(1, 100, "charge-limit", "battery_level", 3, 5, 10*time.Second)

	m.FireTrigger()
	assertState(t, m, Evaluating)

	m.ConditionsMet()
	assertState(t, m, Executing)

	m.MarkSucceeded()
	assertState(t, m, Succeeded)

	m.ResetFromSuccess()
	assertState(t, m, Cooldown)

	m.CooldownExpired()
	assertState(t, m, Idle)
}

func TestHappyPath_NoCooldown(t *testing.T) {
	m := NewExecutionFSM(1, 100, "charge-limit", "battery_level", 3, 5, 0)

	m.FireTrigger()
	m.ConditionsMet()
	m.MarkSucceeded()
	m.ResetFromSuccess()
	assertState(t, m, Idle)
}

// ─── Conditions Not Met ──────────────────────────────────

func TestConditionsNotMet_SkippedToIdle(t *testing.T) {
	m := NewExecutionFSM(1, 100, "climate-on", "schedule", 3, 5, 0)

	m.FireTrigger()
	assertState(t, m, Evaluating)

	m.ConditionsNotMet()
	assertState(t, m, Skipped)

	m.ResetFromSkipped()
	assertState(t, m, Idle)
}

// ─── Failure + Retry ─────────────────────────────────────

func TestFailure_RetryThenSucceed(t *testing.T) {
	m := NewExecutionFSM(1, 100, "lock-doors", "geofence", 3, 5, 0)

	m.FireTrigger()
	m.ConditionsMet()
	m.MarkFailed()
	assertState(t, m, Failed)

	ok := m.ScheduleRetry()
	if !ok {
		t.Fatal("expected retry to be scheduled")
	}
	assertState(t, m, Retrying)

	m.RetryNow()
	assertState(t, m, Executing)

	m.MarkSucceeded()
	assertState(t, m, Succeeded)

	if m.ConsecutiveFailures() != 0 {
		t.Fatalf("expected consecutive failures reset to 0, got %d", m.ConsecutiveFailures())
	}
}

func TestFailure_MultipleRetries(t *testing.T) {
	m := NewExecutionFSM(1, 100, "lock-doors", "geofence", 3, 5, 0)

	m.FireTrigger()
	m.ConditionsMet()

	// Fail and retry twice, then succeed on third attempt
	for i := 0; i < 2; i++ {
		m.MarkFailed()
		ok := m.ScheduleRetry()
		if !ok {
			t.Fatalf("expected retry %d to be scheduled", i+1)
		}
		m.RetryNow()
	}

	if m.RetryCount() != 2 {
		t.Fatalf("expected retry count 2, got %d", m.RetryCount())
	}

	m.MarkSucceeded()
	assertState(t, m, Succeeded)
}

// ─── Give Up ─────────────────────────────────────────────

func TestGaveUp_MaxRetriesExceeded(t *testing.T) {
	maxRetries := 2
	m := NewExecutionFSM(1, 100, "lock-doors", "geofence", maxRetries, 10, 0)

	m.FireTrigger()
	m.ConditionsMet()

	for i := 0; i <= maxRetries; i++ {
		m.MarkFailed()
		m.ScheduleRetry()
		if m.State() == Retrying {
			m.RetryNow()
		}
	}

	assertState(t, m, GaveUp)
}

func TestGaveUp_BelowThreshold_ResetsToIdle(t *testing.T) {
	m := NewExecutionFSM(1, 100, "lock-doors", "geofence", 0, 5, 0)

	m.FireTrigger()
	m.ConditionsMet()
	m.MarkFailed()
	m.ScheduleRetry() // maxRetries=0, so retryCount(1) > 0 → gave_up

	assertState(t, m, GaveUp)

	m.ResetFromGaveUp()
	assertState(t, m, Idle)
}

func TestGaveUp_ExceedsThreshold_Disabled(t *testing.T) {
	threshold := 2
	m := NewExecutionFSM(1, 100, "lock-doors", "geofence", 0, threshold, 0)

	// Run 1: fail → gave_up (consecutiveFailures = 1)
	m.FireTrigger()
	m.ConditionsMet()
	m.MarkFailed()
	m.ScheduleRetry()
	assertState(t, m, GaveUp)
	m.ResetFromGaveUp()

	// Run 2: fail → gave_up → disabled (consecutiveFailures = 2 >= threshold)
	m.FireTrigger()
	m.ConditionsMet()
	m.MarkFailed()
	m.ScheduleRetry()
	assertState(t, m, Disabled)
}

// ─── Cooldown ────────────────────────────────────────────

func TestCooldown_NotExpiredYet(t *testing.T) {
	m := NewExecutionFSM(1, 100, "charge-limit", "battery_level", 3, 5, time.Hour)

	m.FireTrigger()
	m.ConditionsMet()
	m.MarkSucceeded()
	m.ResetFromSuccess()
	assertState(t, m, Cooldown)

	if m.IsCooldownExpired() {
		t.Fatal("cooldown should not be expired yet (1 hour)")
	}
}

func TestCooldown_Expired(t *testing.T) {
	m := NewExecutionFSM(1, 100, "charge-limit", "battery_level", 3, 5, 1*time.Millisecond)

	m.FireTrigger()
	m.ConditionsMet()
	m.MarkSucceeded()
	m.ResetFromSuccess()
	assertState(t, m, Cooldown)

	time.Sleep(5 * time.Millisecond)

	if !m.IsCooldownExpired() {
		t.Fatal("cooldown should be expired")
	}

	m.CooldownExpired()
	assertState(t, m, Idle)
}

func TestCooldown_PartialSuccess(t *testing.T) {
	m := NewExecutionFSM(1, 100, "multi-action", "schedule", 3, 5, 5*time.Second)

	m.FireTrigger()
	m.ConditionsMet()
	m.MarkPartial()
	assertState(t, m, Partial)

	m.ResetFromSuccess()
	assertState(t, m, Cooldown)
}

// ─── Re-enable ───────────────────────────────────────────

func TestReEnable_FromDisabled(t *testing.T) {
	m := NewExecutionFSM(1, 100, "lock-doors", "geofence", 0, 1, 0)

	// Force into disabled
	m.FireTrigger()
	m.ConditionsMet()
	m.MarkFailed()
	m.ScheduleRetry()
	assertState(t, m, Disabled)

	m.ReEnable()
	assertState(t, m, Idle)

	if m.ConsecutiveFailures() != 0 {
		t.Fatalf("expected consecutive failures reset to 0 after re-enable, got %d", m.ConsecutiveFailures())
	}
}

// ─── Partial Success ─────────────────────────────────────

func TestPartial_ResetsConsecutiveFailures(t *testing.T) {
	m := NewExecutionFSM(1, 100, "multi-action", "schedule", 0, 3, 0)

	// Run 1: gave_up (consecutiveFailures = 1)
	m.FireTrigger()
	m.ConditionsMet()
	m.MarkFailed()
	m.ScheduleRetry()
	m.ResetFromGaveUp()

	if m.ConsecutiveFailures() != 1 {
		t.Fatalf("expected 1 consecutive failure, got %d", m.ConsecutiveFailures())
	}

	// Run 2: partial success resets consecutiveFailures
	m.FireTrigger()
	m.ConditionsMet()
	m.MarkPartial()

	if m.ConsecutiveFailures() != 0 {
		t.Fatalf("expected consecutive failures reset to 0 after partial, got %d", m.ConsecutiveFailures())
	}
}

// ─── Invalid Transitions ─────────────────────────────────

func TestInvalidTransition_FireTrigger_NotFromIdle(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 3, 5, 0)

	m.FireTrigger()
	assertState(t, m, Evaluating)

	// FireTrigger again should be no-op
	m.FireTrigger()
	assertState(t, m, Evaluating)
}

func TestInvalidTransition_ConditionsMet_NotFromEvaluating(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 3, 5, 0)

	// ConditionsMet from Idle — should be no-op
	m.ConditionsMet()
	assertState(t, m, Idle)
}

func TestInvalidTransition_MarkSucceeded_NotFromExecuting(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 3, 5, 0)

	m.MarkSucceeded()
	assertState(t, m, Idle)
}

func TestInvalidTransition_ScheduleRetry_NotFromFailed(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 3, 5, 0)

	ok := m.ScheduleRetry()
	if ok {
		t.Fatal("ScheduleRetry should return false when not in Failed state")
	}
	assertState(t, m, Idle)
}

func TestInvalidTransition_RetryNow_NotFromRetrying(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 3, 5, 0)

	m.RetryNow()
	assertState(t, m, Idle)
}

func TestInvalidTransition_CooldownExpired_NotFromCooldown(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 3, 5, 0)

	m.CooldownExpired()
	assertState(t, m, Idle)
}

func TestInvalidTransition_ReEnable_NotFromDisabled(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 3, 5, 0)

	m.ReEnable()
	assertState(t, m, Idle) // no-op, already idle
}

func TestInvalidTransition_ResetFromGaveUp_NotFromGaveUp(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 3, 5, 0)

	m.ResetFromGaveUp()
	assertState(t, m, Idle) // no-op, already idle
}

// ─── Counter Resets ──────────────────────────────────────

func TestRetryCount_ResetsOnNewRun(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 3, 10, 0)

	// Run 1: fail, retry once, then succeed
	m.FireTrigger()
	m.ConditionsMet()
	m.MarkFailed()
	m.ScheduleRetry()
	m.RetryNow()
	m.MarkSucceeded()
	m.ResetFromSuccess()

	if m.RetryCount() != 1 {
		t.Fatalf("expected retry count 1 after run 1, got %d", m.RetryCount())
	}

	// Run 2: retry count should reset
	m.FireTrigger()
	if m.RetryCount() != 0 {
		t.Fatalf("expected retry count reset to 0 on new run, got %d", m.RetryCount())
	}
}

func TestConsecutiveFailures_ResetsOnSuccess(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 0, 10, 0)

	// Two failed runs
	m.FireTrigger()
	m.ConditionsMet()
	m.MarkFailed()
	m.ScheduleRetry()
	m.ResetFromGaveUp()

	m.FireTrigger()
	m.ConditionsMet()
	m.MarkFailed()
	m.ScheduleRetry()
	m.ResetFromGaveUp()

	if m.ConsecutiveFailures() != 2 {
		t.Fatalf("expected 2 consecutive failures, got %d", m.ConsecutiveFailures())
	}

	// Successful run resets the counter
	m.FireTrigger()
	m.ConditionsMet()
	m.MarkSucceeded()

	if m.ConsecutiveFailures() != 0 {
		t.Fatalf("expected 0 consecutive failures after success, got %d", m.ConsecutiveFailures())
	}
}

// ─── Disable Threshold Off-by-One ────────────────────────

func TestDisableThreshold_ExactBoundary(t *testing.T) {
	// threshold = 3: should disable on exactly 3 consecutive failures
	threshold := 3
	m := NewExecutionFSM(1, 100, "test", "schedule", 0, threshold, 0)

	for i := 1; i <= threshold-1; i++ {
		m.FireTrigger()
		m.ConditionsMet()
		m.MarkFailed()
		m.ScheduleRetry()
		if m.State() == Disabled {
			t.Fatalf("should NOT disable at %d consecutive failures (threshold=%d)", i, threshold)
		}
		m.ResetFromGaveUp()
	}

	// This run should trigger disable
	m.FireTrigger()
	m.ConditionsMet()
	m.MarkFailed()
	m.ScheduleRetry()
	assertState(t, m, Disabled)
}

func TestDisableThreshold_ZeroMeansNeverDisable(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 0, 0, 0)

	for i := 0; i < 10; i++ {
		m.FireTrigger()
		m.ConditionsMet()
		m.MarkFailed()
		m.ScheduleRetry()
		if m.State() == Disabled {
			t.Fatalf("should never disable when threshold is 0")
		}
		m.ResetFromGaveUp()
	}
}

// ─── Transition Log ──────────────────────────────────────

func TestTransitions_RecordsAllChanges(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 3, 5, 0)

	m.FireTrigger()
	m.ConditionsMet()
	m.MarkSucceeded()
	m.ResetFromSuccess()

	transitions := m.Transitions()
	if len(transitions) != 4 {
		t.Fatalf("expected 4 transitions, got %d", len(transitions))
	}

	expected := []struct {
		from State
		to   State
	}{
		{Idle, Evaluating},
		{Evaluating, Executing},
		{Executing, Succeeded},
		{Succeeded, Idle},
	}

	for i, e := range expected {
		if transitions[i].From != e.from || transitions[i].To != e.to {
			t.Fatalf("transition %d: expected %s→%s, got %s→%s",
				i, e.from, e.to, transitions[i].From, transitions[i].To)
		}
	}
}

func TestTransitions_ReturnsACopy(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 3, 5, 0)
	m.FireTrigger()

	copy1 := m.Transitions()
	m.ConditionsMet()
	copy2 := m.Transitions()

	if len(copy1) == len(copy2) {
		t.Fatal("copies should be independent; copy1 should not grow when FSM advances")
	}
}

// ─── Context Snapshot ────────────────────────────────────

func TestContextSnapshot(t *testing.T) {
	m := NewExecutionFSM(42, 7, "test-auto", "battery_level", 3, 5, 0)

	snap := m.ContextSnapshot()
	if snap["automation_id"] != int64(42) {
		t.Fatalf("expected automation_id=42, got %v", snap["automation_id"])
	}
	if snap["automation_name"] != "test-auto" {
		t.Fatalf("expected automation_name=test-auto, got %v", snap["automation_name"])
	}
	if snap["trigger_type"] != "battery_level" {
		t.Fatalf("expected trigger_type=battery_level, got %v", snap["trigger_type"])
	}
}

// ─── IsRunComplete ───────────────────────────────────────

func TestIsRunComplete(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 3, 5, 0)

	// Idle = run complete
	if !m.IsRunComplete() {
		t.Fatal("Idle should be run complete")
	}

	// Evaluating = not complete
	m.FireTrigger()
	if m.IsRunComplete() {
		t.Fatal("Evaluating should not be run complete")
	}

	// Executing = not complete
	m.ConditionsMet()
	if m.IsRunComplete() {
		t.Fatal("Executing should not be run complete")
	}

	// Succeeded = complete
	m.MarkSucceeded()
	if !m.IsRunComplete() {
		t.Fatal("Succeeded should be run complete")
	}
}

// ─── Concurrent Safety ──────────────────────────────────

func TestConcurrentSafety(t *testing.T) {
	m := NewExecutionFSM(1, 100, "test", "schedule", 3, 5, 0)

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.State()
			m.IsRunComplete()
			m.RetryCount()
			m.ConsecutiveFailures()
			m.Transitions()
			m.ContextSnapshot()
			m.IsCooldownExpired()
		}()
	}

	// Drive through a full lifecycle concurrently with reads
	wg.Add(1)
	go func() {
		defer wg.Done()
		m.FireTrigger()
		m.ConditionsMet()
		m.MarkSucceeded()
		m.ResetFromSuccess()
	}()

	wg.Wait()

	// FSM should be in a valid state (not corrupted)
	state := m.State()
	validStates := map[State]bool{
		Idle: true, Evaluating: true, Executing: true,
		Succeeded: true, Partial: true, Failed: true,
		Retrying: true, GaveUp: true, Skipped: true,
		Cooldown: true, Disabled: true,
	}
	if !validStates[state] {
		t.Fatalf("FSM in invalid state after concurrent access: %s", state)
	}
}

// ─── Full Lifecycle Stress ───────────────────────────────

func TestFullLifecycle_FailRetrySucceedCooldown(t *testing.T) {
	m := NewExecutionFSM(1, 100, "complex", "vehicle_state", 2, 5, 1*time.Millisecond)

	// Run: trigger → evaluate → execute → fail → retry → execute → succeed → cooldown → idle
	m.FireTrigger()
	assertState(t, m, Evaluating)

	m.ConditionsMet()
	assertState(t, m, Executing)

	m.MarkFailed()
	assertState(t, m, Failed)

	ok := m.ScheduleRetry()
	if !ok {
		t.Fatal("expected retry")
	}
	assertState(t, m, Retrying)

	m.RetryNow()
	assertState(t, m, Executing)

	m.MarkSucceeded()
	assertState(t, m, Succeeded)

	m.ResetFromSuccess()
	assertState(t, m, Cooldown)

	time.Sleep(5 * time.Millisecond)
	m.CooldownExpired()
	assertState(t, m, Idle)
}

// ─── Helpers ─────────────────────────────────────────────

func assertState(t *testing.T, m *ExecutionFSM, expected State) {
	t.Helper()
	if got := m.State(); got != expected {
		t.Fatalf("expected state %s, got %s", expected, got)
	}
}
