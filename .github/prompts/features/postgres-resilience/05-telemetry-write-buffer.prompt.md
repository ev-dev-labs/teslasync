---
description: "Postgres resilience: in-memory buffer for telemetry writes during DB outages"
---

# Postgres Resilience: Telemetry Write Buffer

## Problem

During Postgres outages, drive and charge telemetry readings are permanently lost.
The `TelemetrySessionTracker` calls `driveTelRepo.Insert()` and `chargeTelRepo.Insert()`
directly — if the insert fails, the reading is logged and dropped. Unlike signal
history (which prompt 02 gives a re-queue buffer), telemetry has no fallback.

Each telemetry reading contains rich sensor data (speed, power, battery, tires,
temperature, location) that cannot be reconstructed after the fact.

## Current State

```
internal/api/telemetry_sessions.go:949-951
```
```go
if err := t.driveTelRepo.Insert(ctx, reading); err != nil {
    log.Error().Err(err).Int64("drive_id", drive.DriveID).Msg("telemetry: failed to insert drive telemetry reading")
    // ← reading permanently lost
}
```

```
internal/api/telemetry_sessions.go:1525-1527
```
```go
if err := t.chargeTelRepo.Insert(ctx, reading); err != nil {
    log.Error().Err(err).Int64("session_id", charge.SessionID).Msg("telemetry: failed to insert charge telemetry reading")
    // ← reading permanently lost
}
```

### Memory Budget

- 1 drive telemetry reading ≈ 300 bytes (30+ nullable float/bool/int fields)
- 1 charge telemetry reading ≈ 200 bytes (20+ fields)
- 5 vehicles × 1 reading/sec × 30 min outage = 9,000 readings ≈ **2.7 MB**
- Buffer cap at 10,000 rows per type → worst case **~5 MB** — negligible

## Task

### Step 1: Create a Generic Write Buffer

Create `internal/database/write_buffer.go`:

A bounded ring buffer that holds failed writes and retries them on a timer.
Generic over the reading type so it works for both drive and charge telemetry.

```go
package database

import (
    "context"
    "sync"
    "time"

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
// If the buffer is full, the oldest item is dropped.
func (b *WriteBuffer[T]) Enqueue(item T) {
    b.mu.Lock()
    defer b.mu.Unlock()
    if len(b.items) >= b.maxSize {
        // Drop oldest 10% to make room (batch eviction avoids per-item overhead)
        dropCount := b.maxSize / 10
        if dropCount < 1 {
            dropCount = 1
        }
        log.Warn().Str("buffer", b.name).Int("dropped", dropCount).Msg("write buffer full, dropping oldest items")
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

// drain attempts to insert all buffered items. Items that fail again
// are kept in the buffer for the next cycle.
func (b *WriteBuffer[T]) drain(ctx context.Context, timeout time.Duration) {
    b.mu.Lock()
    if len(b.items) == 0 {
        b.mu.Unlock()
        return
    }
    // Take all items
    items := b.items
    b.items = make([]T, 0, cap(items))
    b.mu.Unlock()

    drainCtx, cancel := context.WithTimeout(ctx, timeout)
    defer cancel()

    var failed []T
    inserted := 0
    for _, item := range items {
        if drainCtx.Err() != nil {
            // Context expired — re-queue remaining
            failed = append(failed, items[inserted+len(failed):]...)
            break
        }
        if err := b.insertFn(drainCtx, item); err != nil {
            failed = append(failed, item)
            // If first item fails, likely DB is still down — re-queue all remaining
            if inserted == 0 && len(failed) == 1 {
                failed = append(failed, items[1:]...)
                break
            }
        } else {
            inserted++
        }
    }

    if inserted > 0 {
        log.Info().Str("buffer", b.name).Int("inserted", inserted).Int("remaining", len(failed)).Msg("write buffer drained")
    }

    if len(failed) > 0 {
        b.mu.Lock()
        // Prepend failed items (they're older) — respect maxSize
        if len(failed)+len(b.items) > b.maxSize {
            excess := len(failed) + len(b.items) - b.maxSize
            failed = failed[excess:] // drop oldest from failed batch
        }
        b.items = append(failed, b.items...)
        b.mu.Unlock()
    }
}
```

Add unit tests in `internal/database/write_buffer_test.go`:
- Test `Enqueue` respects `maxSize` and drops oldest
- Test `drain` inserts successfully and clears buffer
- Test `drain` re-queues on failure
- Test `drain` short-circuits when first insert fails (DB still down)
- Test concurrent `Enqueue` + `drain` safety with `-race`

### Step 2: Add Write Buffers to TelemetrySessionTracker

In `internal/api/telemetry_sessions.go`, add two buffers to the struct:

```go
type TelemetrySessionTracker struct {
    // ... existing fields ...

    // Write buffers for DB outage resilience
    driveTelBuffer  *database.WriteBuffer[*models.DriveTelemetry]
    chargeTelBuffer *database.WriteBuffer[*models.ChargeTelemetryReading]
}
```

Initialize in the constructor (`NewTelemetrySessionTracker`, around line 140):
```go
t := &TelemetrySessionTracker{
    // ... existing ...
    driveTelBuffer: database.NewWriteBuffer("drive_telemetry", 10000,
        func(ctx context.Context, r *models.DriveTelemetry) error {
            return t.driveTelRepo.Insert(ctx, r)
        },
    ),
    chargeTelBuffer: database.NewWriteBuffer("charge_telemetry", 10000,
        func(ctx context.Context, r *models.ChargeTelemetryReading) error {
            return t.chargeTelRepo.Insert(ctx, r)
        },
    ),
}
```

**Note:** The `insertFn` closure captures `t` — ensure `t` is fully initialized
before starting the drain loops. The drain goroutines should be started separately
via a `Start(ctx)` method.

### Step 3: Wire Insert-with-Fallback

Replace the direct insert calls with insert-then-buffer-on-failure:

**Drive telemetry (line 949-951):**
```go
// Before:
if err := t.driveTelRepo.Insert(ctx, reading); err != nil {
    log.Error().Err(err).Int64("drive_id", drive.DriveID).Msg("telemetry: failed to insert drive telemetry reading")
}

// After:
if err := t.driveTelRepo.Insert(ctx, reading); err != nil {
    log.Warn().Err(err).Int64("drive_id", drive.DriveID).Int("buffered", t.driveTelBuffer.Len()).
        Msg("telemetry: drive insert failed, buffering for retry")
    t.driveTelBuffer.Enqueue(reading)
}
```

**Charge telemetry (line 1525-1527):**
```go
// Before:
if err := t.chargeTelRepo.Insert(ctx, reading); err != nil {
    log.Error().Err(err).Int64("session_id", charge.SessionID).Msg("telemetry: failed to insert charge telemetry reading")
}

// After:
if err := t.chargeTelRepo.Insert(ctx, reading); err != nil {
    log.Warn().Err(err).Int64("session_id", charge.SessionID).Int("buffered", t.chargeTelBuffer.Len()).
        Msg("telemetry: charge insert failed, buffering for retry")
    t.chargeTelBuffer.Enqueue(reading)
}
```

### Step 4: Start Drain Loops

Add a `StartBufferDrains(ctx context.Context)` method:
```go
func (t *TelemetrySessionTracker) StartBufferDrains(ctx context.Context) {
    go t.driveTelBuffer.DrainLoop(ctx, 5*time.Second)
    go t.chargeTelBuffer.DrainLoop(ctx, 5*time.Second)
    log.Info().Msg("telemetry write buffers started (drain every 5s)")
}
```

Call from `cmd/teslasync/main.go` after telemetry handler initialization:
```go
if telemetryHandler != nil {
    telemetryHandler.StartBufferDrains(ctx)
}
```

### Step 5: Add Buffer Metrics

Add Prometheus gauges in `internal/metrics/`:
```go
var TelemetryBufferSize = prometheus.NewGaugeVec(
    prometheus.GaugeOpts{
        Name: "teslasync_telemetry_buffer_size",
        Help: "Number of telemetry readings buffered for retry",
    },
    []string{"type"}, // "drive" or "charge"
)
```

Update the `Enqueue` calls to set the metric:
```go
t.driveTelBuffer.Enqueue(reading)
metrics.TelemetryBufferSize.WithLabelValues("drive").Set(float64(t.driveTelBuffer.Len()))
```

### Step 6: Expose in /health/extended

Add buffer sizes to the extended health check response:
```go
results["telemetry_buffers"] = map[string]interface{}{
    "drive_buffered":  telemetryHandler.DriveBufferLen(),
    "charge_buffered": telemetryHandler.ChargeBufferLen(),
}
```

## Verification

```bash
# Build
CGO_ENABLED=0 go build ./cmd/teslasync

# Write buffer tests
go test -race -v ./internal/database/ -run TestWriteBuffer

# Full test suite
go test -race ./internal/...
```

## Commit

After all verification passes, commit the changes:

```bash
git add -A
git commit -m "feat(db): add in-memory write buffer for telemetry during DB outages

- Create generic WriteBuffer[T] with bounded ring buffer (10k cap)
- Add DrainLoop with periodic retry and short-circuit on persistent failure
- Buffer failed drive/charge telemetry inserts instead of dropping
- Add Prometheus gauges for buffer sizes
- Expose buffer stats in /health/extended"
```

## What NOT To Change

- Do not buffer read operations — only writes need resilience
- Do not use Redis as the buffer store — in-memory is sufficient and avoids
  adding a dependency failure mode during DB outages
- Do not make the buffer unbounded — always cap at maxSize to prevent OOM
- Do not retry indefinitely — the drain loop caps at 10s per cycle, and the
  buffer caps at 10,000 items. Beyond that, oldest data is dropped.
- Do not change the telemetry reading model structs — buffer stores the exact
  same `*models.DriveTelemetry` / `*models.ChargeTelemetryReading` objects
