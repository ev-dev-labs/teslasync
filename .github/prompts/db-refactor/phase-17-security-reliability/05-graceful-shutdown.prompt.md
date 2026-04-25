---
description: "Phase-17 — Shutdown doesn't wait for background work: WaitGroup + bounded timeout"
---
# Prompt 05 — Shutdown Doesn't Wait for Background Work (HIGH)
> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-17-05-graceful-shutdown.log` |
| Allowed files to change | `cmd/notification-worker/main.go`, `cmd/export-worker/main.go`, `internal/notification/worker.go`, `internal/export/worker.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

**Files:** `cmd/notification-worker/main.go`, `cmd/export-worker/main.go`

Workers spawn goroutines for processing jobs but exit immediately on context cancellation
without waiting for in-flight work to complete. This causes:
- Partially processed notifications (user gets no notification but DB thinks it sent)
- Incomplete exports (file written partially, marked as done)

## Task

### 1. Survey

Read ALL four files to understand the architecture:
- `cmd/notification-worker/main.go` — how it creates and runs the worker
- `cmd/export-worker/main.go` — same
- `internal/notification/worker.go` — where actual job processing goroutines are spawned
- `internal/export/worker.go` — same

Find:
- Where goroutines are spawned (likely in the `internal/*/worker.go` files, not `main.go`)
- How shutdown is handled (signal handling, `<-ctx.Done()`, or `os.Signal`)
- Whether a WaitGroup already exists

### 2. Add WaitGroup to `internal/notification/worker.go`

The WaitGroup belongs in the worker package because that's where per-message/per-job
goroutines are spawned. Add it to the worker struct:

```go
type Worker struct {
    // ... existing fields ...
    wg sync.WaitGroup
}
```

Wrap each per-job goroutine:
```go
w.wg.Add(1)
go func() {
    defer w.wg.Done()
    // ... existing job processing ...
}()
```

Add a `Shutdown()` method with bounded wait:
```go
func (w *Worker) Shutdown() {
    log.Info().Msg("shutting down: waiting for in-flight notifications...")
    done := make(chan struct{})
    go func() {
        w.wg.Wait()
        close(done)
    }()
    select {
    case <-done:
        log.Info().Msg("all notifications completed, exiting cleanly")
    case <-time.After(30 * time.Second):
        log.Warn().Msg("shutdown timeout exceeded (30s), forcing exit with in-flight work abandoned")
    }
}
```

### 3. Add WaitGroup to `internal/export/worker.go`

Apply the identical pattern: WaitGroup on struct, wrap goroutines, add `Shutdown()`.

### 4. Call `worker.Shutdown()` from `main.go`

In both `cmd/notification-worker/main.go` and `cmd/export-worker/main.go`, call
`worker.Shutdown()` AFTER the context is cancelled but BEFORE `os.Exit()` or the
function returns.

Do NOT remove existing signal handling or context cancellation — just add the
`Shutdown()` call at the right point in the shutdown sequence.

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify WaitGroup in worker packages (where the actual work is tracked):
$wgWorker = Select-String -Path internal\notification\worker.go,internal\export\worker.go -Pattern 'WaitGroup|wg\.Wait|\.wg\.'
if ($wgWorker.Count -lt 2) { Write-Error "FAIL: WaitGroup not found in both worker packages (found $($wgWorker.Count))"; exit 1 }

# Verify Shutdown() is called from main.go:
$shutdown = Select-String -Path cmd\notification-worker\main.go,cmd\export-worker\main.go -Pattern 'Shutdown\(\)'
if ($shutdown.Count -lt 2) { Write-Error "FAIL: Shutdown() not called in both main.go files (found $($shutdown.Count))"; exit 1 }
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-17/05-graceful-shutdown: add WaitGroup with 30s bounded timeout for in-flight work

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-17/05-graceful-shutdown` as the commit message prefix.
