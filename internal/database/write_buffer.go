package database

import (
	"context"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/rs/zerolog/log"
)

// WriteBuffer holds failed DB writes and retries them periodically.
// Bounded to prevent unbounded memory growth during extended outages.
type WriteBuffer[T any] struct {
	mu       sync.Mutex
	items    []T
	maxSize  int
	name     string
	insertFn func(ctx context.Context, item T) error

	// Stats (accessed under mu)
	totalDropped int64
}

// NewWriteBuffer creates a bounded write buffer.
// name is used for logging (e.g. "drive_telemetry", "charge_telemetry").
// maxSize caps the buffer — oldest items are dropped when full.
func NewWriteBuffer[T any](name string, maxSize int, insertFn func(ctx context.Context, item T) error) *WriteBuffer[T] {
	if maxSize <= 0 {
		maxSize = 10000
	}
	return &WriteBuffer[T]{
		items:    make([]T, 0, 256),
		maxSize:  maxSize,
		name:     name,
		insertFn: insertFn,
	}
}

// Enqueue adds a failed item to the buffer for later retry.
// If the buffer is full, the oldest items are dropped.
func (b *WriteBuffer[T]) Enqueue(item T) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.items) >= b.maxSize {
		// Drop oldest 10% to make room (batch eviction avoids per-item overhead)
		dropCount := b.maxSize / 10
		if dropCount < 1 {
			dropCount = 1
		}
		b.totalDropped += int64(dropCount)
		metrics.WriteBufferDroppedTotal.WithLabelValues(b.name).Add(float64(dropCount))
		log.Warn().Str("buffer", b.name).Int("dropped", dropCount).Int64("total_dropped", b.totalDropped).
			Msg("write buffer full, dropping oldest items")
		b.items = b.items[dropCount:]
	}
	b.items = append(b.items, item)
}

// Len returns the current buffer size.
func (b *WriteBuffer[T]) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.items)
}

// BufferStats holds current write buffer pressure information.
type BufferStats struct {
	Name     string `json:"name"`
	Size     int    `json:"size"`
	Capacity int    `json:"capacity"`
	Dropped  int64  `json:"total_dropped"`
}

// Stats returns current buffer pressure info.
func (b *WriteBuffer[T]) Stats() BufferStats {
	b.mu.Lock()
	defer b.mu.Unlock()
	return BufferStats{
		Name:     b.name,
		Size:     len(b.items),
		Capacity: b.maxSize,
		Dropped:  b.totalDropped,
	}
}

// DrainLoop periodically retries buffered items. Call in a goroutine.
// Stops when ctx is cancelled after a final drain attempt.
func (b *WriteBuffer[T]) DrainLoop(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			// Final drain attempt on shutdown
			b.drain(context.Background(), 30*time.Second)
			return
		case <-ticker.C:
			b.drain(ctx, 10*time.Second)
		}
	}
}

// Flush synchronously drains all buffered items. Use during shutdown
// to ensure no data is lost after the drain loop has stopped.
func (b *WriteBuffer[T]) Flush(ctx context.Context) {
	b.drain(ctx, 30*time.Second)
}

// drain attempts to insert all buffered items. Items that fail again
// are kept in the buffer for the next cycle.
func (b *WriteBuffer[T]) drain(ctx context.Context, timeout time.Duration) {
	b.mu.Lock()
	if len(b.items) == 0 {
		b.mu.Unlock()
		return
	}
	// Take all items — releases lock so Enqueue doesn't block during inserts
	items := b.items
	b.items = make([]T, 0, cap(items))
	b.mu.Unlock()

	drainCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var failed []T
	inserted := 0
	consecutiveFails := 0

	for i, item := range items {
		if drainCtx.Err() != nil {
			// Context expired — re-queue remaining unprocessed items
			failed = append(failed, items[i:]...)
			break
		}
		if err := b.insertFn(drainCtx, item); err != nil {
			failed = append(failed, item)
			consecutiveFails++
			// If first 3 items all fail, DB is likely still down — re-queue everything
			if inserted == 0 && consecutiveFails >= 3 {
				failed = append(failed, items[i+1:]...)
				break
			}
		} else {
			inserted++
			consecutiveFails = 0
		}
	}

	if inserted > 0 {
		log.Info().Str("buffer", b.name).Int("inserted", inserted).Int("remaining", len(failed)).
			Msg("write buffer drained")
	}

	if len(failed) > 0 {
		b.mu.Lock()
		// Prepend failed items (they're older) — respect maxSize
		total := len(failed) + len(b.items)
		if total > b.maxSize {
			excess := total - b.maxSize
			if excess >= len(failed) {
				// All failed items would be dropped — keep only new enqueues
				failed = nil
			} else {
				b.totalDropped += int64(excess)
				metrics.WriteBufferDroppedTotal.WithLabelValues(b.name).Add(float64(excess))
				failed = failed[excess:]
			}
		}
		if len(failed) > 0 {
			b.items = append(failed, b.items...)
		}
		b.mu.Unlock()
	}
}
