---
description: "Phase-14 — Write-ahead buffer resilience for DB outages"
---
# Prompt 04 — Write-Ahead Buffer + Rate-Limited Recovery Drain
> **Severity:** Resilience | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-04-buffer.log` |
| Allowed files to change | `internal/database/signal_history_writer.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 00 (signal_log exists)

## Problem

Current writer has `maxRequeue` limit. When DB is down, it drops signals after the
buffer fills. At 80 signals/sec, a 5-minute outage loses ~24K signals.

Also: when DB recovers, the buffer flushes all at once — slamming Postgres with a
spike that could trigger the same contention cascade.

## Task

### 1. Increase buffer capacity

Change `maxRequeue` to hold ~2 hours of signals (500K rows ≈ 50MB RAM):

```go
const maxBufferSize = 500_000 // ~2 hours at 80 signals/sec
```

When buffer is full, drop OLDEST signals (already correct behavior), but log a
prominent warning with the count of dropped signals.

### 2. Rate-limited drain on recovery

When the flush succeeds after failures, don't dump the entire buffer at once.
Drain in batches:

```go
const drainBatchSize = 10_000  // rows per flush cycle
const drainInterval = 100 * time.Millisecond  // 100K rows/sec max

func (w *SignalHistoryWriter) flushBuffer(ctx context.Context) {
    w.mu.Lock()
    if len(w.buffer) == 0 { w.mu.Unlock(); return }

    // Take at most drainBatchSize rows
    n := min(len(w.buffer), drainBatchSize)
    batch := w.buffer[:n]
    w.buffer = w.buffer[n:]
    w.mu.Unlock()

    err := w.insertBatch(ctx, batch)
    if err != nil {
        // Re-queue at front
        w.mu.Lock()
        w.buffer = append(batch, w.buffer...)
        w.mu.Unlock()
    }
}
```

### 3. Add buffer metrics

Log buffer depth periodically:
```go
if len(w.buffer) > 1000 {
    log.Warn().Int("buffered", len(w.buffer)).Msg("signal_log: buffer backlog")
}
```

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
go vet ./...
```

Log result. STATUS=DONE only if build+vet pass.
