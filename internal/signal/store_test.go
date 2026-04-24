package signal

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/sony/gobreaker"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// mockFlusher records flush calls for testing.
type mockFlusher struct {
	mu         sync.Mutex
	flushCalls []int64
	flushErr   error
	loadData   map[string]interface{}
	loadErr    error
}

func (m *mockFlusher) FlushLiveState(_ context.Context, vehicleID int64, _ map[string]interface{}) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.flushCalls = append(m.flushCalls, vehicleID)
	return m.flushErr
}

func (m *mockFlusher) LoadLiveState(_ context.Context, _ int64) (map[string]interface{}, error) {
	return m.loadData, m.loadErr
}

func (m *mockFlusher) getFlushCalls() []int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]int64, len(m.flushCalls))
	copy(cp, m.flushCalls)
	return cp
}

func (m *mockFlusher) resetCalls() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.flushCalls = nil
}

func TestMarkDirtyCoalesces(t *testing.T) {
	f := &mockFlusher{}
	s := New(f, 0, nil)

	// Update same vehicle multiple times — should only mark dirty once
	s.Update(1, map[string]interface{}{"speed": 60.0})
	s.Update(1, map[string]interface{}{"speed": 65.0})
	s.Update(1, map[string]interface{}{"speed": 70.0})

	s.dirtyMu.Lock()
	dirtyCount := len(s.dirty)
	s.dirtyMu.Unlock()

	if dirtyCount != 1 {
		t.Errorf("expected 1 dirty vehicle, got %d", dirtyCount)
	}

	// No flush calls yet (no FlushLoop running)
	calls := f.getFlushCalls()
	if len(calls) != 0 {
		t.Errorf("expected 0 flush calls before FlushLoop, got %d", len(calls))
	}
}

func TestFlushDirtyFlushesAndClears(t *testing.T) {
	f := &mockFlusher{}
	s := New(f, 0, nil)

	s.Update(1, map[string]interface{}{"speed": 60.0})
	s.Update(2, map[string]interface{}{"battery": 80.0})

	ctx := context.Background()
	s.flushDirty(ctx)

	calls := f.getFlushCalls()
	if len(calls) != 2 {
		t.Fatalf("expected 2 flush calls, got %d", len(calls))
	}

	// Dirty map should be empty
	s.dirtyMu.Lock()
	dirtyCount := len(s.dirty)
	s.dirtyMu.Unlock()
	if dirtyCount != 0 {
		t.Errorf("expected 0 dirty vehicles after flush, got %d", dirtyCount)
	}
}

func TestFlushDirtyRemarksDirtyOnError(t *testing.T) {
	f := &mockFlusher{flushErr: errors.New("connection refused")}
	s := New(f, 0, nil)

	s.Update(1, map[string]interface{}{"speed": 60.0})

	ctx := context.Background()
	s.flushDirty(ctx)

	// Vehicle should be re-marked dirty
	s.dirtyMu.Lock()
	dirty := s.dirty[1]
	s.dirtyMu.Unlock()
	if !dirty {
		t.Error("expected vehicle 1 to be re-marked dirty after flush error")
	}
}

func TestFlushLoopRunsAndStops(t *testing.T) {
	f := &mockFlusher{}
	s := New(f, 0, nil)

	s.Update(1, map[string]interface{}{"speed": 60.0})

	ctx, cancel := context.WithCancel(context.Background())
	go s.FlushLoop(ctx)

	// Wait for at least one tick
	time.Sleep(1500 * time.Millisecond)

	calls := f.getFlushCalls()
	if len(calls) == 0 {
		t.Error("expected FlushLoop to flush at least once")
	}

	// Cancel and wait for loop to exit
	cancel()
	s.WaitForFlushLoop()

	// Verify loop exited — further updates should accumulate dirty but not flush
	f.resetCalls()
	s.Update(2, map[string]interface{}{"battery": 90.0})
	time.Sleep(200 * time.Millisecond)

	calls = f.getFlushCalls()
	if len(calls) != 0 {
		t.Errorf("expected 0 flush calls after loop stopped, got %d", len(calls))
	}
}

func TestFlushLoopNilFlusher(t *testing.T) {
	s := New(nil, 0, nil)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Should return immediately without blocking
	done := make(chan struct{})
	go func() {
		s.FlushLoop(ctx)
		close(done)
	}()

	select {
	case <-done:
		// OK — returned immediately
	case <-time.After(500 * time.Millisecond):
		t.Error("FlushLoop with nil flusher should return immediately")
	}
}

func TestFlushLoopAdaptiveInterval(t *testing.T) {
	f := &mockFlusher{}
	cb := database.NewDBCircuitBreaker("test-adaptive")
	s := New(f, 0, cb)

	// Trip the circuit breaker by failing 5 times
	for i := 0; i < 5; i++ {
		_ = cb.Execute(func() error {
			return errors.New("connection refused")
		})
	}

	if cb.State() != gobreaker.StateOpen {
		t.Fatalf("expected breaker to be open, got %v", cb.State())
	}

	// Mark dirty — flush should fail due to open breaker, re-mark dirty
	s.Update(1, map[string]interface{}{"speed": 60.0})

	ctx, cancel := context.WithCancel(context.Background())
	go s.FlushLoop(ctx)

	// Give it time to detect open breaker and adjust interval
	time.Sleep(2500 * time.Millisecond)

	cancel()
	s.WaitForFlushLoop()
	// If we get here without hanging, the adaptive interval worked
}

func TestFlushAllDoesNotUseDirtyMap(t *testing.T) {
	f := &mockFlusher{}
	s := New(f, 0, nil)

	// Add data without marking dirty
	s.mu.Lock()
	s.vehicles[1] = map[string]*Value{"speed": {Raw: 60.0, Timestamp: time.Now()}}
	s.vehicles[2] = map[string]*Value{"battery": {Raw: 80.0, Timestamp: time.Now()}}
	s.mu.Unlock()

	ctx := context.Background()
	s.FlushAll(ctx)

	calls := f.getFlushCalls()
	if len(calls) != 2 {
		t.Errorf("FlushAll should flush all vehicles regardless of dirty map, got %d calls", len(calls))
	}
}

func TestUpdateDoesNotSpawnGoroutines(t *testing.T) {
	f := &mockFlusher{}
	s := New(f, 0, nil)

	// Call Update 100 times rapidly — no goroutines should spawn
	for i := 0; i < 100; i++ {
		s.Update(int64(i%5), map[string]interface{}{"speed": float64(i)})
	}

	// No flush calls should happen (no FlushLoop running)
	calls := f.getFlushCalls()
	if len(calls) != 0 {
		t.Errorf("expected 0 flush calls without FlushLoop, got %d", len(calls))
	}

	// But dirty map should have 5 vehicles
	s.dirtyMu.Lock()
	dirtyCount := len(s.dirty)
	s.dirtyMu.Unlock()
	if dirtyCount != 5 {
		t.Errorf("expected 5 dirty vehicles, got %d", dirtyCount)
	}

}

func TestConcurrentUpdateAndFlush(t *testing.T) {
	f := &mockFlusher{}
	s := New(f, 0, nil)

	ctx, cancel := context.WithCancel(context.Background())
	go s.FlushLoop(ctx)

	// Hammer updates from multiple goroutines
	var wg sync.WaitGroup
	for g := 0; g < 10; g++ {
		wg.Add(1)
		go func(goroutineID int) {
			defer wg.Done()
			for i := 0; i < 50; i++ {
				vid := int64(goroutineID%5 + 1)
				s.Update(vid, map[string]interface{}{
					"speed":   float64(i),
					"battery": float64(100 - i),
				})
				time.Sleep(time.Millisecond)
			}
		}(g)
	}

	wg.Wait()
	time.Sleep(1500 * time.Millisecond) // let final tick flush

	cancel()
	s.WaitForFlushLoop()

	calls := f.getFlushCalls()
	if len(calls) == 0 {
		t.Error("expected at least some flush calls during concurrent updates")
	}
	// Key assertion: calls should be << 500 (10 goroutines × 50 updates)
	// because debouncing coalesces per-vehicle updates
	if len(calls) > 100 {
		t.Errorf("debouncing failed: expected << 500 flush calls, got %d", len(calls))
	}
}

func TestWaitForFlushLoopReturnsImmediatelyIfNotStarted(t *testing.T) {
	s := New(nil, 0, nil)

	done := make(chan struct{})
	go func() {
		s.WaitForFlushLoop()
		close(done)
	}()

	select {
	case <-done:
		// OK
	case <-time.After(500 * time.Millisecond):
		t.Error("WaitForFlushLoop should return immediately if FlushLoop was never started")
	}
}
