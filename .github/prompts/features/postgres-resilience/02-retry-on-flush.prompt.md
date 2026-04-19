---
description: "Postgres resilience: retry with exponential backoff on transient flush failures"
---

# Postgres Resilience: Retry on Flush Failures

## Problem

All DB write operations (signal live state flush, signal history batch insert,
drive/charge telemetry inserts) log a warning and **silently drop data** on failure.
There is no retry logic. During a transient Postgres outage (seconds to minutes),
every write is permanently lost.

Production impact: during a 3-hour cascading failure, live state flushes, signal
history batches, and telemetry readings were all silently dropped.

## Current State — No Retry Anywhere

### Signal Live State Flush (signal/store.go:239-262)
```go
func (s *Store) flushNow(vehicleID int64) {
    go func() {
        ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
        defer cancel()
        if err := s.flusher.FlushLiveState(ctx, vehicleID, raw); err != nil {
            log.Warn().Err(err).Msg("signal store: flush to DB failed")
            // ← data dropped, no retry
        }
    }()
}
```

### Signal History Batch Insert (database/signal_history_writer.go:107-128)
```go
func (w *SignalHistoryWriter) flush(ctx context.Context) {
    rows := w.buffer
    w.buffer = make([]SignalHistoryRow, 0, cap(rows)) // buffer cleared BEFORE insert
    _, err := w.db.Pool.CopyFrom(ctx, ...)
    if err != nil {
        log.Warn().Err(err).Msg("signal_history: batch insert failed")
        // ← rows permanently lost
    }
}
```

### Drive/Charge Telemetry (api/telemetry_sessions.go)
```go
if err := t.driveTelRepo.Insert(ctx, reading); err != nil {
    log.Error().Err(err).Msg("telemetry: failed to insert drive telemetry reading")
    // ← telemetry point permanently lost
}
```

## Task

### Step 1: Create a DB-Specific Retry Helper

Create `internal/database/retry.go`:

This is a thin wrapper around the existing `resilience.Retry` function, but
pre-configured for DB transient errors and with shorter timeouts appropriate
for high-frequency flush operations.

```go
package database

import (
    "context"
    "errors"
    "time"

    "github.com/jackc/pgx/v5/pgconn"
    "github.com/ev-dev-labs/teslasync/internal/resilience"
)

// DBRetryConfig returns retry settings tuned for DB flush operations.
// 3 attempts, 200ms → 500ms → 1s backoff with jitter.
func DBRetryConfig() resilience.RetryConfig {
    return resilience.RetryConfig{
        MaxAttempts: 3,
        InitialWait: 200 * time.Millisecond,
        MaxWait:     1 * time.Second,
        Multiplier:  2.5,
        Jitter:      true,
    }
}

// IsTransient returns true for errors that are likely to succeed on retry:
// - connection reset/refused/timeout
// - context deadline exceeded (but NOT context cancelled — that's intentional shutdown)
// - Postgres Class 08 (connection exceptions)
// - Postgres Class 53 (insufficient resources)
// - Postgres Class 57 (operator intervention — e.g. restart)
func IsTransient(err error) bool {
    if err == nil {
        return false
    }

    // Context deadline = transient (server slow); context cancelled = intentional
    if errors.Is(err, context.DeadlineExceeded) {
        return true
    }
    if errors.Is(err, context.Canceled) {
        return false
    }

    // pgx-specific connection errors
    var pgErr *pgconn.PgError
    if errors.As(err, &pgErr) {
        switch pgErr.Code[:2] {
        case "08": // connection_exception
            return true
        case "53": // insufficient_resources
            return true
        case "57": // operator_intervention (e.g. admin_shutdown)
            return true
        }
    }

    // Network-level errors (connection refused, reset, etc.)
    // pgx wraps these — check the error string as fallback
    msg := err.Error()
    for _, substr := range []string{
        "connection refused",
        "connection reset",
        "broken pipe",
        "no such host",
        "i/o timeout",
        "connection timed out",
    } {
        if contains(msg, substr) {
            return true
        }
    }

    return false
}

// RetryOnTransient executes fn with retry only for transient errors.
// Non-transient errors (constraint violations, syntax errors) fail immediately.
func RetryOnTransient(ctx context.Context, name string, fn func(ctx context.Context) error) error {
    cfg := DBRetryConfig()
    var lastErr error
    wait := cfg.InitialWait

    for attempt := 1; attempt <= cfg.MaxAttempts; attempt++ {
        lastErr = fn(ctx)
        if lastErr == nil {
            return nil
        }
        if !IsTransient(lastErr) {
            return lastErr // non-transient — fail immediately
        }
        if attempt == cfg.MaxAttempts {
            break
        }
        if ctx.Err() != nil {
            return lastErr
        }

        // Brief backoff
        select {
        case <-time.After(wait):
        case <-ctx.Done():
            return lastErr
        }
        wait = time.Duration(float64(wait) * cfg.Multiplier)
        if wait > cfg.MaxWait {
            wait = cfg.MaxWait
        }
    }
    return lastErr
}
```

Add a unit test file `internal/database/retry_test.go` with table-driven tests:
- Verify `IsTransient` correctly classifies transient vs permanent errors
- Verify `RetryOnTransient` retries on transient errors and stops on permanent ones
- Verify it respects context cancellation

### Step 2: Add Retry to Signal Live State Flush

In `internal/signal/store.go`, update `flushNow()`:

```go
func (s *Store) flushNow(vehicleID int64) {
    if s.flusher == nil {
        return
    }
    raw := s.GetRawMap(vehicleID)
    if raw == nil {
        return
    }
    go func() {
        defer func() {
            if r := recover(); r != nil {
                log.Error().Interface("panic", r).Int64("vehicle_id", vehicleID).Msg("signal store: panic in flush goroutine")
            }
        }()
        flushStart := time.Now()
        ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)  // increased from 5s to allow retries
        defer cancel()

        err := database.RetryOnTransient(ctx, "live_state_flush", func(ctx context.Context) error {
            return s.flusher.FlushLiveState(ctx, vehicleID, raw)
        })
        if err != nil {
            log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("signal store: flush to DB failed after retries")
        }
        metrics.SignalFlushDuration.Observe(time.Since(flushStart).Seconds())
    }()
}
```

Key changes:
- Timeout increased from 5s → 10s to accommodate up to 3 retry attempts
- Uses `RetryOnTransient` — transient errors get 3 attempts, permanent errors fail fast
- Log message updated to clarify retries were exhausted

### Step 3: Add Retry to Signal History Batch Insert + Re-queue on Failure

In `internal/database/signal_history_writer.go`, update `flush()`:

```go
func (w *SignalHistoryWriter) flush(ctx context.Context) {
    w.mu.Lock()
    if len(w.buffer) == 0 {
        w.mu.Unlock()
        return
    }
    rows := w.buffer
    w.buffer = make([]SignalHistoryRow, 0, cap(rows))
    w.mu.Unlock()

    err := RetryOnTransient(ctx, "signal_history_flush", func(ctx context.Context) error {
        _, copyErr := w.db.Pool.CopyFrom(ctx,
            pgx.Identifier{"signal_history"},
            []string{"vehicle_id", "signal", "value_num", "value_str", "value_bool", "created_at"},
            pgx.CopyFromSlice(len(rows), func(i int) ([]interface{}, error) {
                r := rows[i]
                return []interface{}{r.VehicleID, r.Signal, r.ValueNum, r.ValueStr, r.ValueBool, r.CreatedAt}, nil
            }),
        )
        return copyErr
    })
    if err != nil {
        log.Warn().Err(err).Int("rows", len(rows)).Msg("signal_history: batch insert failed after retries")
        // Re-queue failed rows for the next flush (bounded to prevent memory leak)
        w.mu.Lock()
        maxRequeue := 10000
        if len(rows) <= maxRequeue {
            w.buffer = append(rows, w.buffer...)
        } else {
            log.Warn().Int("dropped", len(rows)-maxRequeue).Msg("signal_history: dropping oldest rows (requeue limit)")
            w.buffer = append(rows[len(rows)-maxRequeue:], w.buffer...)
        }
        w.mu.Unlock()
    }
}
```

Key changes:
- Retry with `RetryOnTransient` wrapping the CopyFrom call
- On failure after retries, re-queue rows back to the buffer (prepend for FIFO)
- Bounded re-queue at 10,000 rows to prevent unbounded memory growth
- Oldest rows dropped if over the limit (they're already stale)

### Step 4: Add Retry to FlushAll (Graceful Shutdown)

In `internal/signal/store.go`, update `FlushAll()`:

```go
func (s *Store) FlushAll(ctx context.Context) {
    if s.flusher == nil {
        return
    }
    ids := s.VehicleIDs()
    for _, vid := range ids {
        raw := s.GetRawMap(vid)
        if raw == nil {
            continue
        }
        err := database.RetryOnTransient(ctx, "shutdown_flush", func(ctx context.Context) error {
            return s.flusher.FlushLiveState(ctx, vid, raw)
        })
        if err != nil {
            log.Warn().Err(err).Int64("vehicle_id", vid).Msg("signal store: shutdown flush failed after retries")
        }
    }
    log.Info().Int("vehicles", len(ids)).Msg("signal store: graceful shutdown flush complete")
}
```

### Step 5: Increase Shutdown Flush Timeout

In `cmd/teslasync/main.go`, increase the signal store flush timeout from 10s to 30s:

```go
// Before (line 583):
flushCtx, flushCancel := context.WithTimeout(context.Background(), 10*time.Second)

// After:
flushCtx, flushCancel := context.WithTimeout(context.Background(), 30*time.Second)
```

Rationale: With retries, each vehicle's flush can take up to ~3 seconds. With 5+ vehicles,
10 seconds is too tight. 30 seconds provides comfortable headroom.

## Verification

```bash
# Build
CGO_ENABLED=0 go build ./cmd/teslasync

# Unit tests for retry logic
go test -race -v ./internal/database/ -run TestRetry
go test -race -v ./internal/database/ -run TestIsTransient

# Full test suite
go test -race ./internal/...

# Verify no regressions in signal store
go test -race ./internal/signal/...
```

## Commit

After all verification passes, commit the changes:

```bash
git add -A
git commit -m "feat(db): add retry with exponential backoff for DB flush operations

- Create database.RetryOnTransient() with 3-attempt backoff (200ms → 500ms → 1s)
- Add IsTransient() classifier for pgx connection/timeout errors
- Wrap signal live state flush with retry (signal/store.go)
- Wrap signal history batch insert with retry + re-queue on failure (bounded 10k)
- Add retry to FlushAll() shutdown path
- Increase shutdown flush timeout from 10s to 30s"
```

## What NOT To Change

- Do not add retry to read operations (SELECT queries) — reads should fail fast
- Do not retry on context.Canceled — that means intentional shutdown
- Do not add retry to telemetry inserts in this prompt — that's lower priority and
  more complex (requires idempotency). Can be added later.
- Do not modify the `Retry` or `RetryConfig` in `resilience.go` — use the DB-specific wrapper
