package safety

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"
)

// ─── Mock Auto-Disabler ────────────────────────────────

type mockDisabler struct {
	mu       sync.Mutex
	disabled map[int64]string // id → reason
	err      error
}

func newMockDisabler() *mockDisabler {
	return &mockDisabler{disabled: make(map[int64]string)}
}

func (m *mockDisabler) SetAutoDisabled(_ context.Context, id int64, reason string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return m.err
	}
	m.disabled[id] = reason
	return nil
}

func (m *mockDisabler) wasDisabled(id int64) (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	reason, ok := m.disabled[id]
	return reason, ok
}

// ─── Helpers ────────────────────────────────────────────

func fixedTime() time.Time {
	return time.Date(2026, 4, 18, 12, 0, 0, 0, time.UTC)
}

func newTestDetector(opts ...LoopDetectorOption) *LoopDetector {
	ld := NewLoopDetector(opts...)
	ld.nowFunc = fixedTime
	return ld
}

// ─── CycleError Tests ──────────────────────────────────

func TestCycleError_Message(t *testing.T) {
	err := &CycleError{Path: []int64{1, 2, 3, 1}}
	expected := "automation cycle detected: 1 → 2 → 3 → 1"
	if err.Error() != expected {
		t.Errorf("got %q, want %q", err.Error(), expected)
	}
}

func TestCycleError_Is(t *testing.T) {
	err := &CycleError{Path: []int64{1, 2, 1}}
	if !errors.Is(err, ErrCycleDetected) {
		t.Error("CycleError should match ErrCycleDetected via errors.Is")
	}
}

func TestCycleError_WrappedIs(t *testing.T) {
	inner := &CycleError{Path: []int64{1, 2, 1}}
	wrapped := fmt.Errorf("execution failed: %w", inner)
	if !errors.Is(wrapped, ErrCycleDetected) {
		t.Error("wrapped CycleError should match ErrCycleDetected via errors.Is")
	}
}

func TestCycleError_TwoElement(t *testing.T) {
	err := &CycleError{Path: []int64{5, 5}}
	expected := "automation cycle detected: 5 → 5"
	if err.Error() != expected {
		t.Errorf("got %q, want %q", err.Error(), expected)
	}
}

// ─── CheckCycle Tests ──────────────────────────────────

func TestCheckCycle_NoChain(t *testing.T) {
	ld := newTestDetector()
	ctx, err := ld.CheckCycle(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	chain := ChainFromContext(ctx)
	if len(chain) != 1 || chain[0] != 1 {
		t.Errorf("expected chain [1], got %v", chain)
	}
}

func TestCheckCycle_LinearChain(t *testing.T) {
	ld := newTestDetector()
	ctx := context.Background()

	for _, id := range []int64{1, 2, 3, 4} {
		var err error
		ctx, err = ld.CheckCycle(ctx, id)
		if err != nil {
			t.Fatalf("unexpected error on id %d: %v", id, err)
		}
	}

	chain := ChainFromContext(ctx)
	expected := []int64{1, 2, 3, 4}
	if len(chain) != len(expected) {
		t.Fatalf("chain length %d, want %d", len(chain), len(expected))
	}
	for i := range expected {
		if chain[i] != expected[i] {
			t.Errorf("chain[%d]=%d, want %d", i, chain[i], expected[i])
		}
	}
}

func TestCheckCycle_DirectCycle(t *testing.T) {
	ld := newTestDetector()
	ctx, _ := ld.CheckCycle(context.Background(), 1)

	_, err := ld.CheckCycle(ctx, 1)
	if err == nil {
		t.Fatal("expected cycle error, got nil")
	}
	if !errors.Is(err, ErrCycleDetected) {
		t.Errorf("expected ErrCycleDetected, got %v", err)
	}

	var cycleErr *CycleError
	if !errors.As(err, &cycleErr) {
		t.Fatal("expected *CycleError")
	}
	if len(cycleErr.Path) != 2 || cycleErr.Path[0] != 1 || cycleErr.Path[1] != 1 {
		t.Errorf("expected path [1, 1], got %v", cycleErr.Path)
	}
}

func TestCheckCycle_IndirectCycle(t *testing.T) {
	ld := newTestDetector()
	ctx := context.Background()

	ctx, _ = ld.CheckCycle(ctx, 10)
	ctx, _ = ld.CheckCycle(ctx, 20)
	ctx, _ = ld.CheckCycle(ctx, 30)

	_, err := ld.CheckCycle(ctx, 10)
	if !errors.Is(err, ErrCycleDetected) {
		t.Fatalf("expected cycle, got %v", err)
	}

	var cycleErr *CycleError
	errors.As(err, &cycleErr)
	expected := []int64{10, 20, 30, 10}
	if len(cycleErr.Path) != len(expected) {
		t.Fatalf("path length %d, want %d", len(cycleErr.Path), len(expected))
	}
	for i := range expected {
		if cycleErr.Path[i] != expected[i] {
			t.Errorf("path[%d]=%d, want %d", i, cycleErr.Path[i], expected[i])
		}
	}
}

func TestCheckCycle_SiblingBranchesIndependent(t *testing.T) {
	// A→B and A→C should both succeed — siblings don't interfere.
	ld := newTestDetector()
	parentCtx, _ := ld.CheckCycle(context.Background(), 1)

	ctxB, errB := ld.CheckCycle(parentCtx, 2)
	ctxC, errC := ld.CheckCycle(parentCtx, 3)

	if errB != nil {
		t.Fatalf("branch B error: %v", errB)
	}
	if errC != nil {
		t.Fatalf("branch C error: %v", errC)
	}

	chainB := ChainFromContext(ctxB)
	chainC := ChainFromContext(ctxC)

	if len(chainB) != 2 || chainB[0] != 1 || chainB[1] != 2 {
		t.Errorf("branch B chain: %v, want [1, 2]", chainB)
	}
	if len(chainC) != 2 || chainC[0] != 1 || chainC[1] != 3 {
		t.Errorf("branch C chain: %v, want [1, 3]", chainC)
	}
}

func TestCheckCycle_SameIDInDifferentBranches(t *testing.T) {
	// A→B and A→C→B: B appears in both branches, but there's no cycle
	// because B→B doesn't happen.
	ld := newTestDetector()
	rootCtx, _ := ld.CheckCycle(context.Background(), 1)

	// Branch 1: A → B
	_, errBranch1 := ld.CheckCycle(rootCtx, 2)
	if errBranch1 != nil {
		t.Fatalf("branch 1 error: %v", errBranch1)
	}

	// Branch 2: A → C → B
	ctxC, _ := ld.CheckCycle(rootCtx, 3)
	_, errBranch2 := ld.CheckCycle(ctxC, 2)
	if errBranch2 != nil {
		t.Fatalf("branch 2 error: %v", errBranch2)
	}
}

func TestCheckCycle_EmptyContext(t *testing.T) {
	_ = newTestDetector()
	chain := ChainFromContext(context.Background())
	if chain != nil {
		t.Errorf("expected nil chain from empty context, got %v", chain)
	}
}

// ─── ChainFromContext Tests ────────────────────────────

func TestChainFromContext_NilContext(t *testing.T) {
	chain := ChainFromContext(context.Background())
	if chain != nil {
		t.Errorf("expected nil, got %v", chain)
	}
}

func TestChainDepth_Empty(t *testing.T) {
	depth := ChainDepth(context.Background())
	if depth != 0 {
		t.Errorf("expected 0, got %d", depth)
	}
}

func TestChainDepth_AfterEntries(t *testing.T) {
	ld := newTestDetector()
	ctx := context.Background()
	ctx, _ = ld.CheckCycle(ctx, 1)
	ctx, _ = ld.CheckCycle(ctx, 2)
	ctx, _ = ld.CheckCycle(ctx, 3)

	if d := ChainDepth(ctx); d != 3 {
		t.Errorf("expected depth 3, got %d", d)
	}
}

// ─── RecordFire / Rapid-Fire Tests ─────────────────────

func TestRecordFire_UnderThreshold(t *testing.T) {
	ld := newTestDetector()

	for i := 0; i < DefaultMaxFires; i++ {
		result := ld.RecordFire(1)
		if result.Exceeded {
			t.Fatalf("fire %d should not exceed threshold %d", i+1, DefaultMaxFires)
		}
		if result.Count != i+1 {
			t.Errorf("fire %d: count=%d, want %d", i+1, result.Count, i+1)
		}
	}
}

func TestRecordFire_ExceedsThreshold(t *testing.T) {
	ld := newTestDetector()

	// Fire exactly maxFires (not exceeded yet).
	for i := 0; i < DefaultMaxFires; i++ {
		ld.RecordFire(1)
	}

	// The next fire exceeds.
	result := ld.RecordFire(1)
	if !result.Exceeded {
		t.Errorf("fire %d should exceed threshold %d", DefaultMaxFires+1, DefaultMaxFires)
	}
	if result.Count != DefaultMaxFires+1 {
		t.Errorf("count=%d, want %d", result.Count, DefaultMaxFires+1)
	}
	if result.Threshold != DefaultMaxFires {
		t.Errorf("threshold=%d, want %d", result.Threshold, DefaultMaxFires)
	}
}

func TestRecordFire_DifferentAutomationsIndependent(t *testing.T) {
	ld := newTestDetector()

	for i := 0; i < DefaultMaxFires+1; i++ {
		ld.RecordFire(1)
	}

	// Automation 2 should be fresh.
	result := ld.RecordFire(2)
	if result.Exceeded {
		t.Error("automation 2 should not be affected by automation 1")
	}
	if result.Count != 1 {
		t.Errorf("count=%d, want 1", result.Count)
	}
}

func TestRecordFire_PrunesExpiredTimestamps(t *testing.T) {
	currentTime := fixedTime()
	ld := newTestDetector()
	ld.nowFunc = func() time.Time { return currentTime }

	// Fire 5 times at t=0.
	for i := 0; i < DefaultMaxFires; i++ {
		ld.RecordFire(1)
	}

	// Advance past window.
	currentTime = currentTime.Add(2 * DefaultWindow)

	// This fire should see count=1 (old ones pruned).
	result := ld.RecordFire(1)
	if result.Count != 1 {
		t.Errorf("count=%d after pruning, want 1", result.Count)
	}
	if result.Exceeded {
		t.Error("should not be exceeded after old entries are pruned")
	}
}

func TestRecordFire_CustomThreshold(t *testing.T) {
	ld := newTestDetector(WithMaxFires(2))

	ld.RecordFire(1) // count=1
	ld.RecordFire(1) // count=2

	result := ld.RecordFire(1) // count=3 > 2
	if !result.Exceeded {
		t.Error("should exceed custom threshold of 2")
	}
	if result.Threshold != 2 {
		t.Errorf("threshold=%d, want 2", result.Threshold)
	}
}

func TestRecordFire_CustomWindow(t *testing.T) {
	currentTime := fixedTime()
	ld := newTestDetector(WithWindow(10 * time.Second))
	ld.nowFunc = func() time.Time { return currentTime }

	// Fire 5 times.
	for i := 0; i < DefaultMaxFires; i++ {
		ld.RecordFire(1)
	}

	// Advance 11 seconds (past 10s window).
	currentTime = currentTime.Add(11 * time.Second)

	result := ld.RecordFire(1)
	if result.Count != 1 {
		t.Errorf("count=%d, want 1 after window expiry", result.Count)
	}
}

// ─── CheckRapidFire Tests ──────────────────────────────

func TestCheckRapidFire_ReadOnly(t *testing.T) {
	ld := newTestDetector()

	// Record some fires.
	for i := 0; i < 3; i++ {
		ld.RecordFire(1)
	}

	// Check doesn't add another fire.
	result := ld.CheckRapidFire(1)
	if result.Count != 3 {
		t.Errorf("count=%d, want 3", result.Count)
	}

	// Second check still shows 3.
	result2 := ld.CheckRapidFire(1)
	if result2.Count != 3 {
		t.Errorf("count=%d after second check, want 3", result2.Count)
	}
}

func TestCheckRapidFire_NoFires(t *testing.T) {
	ld := newTestDetector()
	result := ld.CheckRapidFire(99)
	if result.Exceeded {
		t.Error("should not be exceeded with no fires")
	}
	if result.Count != 0 {
		t.Errorf("count=%d, want 0", result.Count)
	}
}

// ─── BeforeExecute Tests ───────────────────────────────

func TestBeforeExecute_Clean(t *testing.T) {
	ld := newTestDetector()
	ctx, err := ld.BeforeExecute(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	chain := ChainFromContext(ctx)
	if len(chain) != 1 || chain[0] != 1 {
		t.Errorf("expected chain [1], got %v", chain)
	}
}

func TestBeforeExecute_CycleBlocked(t *testing.T) {
	ld := newTestDetector()
	ctx, _ := ld.BeforeExecute(context.Background(), 1)

	_, err := ld.BeforeExecute(ctx, 1)
	if !errors.Is(err, ErrCycleDetected) {
		t.Errorf("expected ErrCycleDetected, got %v", err)
	}
}

func TestBeforeExecute_RapidFireBlocked(t *testing.T) {
	disabler := newMockDisabler()
	ld := newTestDetector(WithDisabler(disabler), WithMaxFires(3))

	// First 3 fires succeed (fresh context each time — no cycle).
	for i := 0; i < 3; i++ {
		_, err := ld.BeforeExecute(context.Background(), 42)
		if err != nil {
			t.Fatalf("fire %d: unexpected error: %v", i+1, err)
		}
	}

	// 4th fire is blocked.
	_, err := ld.BeforeExecute(context.Background(), 42)
	if err == nil {
		t.Fatal("expected rapid-fire error, got nil")
	}
	if errors.Is(err, ErrCycleDetected) {
		t.Error("should be rapid-fire error, not cycle error")
	}

	// Automation should be auto-disabled.
	reason, ok := disabler.wasDisabled(42)
	if !ok {
		t.Fatal("automation 42 should have been auto-disabled")
	}
	if reason == "" {
		t.Error("disable reason should not be empty")
	}
}

func TestBeforeExecute_RapidFireWithoutDisabler(t *testing.T) {
	ld := newTestDetector(WithMaxFires(2))

	ld.BeforeExecute(context.Background(), 1)
	ld.BeforeExecute(context.Background(), 1)

	_, err := ld.BeforeExecute(context.Background(), 1)
	if err == nil {
		t.Fatal("expected error for rapid-fire without disabler")
	}
	// Should not panic when disabler is nil.
}

func TestBeforeExecute_DisablerError(t *testing.T) {
	disabler := newMockDisabler()
	disabler.err = fmt.Errorf("database down")
	ld := newTestDetector(WithDisabler(disabler), WithMaxFires(1))

	ld.BeforeExecute(context.Background(), 1)

	// Should still return the rapid-fire error even if disable fails.
	_, err := ld.BeforeExecute(context.Background(), 1)
	if err == nil {
		t.Fatal("expected rapid-fire error despite disabler failure")
	}
}

func TestBeforeExecute_CycleCheckedBeforeRapidFire(t *testing.T) {
	// If a cycle exists, we should get CycleError even if rapid-fire also applies.
	ld := newTestDetector(WithMaxFires(100))

	ctx, _ := ld.BeforeExecute(context.Background(), 1)
	_, err := ld.BeforeExecute(ctx, 1)

	if !errors.Is(err, ErrCycleDetected) {
		t.Errorf("cycle should take priority, got: %v", err)
	}
}

func TestBeforeExecute_ChainPropagated(t *testing.T) {
	ld := newTestDetector()

	ctx1, _ := ld.BeforeExecute(context.Background(), 10)
	ctx2, _ := ld.BeforeExecute(ctx1, 20)
	ctx3, _ := ld.BeforeExecute(ctx2, 30)

	chain := ChainFromContext(ctx3)
	expected := []int64{10, 20, 30}
	if len(chain) != 3 {
		t.Fatalf("chain length=%d, want 3", len(chain))
	}
	for i := range expected {
		if chain[i] != expected[i] {
			t.Errorf("chain[%d]=%d, want %d", i, chain[i], expected[i])
		}
	}
}

// ─── Reset Tests ───────────────────────────────────────

func TestReset_ClearsAllWindows(t *testing.T) {
	ld := newTestDetector()

	for i := 0; i < DefaultMaxFires+1; i++ {
		ld.RecordFire(1)
		ld.RecordFire(2)
	}

	ld.Reset()

	result1 := ld.CheckRapidFire(1)
	result2 := ld.CheckRapidFire(2)

	if result1.Count != 0 || result2.Count != 0 {
		t.Errorf("after reset: automation 1 count=%d, automation 2 count=%d", result1.Count, result2.Count)
	}
}

func TestResetAutomation_ClearsSingle(t *testing.T) {
	ld := newTestDetector()

	for i := 0; i < 3; i++ {
		ld.RecordFire(1)
		ld.RecordFire(2)
	}

	ld.ResetAutomation(1)

	result1 := ld.CheckRapidFire(1)
	result2 := ld.CheckRapidFire(2)

	if result1.Count != 0 {
		t.Errorf("automation 1 should be cleared, count=%d", result1.Count)
	}
	if result2.Count != 3 {
		t.Errorf("automation 2 should be untouched, count=%d", result2.Count)
	}
}

// ─── Concurrency Tests ─────────────────────────────────

func TestRecordFire_ConcurrentSafe(t *testing.T) {
	ld := newTestDetector(WithMaxFires(10000))

	const goroutines = 50
	const firesPerGoroutine = 100

	var wg sync.WaitGroup
	wg.Add(goroutines)

	for g := 0; g < goroutines; g++ {
		go func() {
			defer wg.Done()
			for i := 0; i < firesPerGoroutine; i++ {
				ld.RecordFire(1)
			}
		}()
	}

	wg.Wait()

	result := ld.CheckRapidFire(1)
	expected := goroutines * firesPerGoroutine
	if result.Count != expected {
		t.Errorf("concurrent count=%d, want %d", result.Count, expected)
	}
}

func TestCheckCycle_ConcurrentBranches(t *testing.T) {
	ld := newTestDetector()
	rootCtx, _ := ld.CheckCycle(context.Background(), 1)

	const branches = 100
	errs := make(chan error, branches)

	var wg sync.WaitGroup
	wg.Add(branches)

	for i := 0; i < branches; i++ {
		go func(id int64) {
			defer wg.Done()
			_, err := ld.CheckCycle(rootCtx, id)
			if err != nil {
				errs <- err
			}
		}(int64(i + 100))
	}

	wg.Wait()
	close(errs)

	for err := range errs {
		t.Errorf("unexpected error in concurrent branch: %v", err)
	}
}

// ─── Edge Cases ────────────────────────────────────────

func TestRecordFire_ZeroThreshold(t *testing.T) {
	// maxFires=0 means first fire exceeds.
	ld := newTestDetector(WithMaxFires(0))
	result := ld.RecordFire(1)
	if !result.Exceeded {
		t.Error("with maxFires=0, first fire should exceed")
	}
}

func TestCheckCycle_LongChain(t *testing.T) {
	ld := newTestDetector()
	ctx := context.Background()

	const depth = 100
	for i := int64(1); i <= depth; i++ {
		var err error
		ctx, err = ld.CheckCycle(ctx, i)
		if err != nil {
			t.Fatalf("unexpected error at depth %d: %v", i, err)
		}
	}

	if d := ChainDepth(ctx); d != depth {
		t.Errorf("depth=%d, want %d", d, depth)
	}

	// Adding ID 1 again should cycle.
	_, err := ld.CheckCycle(ctx, 1)
	if !errors.Is(err, ErrCycleDetected) {
		t.Error("expected cycle at end of long chain")
	}
}

func TestRecordFire_BoundaryAtExactThreshold(t *testing.T) {
	ld := newTestDetector(WithMaxFires(3))

	// Fire exactly 3 times (at threshold, not exceeded — count <= maxFires).
	for i := 0; i < 3; i++ {
		result := ld.RecordFire(1)
		if result.Exceeded {
			t.Fatalf("fire %d should not exceed threshold 3", i+1)
		}
	}

	// Fire 4th (count=4 > 3 → exceeded).
	result := ld.RecordFire(1)
	if !result.Exceeded {
		t.Error("4th fire should exceed threshold of 3")
	}
}
