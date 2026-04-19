---
description: "Postgres resilience: health-aware write throttling and graceful degradation"
---

# Postgres Resilience: Health-Aware Degradation

## Problem

Even when the health check (`/readyz`) returns 503 and the circuit breaker is open,
background workers (signal store, signal history, telemetry sessions) continue to
generate write workload at full rate. The signal store spawns a goroutine per MQTT
batch per vehicle regardless of DB health, creating backpressure that compounds
the outage.

When Postgres recovers, the accumulated retry queue and pending goroutines create
a thundering-herd "write storm" that can immediately overload the recovering database.

## Current State (after prompts 01-03)

After DSN hardening, retry-on-flush, and circuit breaker:
- ✅ Connections timeout after 5s
- ✅ Transient errors retry 3 times
- ✅ Circuit breaker prevents hammering dead DB
- ❌ Signal store still spawns goroutine per batch (blocked by breaker but still spawned)
- ❌ No write rate throttling during recovery
- ❌ No health-aware backoff on flush frequency

## Task

### Step 1: Debounced Flush in Signal Store

Replace the per-batch goroutine spawn in `flushNow()` with a debounced flush that
coalesces multiple MQTT batches into a single write per vehicle.

Add a debounce mechanism to `Store`:

```go
type Store struct {
    mu       sync.RWMutex
    vehicles map[int64]map[string]*Value
    flusher  Flusher

    // Debounce: track dirty vehicles, flush on timer
    dirtyMu  sync.Mutex
    dirty    map[int64]bool
    flushTicker *time.Ticker
}
```

Replace `flushNow()` (fire-per-batch) with `markDirty()` (sets a flag):

```go
func (s *Store) markDirty(vehicleID int64) {
    s.dirtyMu.Lock()
    s.dirty[vehicleID] = true
    s.dirtyMu.Unlock()
}
```

Add a `FlushLoop(ctx)` that runs every 1 second and flushes all dirty vehicles:

```go
func (s *Store) FlushLoop(ctx context.Context) {
    ticker := time.NewTicker(1 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            s.flushDirty(ctx)
        }
    }
}

func (s *Store) flushDirty(ctx context.Context) {
    s.dirtyMu.Lock()
    if len(s.dirty) == 0 {
        s.dirtyMu.Unlock()
        return
    }
    ids := make([]int64, 0, len(s.dirty))
    for id := range s.dirty {
        ids = append(ids, id)
    }
    s.dirty = make(map[int64]bool, len(ids))
    s.dirtyMu.Unlock()

    for _, vid := range ids {
        raw := s.GetRawMap(vid)
        if raw == nil {
            continue
        }
        flushStart := time.Now()
        flushCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
        // Use circuit breaker + retry from prompts 02-03
        err := s.writeBreaker.Execute(func() error {
            return database.RetryOnTransient(flushCtx, "live_state_flush", func(ctx context.Context) error {
                return s.flusher.FlushLiveState(ctx, vid, raw)
            })
        })
        cancel()
        if err != nil {
            log.Warn().Err(err).Int64("vehicle_id", vid).Msg("signal store: flush failed")
            // Re-mark as dirty for next cycle
            s.dirtyMu.Lock()
            s.dirty[vid] = true
            s.dirtyMu.Unlock()
        }
        metrics.SignalFlushDuration.Observe(time.Since(flushStart).Seconds())
    }
}
```

Update `Update()` to call `markDirty()` instead of `flushNow()`:
```go
// Before:
s.flushNow(vehicleID)

// After:
s.markDirty(vehicleID)
```

Start the loop in `cmd/teslasync/main.go`:
```go
go signalStore.FlushLoop(ctx)
```

Benefits:
- 5 vehicles × 10 MQTT batches/sec = 50 `flushNow()` goroutines/sec → 5 flushes/sec (1 per vehicle per tick)
- No goroutine accumulation during outages
- Circuit breaker check happens in the single flush goroutine
- Failed vehicles get re-marked dirty, retried next tick

### Step 2: Adaptive Flush Interval

When the circuit breaker is open, increase the flush interval to reduce probe frequency:

```go
func (s *Store) FlushLoop(ctx context.Context) {
    normalInterval := 1 * time.Second
    degradedInterval := 5 * time.Second
    ticker := time.NewTicker(normalInterval)
    defer ticker.Stop()

    currentInterval := normalInterval
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            s.flushDirty(ctx)

            // Adapt interval based on circuit breaker state
            newInterval := normalInterval
            if s.writeBreaker != nil && s.writeBreaker.State() != gobreaker.StateClosed {
                newInterval = degradedInterval
            }
            if newInterval != currentInterval {
                ticker.Reset(newInterval)
                currentInterval = newInterval
                log.Info().Dur("interval", newInterval).Msg("signal store: flush interval adjusted")
            }
        }
    }
}
```

### Step 3: Bounded Goroutine Pool for Flushes

If the debounced approach isn't adopted, alternatively add a semaphore to limit
concurrent flush goroutines (defense-in-depth):

```go
type Store struct {
    // ...
    flushSem chan struct{} // buffered channel as semaphore
}

func New(flusher Flusher, flushInterval time.Duration) *Store {
    return &Store{
        vehicles: make(map[int64]map[string]*Value),
        flusher:  flusher,
        flushSem: make(chan struct{}, 10), // max 10 concurrent flushes
    }
}
```

In `flushNow()`, acquire before spawning:
```go
select {
case s.flushSem <- struct{}{}:
    go func() {
        defer func() { <-s.flushSem }()
        // ... flush logic ...
    }()
default:
    log.Debug().Int64("vehicle_id", vehicleID).Msg("signal store: flush skipped (concurrency limit)")
}
```

**Choose one approach:** Either Step 1 (debounced loop — preferred) OR Step 3 (semaphore).
Do not implement both — they solve the same problem differently.

### Step 4: Log DB Health State Transitions

Add a periodic health state logger that logs once when DB transitions between
healthy → degraded → unhealthy (not on every check):

```go
// In the FlushLoop or as a separate goroutine
prevState := gobreaker.StateClosed
// ... on each tick:
state := s.writeBreaker.State()
if state != prevState {
    log.Warn().
        Str("from", prevState.String()).
        Str("to", state.String()).
        Msg("DB write health state changed")
    prevState = state
}
```

## Verification

```bash
# Build
CGO_ENABLED=0 go build ./cmd/teslasync

# Tests
go test -race ./internal/signal/...
go test -race ./internal/database/...

# Verify no goroutine leaks (should see bounded goroutine count)
# Run with GODEBUG=gctrace=1 under load, observe goroutine count stability
```

## Architecture Decision: Debounced Flush vs Per-Batch Flush

**Before (per-batch):**
```
MQTT batch → Update() → flushNow() → go func { Exec(UPSERT) }
                                       ↑ one goroutine per batch per vehicle
```

**After (debounced):**
```
MQTT batch → Update() → markDirty(vehicleID)
                                      ↓
FlushLoop (1s tick) → for each dirty vehicle → Exec(UPSERT)
                       ↑ single goroutine, sequential flushes
```

The debounced approach is strictly better:
- Same data freshness (live_state is always "latest snapshot", not incremental)
- 10x fewer DB writes (coalesced)
- No goroutine accumulation
- Natural backpressure during outages

## Commit

After all verification passes, commit the changes:

```bash
git add -A
git commit -m "perf(db): replace per-batch goroutine flush with debounced loop

- Replace flushNow() goroutine-per-batch with markDirty() + FlushLoop (1s tick)
- Add adaptive flush interval (1s normal, 5s when circuit breaker open)
- Eliminates goroutine accumulation during Postgres outages
- Re-marks failed vehicles as dirty for next cycle"
```

## What NOT To Change

- Do not change the MQTT batch processing speed — MQTT → signal store must stay fast
- Do not add health checks to read paths — reads should always work
- Do not throttle the in-memory store updates — only the DB flush
- The `FlushAll()` shutdown path must NOT use the debounce — it flushes immediately
