---
description: "Phase-17 — Write buffer drops data silently: add Prometheus counter + Stats() endpoint"
---
# Prompt 06 — Write Buffer Drops Data Silently (HIGH)
> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-17-06-write-buffer-drops.log` |
| Allowed files to change | `internal/database/write_buffer.go`, `internal/metrics/metrics.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

**File:** `internal/database/write_buffer.go:45-53`

When the write buffer is full, the oldest 10% of entries are silently dropped. Only a
`log.Warn()` is emitted — there's no metric for alerting, and no way for operators to
see buffer pressure via the health endpoint.

## Task

### 1. Survey

Read `internal/database/write_buffer.go` around lines 40-60 to find the drop logic.
Read `internal/metrics/metrics.go` to understand the existing Prometheus metric patterns.

### 2. Add Prometheus counter in metrics.go

In `internal/metrics/metrics.go`, add a new counter:

```go
var WriteBufferDroppedTotal = promauto.NewCounterVec(
    prometheus.CounterOpts{
        Name: "signal_write_buffer_dropped_total",
        Help: "Total number of entries dropped from write buffer due to overflow",
    },
    []string{"buffer_name"},
)
```

Follow the existing naming and registration patterns in the file.

### 3. Increment counter on drop

In `internal/database/write_buffer.go`, where entries are dropped:

```go
metrics.WriteBufferDroppedTotal.WithLabelValues(b.name).Add(float64(dropCount))
```

The existing `log.Warn()` stays — the counter is additional observability, not a replacement.

### 4. Add Stats() method

Add a `Stats()` method to the write buffer struct that returns current pressure info:

```go
type BufferStats struct {
    Name     string `json:"name"`
    Size     int    `json:"size"`
    Capacity int    `json:"capacity"`
    Dropped  int64  `json:"total_dropped"`
}

func (b *WriteBuffer) Stats() BufferStats {
    // return current buffer stats
}
```

The `Dropped` field should be tracked by an atomic counter incremented alongside the
Prometheus metric. The `/system/health` endpoint integration is out of scope for this
prompt — just expose the `Stats()` method.

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify Prometheus counter exists:
$counter = Select-String -Path internal\database\write_buffer.go,internal\metrics\metrics.go -Pattern 'dropped_total|Dropped.*Counter|WriteBufferDroppedTotal'
if ($counter.Count -lt 2) { Write-Error "FAIL: Prometheus counter not found in both files (found $($counter.Count))"; exit 1 }
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-17/06-write-buffer-drops: add Prometheus counter for dropped entries + Stats() method

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-17/06-write-buffer-drops` as the commit message prefix.
