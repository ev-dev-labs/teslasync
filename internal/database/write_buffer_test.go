package database

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestWriteBuffer_Enqueue_Basic(t *testing.T) {
	noop := func(ctx context.Context, item int) error { return nil }
	buf := NewWriteBuffer("test", 100, noop)

	buf.Enqueue(1)
	buf.Enqueue(2)
	buf.Enqueue(3)

	if got := buf.Len(); got != 3 {
		t.Fatalf("Len() = %d, want 3", got)
	}
}

func TestWriteBuffer_Enqueue_DropsOldest(t *testing.T) {
	noop := func(ctx context.Context, item int) error { return nil }
	buf := NewWriteBuffer("test", 10, noop)

	// Fill to capacity
	for i := 0; i < 10; i++ {
		buf.Enqueue(i)
	}
	if got := buf.Len(); got != 10 {
		t.Fatalf("Len() = %d after fill, want 10", got)
	}

	// Enqueue one more — should drop oldest 10% (1 item)
	buf.Enqueue(99)
	if got := buf.Len(); got != 10 {
		t.Fatalf("Len() = %d after overflow, want 10", got)
	}

	// Verify oldest was dropped
	_, dropped := buf.Stats()
	if dropped != 1 {
		t.Fatalf("dropped = %d, want 1", dropped)
	}

	// Verify the buffer contains items 1-9 + 99 (item 0 was dropped)
	buf.mu.Lock()
	if buf.items[0] != 1 {
		t.Errorf("first item = %d, want 1 (item 0 should have been dropped)", buf.items[0])
	}
	if buf.items[len(buf.items)-1] != 99 {
		t.Errorf("last item = %d, want 99", buf.items[len(buf.items)-1])
	}
	buf.mu.Unlock()
}

func TestWriteBuffer_DropsOldest_LargeBuffer(t *testing.T) {
	noop := func(ctx context.Context, item int) error { return nil }
	buf := NewWriteBuffer("test", 100, noop)

	// Fill to capacity
	for i := 0; i < 100; i++ {
		buf.Enqueue(i)
	}

	// Enqueue one more — should drop oldest 10% (10 items)
	buf.Enqueue(999)
	if got := buf.Len(); got != 91 {
		t.Fatalf("Len() = %d after overflow, want 91", got)
	}

	_, dropped := buf.Stats()
	if dropped != 10 {
		t.Fatalf("dropped = %d, want 10", dropped)
	}
}

func TestWriteBuffer_DefaultMaxSize(t *testing.T) {
	noop := func(ctx context.Context, item int) error { return nil }
	buf := NewWriteBuffer("test", 0, noop) // 0 → default 10000

	if buf.maxSize != 10000 {
		t.Fatalf("maxSize = %d, want 10000", buf.maxSize)
	}
}

func TestWriteBuffer_Drain_Success(t *testing.T) {
	var inserted []int
	var mu sync.Mutex
	insertFn := func(ctx context.Context, item int) error {
		mu.Lock()
		inserted = append(inserted, item)
		mu.Unlock()
		return nil
	}

	buf := NewWriteBuffer("test", 100, insertFn)
	buf.Enqueue(10)
	buf.Enqueue(20)
	buf.Enqueue(30)

	buf.Flush(context.Background())

	if got := buf.Len(); got != 0 {
		t.Fatalf("Len() after drain = %d, want 0", got)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(inserted) != 3 {
		t.Fatalf("inserted %d items, want 3", len(inserted))
	}
	if inserted[0] != 10 || inserted[1] != 20 || inserted[2] != 30 {
		t.Fatalf("inserted = %v, want [10, 20, 30]", inserted)
	}
}

func TestWriteBuffer_Drain_RequeuesOnFailure(t *testing.T) {
	callCount := 0
	insertFn := func(ctx context.Context, item int) error {
		callCount++
		if item == 20 {
			return errors.New("db error")
		}
		return nil
	}

	buf := NewWriteBuffer("test", 100, insertFn)
	buf.Enqueue(10)
	buf.Enqueue(20)
	buf.Enqueue(30)

	buf.Flush(context.Background())

	// Item 20 should be re-queued, 10 and 30 inserted
	if got := buf.Len(); got != 1 {
		t.Fatalf("Len() after drain = %d, want 1 (failed item re-queued)", got)
	}

	buf.mu.Lock()
	if buf.items[0] != 20 {
		t.Fatalf("re-queued item = %d, want 20", buf.items[0])
	}
	buf.mu.Unlock()
}

func TestWriteBuffer_Drain_ShortCircuitsOnPersistentFailure(t *testing.T) {
	attempts := 0
	insertFn := func(ctx context.Context, item int) error {
		attempts++
		return errors.New("connection refused")
	}

	buf := NewWriteBuffer("test", 100, insertFn)
	for i := 0; i < 50; i++ {
		buf.Enqueue(i)
	}

	buf.Flush(context.Background())

	// Should short-circuit after 3 consecutive failures
	if attempts != 3 {
		t.Fatalf("attempts = %d, want 3 (short-circuit after 3 consecutive failures)", attempts)
	}

	// All 50 items should be re-queued
	if got := buf.Len(); got != 50 {
		t.Fatalf("Len() after short-circuit = %d, want 50", got)
	}
}

func TestWriteBuffer_Drain_NoShortCircuitAfterSuccess(t *testing.T) {
	// If the first item succeeds but later items fail, no short-circuit should occur
	insertFn := func(ctx context.Context, item int) error {
		if item >= 5 {
			return errors.New("db error")
		}
		return nil
	}

	buf := NewWriteBuffer("test", 100, insertFn)
	for i := 0; i < 10; i++ {
		buf.Enqueue(i)
	}

	buf.Flush(context.Background())

	// Items 0-4 succeed, items 5-9 fail and get re-queued
	if got := buf.Len(); got != 5 {
		t.Fatalf("Len() = %d, want 5", got)
	}
}

func TestWriteBuffer_Drain_EmptyBuffer(t *testing.T) {
	called := false
	insertFn := func(ctx context.Context, item int) error {
		called = true
		return nil
	}

	buf := NewWriteBuffer("test", 100, insertFn)
	buf.Flush(context.Background())

	if called {
		t.Fatal("insertFn should not be called on empty buffer")
	}
}

func TestWriteBuffer_Drain_ContextCancelled(t *testing.T) {
	insertFn := func(ctx context.Context, item int) error {
		return nil
	}

	buf := NewWriteBuffer("test", 100, insertFn)
	for i := 0; i < 10; i++ {
		buf.Enqueue(i)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Already cancelled

	buf.drain(ctx, 1*time.Second)

	// All items should be re-queued since context is already done
	if got := buf.Len(); got != 10 {
		t.Fatalf("Len() = %d, want 10 (context cancelled before processing)", got)
	}
}

func TestWriteBuffer_DrainLoop_StopsOnCancel(t *testing.T) {
	insertFn := func(ctx context.Context, item int) error {
		return nil
	}

	buf := NewWriteBuffer("test", 100, insertFn)
	buf.Enqueue(1)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		buf.DrainLoop(ctx, 50*time.Millisecond)
		close(done)
	}()

	// Let it run one cycle
	time.Sleep(100 * time.Millisecond)
	cancel()

	select {
	case <-done:
		// DrainLoop exited
	case <-time.After(5 * time.Second):
		t.Fatal("DrainLoop did not exit after cancel")
	}

	// Buffer should be drained (final drain on shutdown)
	if got := buf.Len(); got != 0 {
		t.Fatalf("Len() after DrainLoop exit = %d, want 0", got)
	}
}

func TestWriteBuffer_ConcurrentEnqueueAndDrain(t *testing.T) {
	var insertCount atomic.Int64
	insertFn := func(ctx context.Context, item int) error {
		insertCount.Add(1)
		return nil
	}

	buf := NewWriteBuffer("test", 1000, insertFn)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start drain loop
	done := make(chan struct{})
	go func() {
		buf.DrainLoop(ctx, 10*time.Millisecond)
		close(done)
	}()

	// Concurrently enqueue from multiple goroutines
	var wg sync.WaitGroup
	for g := 0; g < 10; g++ {
		wg.Add(1)
		go func(offset int) {
			defer wg.Done()
			for i := 0; i < 100; i++ {
				buf.Enqueue(offset*100 + i)
				time.Sleep(time.Millisecond)
			}
		}(g)
	}

	wg.Wait()
	// Let drain catch up
	time.Sleep(200 * time.Millisecond)
	cancel()
	<-done

	// All 1000 items should have been inserted (no failures)
	total := insertCount.Load()
	remaining := buf.Len()
	if total+int64(remaining) != 1000 {
		t.Fatalf("inserted(%d) + remaining(%d) = %d, want 1000", total, remaining, total+int64(remaining))
	}
}

func TestWriteBuffer_MaxSizeRespectedDuringRequeue(t *testing.T) {
	failAll := func(ctx context.Context, item int) error {
		return errors.New("always fail")
	}

	buf := NewWriteBuffer("test", 10, failAll)

	// Fill buffer
	for i := 0; i < 10; i++ {
		buf.Enqueue(i)
	}

	// Drain — all fail, all get re-queued
	buf.Flush(context.Background())

	// Enqueue more while buffer was being drained
	// (simulate new items arriving during drain)
	// Re-queued items should fit within maxSize
	if got := buf.Len(); got > 10 {
		t.Fatalf("Len() = %d, exceeds maxSize 10", got)
	}
}
