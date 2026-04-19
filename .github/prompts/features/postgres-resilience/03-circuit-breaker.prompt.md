---
description: "Postgres resilience: circuit breaker for DB writes to prevent cascading failures"
---

# Postgres Resilience: DB Write Circuit Breaker

## Problem

When Postgres is down or degraded, the teslasync-api continues to hammer it with
every flush operation (live state, signal history, telemetry) at full rate. Each
failed write creates a goroutine with a 5-10 second timeout, accumulating hundreds
of blocked goroutines. This causes memory pressure, goroutine exhaustion, and
eventually crashes (exit code 2).

The Tesla API circuit breaker pattern (`internal/tesla/client.go`) already solves
this for outbound API calls. We need the same pattern for DB writes.

## Current State

```
internal/tesla/client.go         — Uses gobreaker.CircuitBreaker for Tesla API calls ✅
internal/platform/httputil/      — Has CircuitBreaker for HTTP clients ✅
internal/signal/store.go         — flushNow() spawns goroutine per batch, NO circuit breaker ❌
internal/database/               — No circuit breaker on any DB operation ❌
```

### What Happens During Outage (observed behavior)
1. Postgres becomes unreachable (pod eviction, network issue)
2. Every MQTT batch (1/sec/vehicle) spawns a `flushNow()` goroutine
3. Each goroutine blocks for 5s on `context.WithTimeout`
4. With 5 vehicles: 5 goroutines/sec × 5s timeout = 25 blocked goroutines steady-state
5. Signal history writer also blocks every 2s
6. After minutes: 100+ blocked goroutines, memory climbing, API unresponsive
7. Eventually: crash from accumulated failures

## Task

### Step 1: Create DB Circuit Breaker

Create `internal/database/circuit_breaker.go`:

```go
package database

import (
    "fmt"
    "time"

    "github.com/rs/zerolog/log"
    "github.com/sony/gobreaker"
)

// DBCircuitBreaker wraps gobreaker for database write operations.
// Opens after consecutive failures, preventing goroutine accumulation
// during Postgres outages.
type DBCircuitBreaker struct {
    cb *gobreaker.CircuitBreaker
}

// NewDBCircuitBreaker creates a circuit breaker for DB writes.
//
// Behavior:
//   - Closed (normal): all writes go through
//   - Open (after 5 consecutive failures): writes fail-fast for 15s
//   - Half-Open (after 15s): allows 1 probe write; success closes, failure re-opens
func NewDBCircuitBreaker(name string) *DBCircuitBreaker {
    cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
        Name:        fmt.Sprintf("db-%s", name),
        MaxRequests: 1,               // half-open: let 1 request through to probe
        Interval:    30 * time.Second, // rolling window for failure count
        Timeout:     15 * time.Second, // how long to stay open before half-open
        ReadyToTrip: func(counts gobreaker.Counts) bool {
            return counts.ConsecutiveFailures >= 5
        },
        OnStateChange: func(name string, from gobreaker.State, to gobreaker.State) {
            log.Warn().
                Str("breaker", name).
                Str("from", from.String()).
                Str("to", to.String()).
                Msg("DB circuit breaker state change")
        },
    })
    return &DBCircuitBreaker{cb: cb}
}

// Execute runs fn through the circuit breaker.
// Returns gobreaker.ErrOpenState if the breaker is open (fast-fail).
func (b *DBCircuitBreaker) Execute(fn func() error) error {
    _, err := b.cb.Execute(func() (interface{}, error) {
        return nil, fn()
    })
    return err
}

// State returns the current circuit breaker state.
func (b *DBCircuitBreaker) State() gobreaker.State {
    return b.cb.State()
}

// Counts returns the current failure/success counts.
func (b *DBCircuitBreaker) Counts() gobreaker.Counts {
    return b.cb.Counts()
}
```

Add a unit test `internal/database/circuit_breaker_test.go`:
- Verify breaker opens after 5 consecutive failures
- Verify breaker returns `gobreaker.ErrOpenState` when open
- Verify breaker transitions to half-open after timeout
- Verify breaker closes on successful probe

### Step 2: Add Circuit Breaker to DB Struct

In `internal/database/database.go`, add the circuit breaker to the DB struct:

```go
type DB struct {
    Pool          *pgxpool.Pool
    WriteBreaker  *DBCircuitBreaker
}
```

Initialize it in `New()`:
```go
return &DB{
    Pool:         pool,
    WriteBreaker: NewDBCircuitBreaker("writes"),
}, nil
```

### Step 3: Integrate with Signal Store Flush

In `internal/signal/store.go`, update `flushNow()` to check the circuit breaker
**before** spawning a goroutine:

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
        ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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

**Note:** The circuit breaker wraps `RetryOnTransient` from prompt 02. The integration
approach depends on implementation order:

**Option A (circuit breaker wraps retry):**
The `Store` holds a reference to the `DBCircuitBreaker` and calls
`breaker.Execute(func() error { return RetryOnTransient(...) })`.
This is the preferred approach — the breaker prevents spawning retries when DB is known-down.

**Option B (retry inside breaker):**
`RetryOnTransient` internally checks a breaker before each attempt.
More coupled but fewer call sites to change.

Choose Option A. The `Store` needs a `SetCircuitBreaker(*DBCircuitBreaker)` method
or receives it via constructor.

### Step 4: Integrate with Signal History Writer

In `internal/database/signal_history_writer.go`, add a circuit breaker reference:

```go
type SignalHistoryWriter struct {
    db       *DB
    mu       sync.Mutex
    buffer   []SignalHistoryRow
    interval time.Duration
}
```

The writer already has `*DB` — it can access `db.WriteBreaker` directly.

Update `flush()` to wrap the CopyFrom call:
```go
func (w *SignalHistoryWriter) flush(ctx context.Context) {
    // ... take buffer ...

    err := w.db.WriteBreaker.Execute(func() error {
        return RetryOnTransient(ctx, "signal_history_flush", func(ctx context.Context) error {
            _, copyErr := w.db.Pool.CopyFrom(ctx, ...)
            return copyErr
        })
    })

    if err != nil {
        if errors.Is(err, gobreaker.ErrOpenState) {
            log.Debug().Int("rows", len(rows)).Msg("signal_history: circuit breaker open, re-queuing")
        } else {
            log.Warn().Err(err).Int("rows", len(rows)).Msg("signal_history: batch insert failed")
        }
        // Re-queue rows (same as prompt 02)
        // ...
    }
}
```

### Step 5: Add Circuit Breaker Metrics

Add a Prometheus gauge for circuit breaker state in `internal/metrics/`:

```go
var DBCircuitBreakerState = prometheus.NewGaugeVec(
    prometheus.GaugeOpts{
        Name: "teslasync_db_circuit_breaker_state",
        Help: "DB circuit breaker state: 0=closed, 1=half-open, 2=open",
    },
    []string{"breaker"},
)
```

Update the `OnStateChange` callback to set the metric:
```go
OnStateChange: func(name string, from gobreaker.State, to gobreaker.State) {
    metrics.DBCircuitBreakerState.WithLabelValues(name).Set(float64(to))
    log.Warn().Str("breaker", name).Str("from", from.String()).Str("to", to.String()).
        Msg("DB circuit breaker state change")
},
```

### Step 6: Expose in Health Check

In `internal/api/health.go`, add circuit breaker state to `/health/extended`:

```go
results["db_circuit_breaker"] = map[string]interface{}{
    "state":                db.WriteBreaker.State().String(),
    "consecutive_failures": db.WriteBreaker.Counts().ConsecutiveFailures,
    "total_failures":       db.WriteBreaker.Counts().TotalFailures,
    "total_successes":      db.WriteBreaker.Counts().TotalSuccesses,
}
```

### Step 7: Wire Circuit Breaker into /readyz

Currently, `ReadyHandler` (health.go:32-57) only checks `db.Health()` (a Ping).
This returns 200 even when all **writes** are failing — Kubernetes keeps routing
traffic to a pod that can read but can't write.

Update `ReadyHandler` to accept the `DBCircuitBreaker` and report write health:

```go
func ReadyHandler(db *database.DB, tc *tesla.Client) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        checks := map[string]string{}

        if err := db.Health(r.Context()); err != nil {
            checks["database"] = "unhealthy"
        } else {
            checks["database"] = "ok"
        }

        // NEW: check write circuit breaker
        if db.WriteBreaker != nil {
            state := db.WriteBreaker.State()
            if state == gobreaker.StateOpen {
                checks["database_writes"] = "unhealthy"
            } else if state == gobreaker.StateHalfOpen {
                checks["database_writes"] = "degraded"
            } else {
                checks["database_writes"] = "ok"
            }
        }

        if tc.HasValidToken() {
            checks["tesla_auth"] = "ok"
        } else {
            checks["tesla_auth"] = "no_token"
        }

        for _, v := range checks {
            if v == "unhealthy" {
                writeJSON(w, http.StatusServiceUnavailable, checks)
                return
            }
        }
        writeJSON(w, http.StatusOK, checks)
    }
}
```

This makes Kubernetes stop routing traffic when the DB write path is broken,
while still allowing the pod to recover (half-open allows probe writes through).

## Verification

```bash
# Build
CGO_ENABLED=0 go build ./cmd/teslasync

# Circuit breaker tests
go test -race -v ./internal/database/ -run TestCircuitBreaker

# Verify gobreaker is already a dependency
grep gobreaker go.mod
# If not present: go get github.com/sony/gobreaker

# Full test suite
go test -race ./internal/...
```

## Commit

After all verification passes, commit the changes:

```bash
git add -A
git commit -m "feat(db): add circuit breaker for DB writes with health-aware readiness

- Create DBCircuitBreaker using gobreaker (opens after 5 failures, 15s timeout)
- Integrate with signal store flush and signal history writer
- Add Prometheus gauge for circuit breaker state
- Expose breaker state in /health/extended endpoint
- Wire circuit breaker into /readyz — returns 503 when writes are broken"
```

## What NOT To Change

- Do not add circuit breaker to read operations — reads should always attempt
- Do not add circuit breaker to health checks — they need to probe even when writes are broken
- Do not change the Tesla API circuit breaker in `internal/tesla/client.go`
- Do not add circuit breaker to `FlushAll()` (shutdown path) — shutdown must always attempt
