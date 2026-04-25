---
description: "Phase-14 — Redis backup list for DB outage resilience"
---
# Prompt 05 — Redis Backup List (secondary log during DB outage)
> **Severity:** Resilience | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-05-redis-backup.log` |
| Allowed files to change | `internal/database/signal_history_writer.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 02 (Redis write), 04 (buffer)

## Problem

If the app crashes while the in-memory buffer has 100K signals, those are lost.
Redis survives app crashes. Use a Redis list as secondary WAL.

## Task

### 1. On flush failure, push to Redis list

When `insertBatch` fails AND the in-memory buffer is above a threshold (e.g. 50K rows),
start pushing overflow rows to a Redis list `signal_log:backlog`:

```go
func (w *SignalHistoryWriter) pushToRedisBacklog(rows []SignalHistoryRow) {
    if w.redis == nil { return }
    for _, row := range rows {
        data, _ := json.Marshal(row)
        w.redis.RPush(context.Background(), "signal_log:backlog", data)
    }
    w.redis.Expire(context.Background(), "signal_log:backlog", 24*time.Hour)
}
```

### 2. On startup, drain Redis backlog

In the writer's `Start()` or `FlushLoop()` init:

```go
func (w *SignalHistoryWriter) drainRedisBacklog(ctx context.Context) {
    if w.redis == nil { return }
    count := 0
    for {
        data, err := w.redis.LPop(ctx, "signal_log:backlog").Bytes()
        if err == redis.Nil { break }
        if err != nil { log.Warn().Err(err).Msg("signal_log: backlog drain error"); break }

        var row SignalHistoryRow
        if json.Unmarshal(data, &row) == nil {
            w.mu.Lock()
            w.buffer = append(w.buffer, row)
            w.mu.Unlock()
            count++
        }
    }
    if count > 0 {
        log.Info().Int("rows", count).Msg("signal_log: drained Redis backlog")
    }
}
```

### 3. Wire Redis client into writer

Add `redis *redis.Client` field. Pass from constructor.

### Constraints

- Redis backlog has 24-hour TTL — don't accumulate forever
- Drain happens ONCE at startup, not continuously
- If Redis is also down, this is a no-op (fail silently)
- The 3-tier resilience: memory buffer → Redis backlog → MQTT persistence

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
go vet ./...
```

Log result. STATUS=DONE only if build+vet pass.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/05-redis-backup: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/05-redis-backup` as the commit message prefix.

