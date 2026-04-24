---
description: "Phase-13 — Centralize Go helper functions"
---
# Prompt 05 — Centralize Go Helper Functions (toFloat64, safeFloat, parseInt64)
> **Severity:** HIGH | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-13-05-go-helpers.log` |
| Allowed files to change | `internal/api/converters.go` (CREATE), `internal/api/helpers.go`, handler files with local copies, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Duplicates to eliminate

| Function | Canonical | Duplicates In | Action |
|----------|----------|--------------|--------|
| `toFloat64()` | `live_state_repo.go:320` (returns `float64, bool`) | `flatten.go:113` (returns `float64, error`) | Create canonical in `converters.go`, update both callers |
| `toFloatOk()` | `telemetry_handler.go:1157` | — (only one copy but local) | Move to `converters.go` |
| `parseInt64()` | `helpers.go:104` as `urlParamInt64()` | `charging_handler.go:88-90` (inline) | Delete inline copy, use `urlParamInt64` or new `parseInt64` |
| `safeFloat()` (NaN/Inf guard) | Not centralized | `lifetime_handler.go:374` (`safeFloatLifetime`), `year_review_handler.go:50` (`safeFloatYR`) | Create one `safeFloat()` in `converters.go`, delete both copies |
| `formatFloat()` | `telemetry_handler.go:1180` | — (only one copy but local) | Move to `converters.go` |
| `toString()` | `telemetry_handler.go:1170` | — | Move to `converters.go` |

## Task

### 1. Create `internal/api/converters.go`

```go
package api

import (
    "math"
    "strconv"
    "fmt"
)

// toFloat64 converts any numeric-ish value to float64.
func toFloat64(v interface{}) (float64, bool) { ... }

// safeFloat returns 0 if v is NaN or Inf, otherwise v.
func safeFloat(v float64) float64 {
    if math.IsNaN(v) || math.IsInf(v, 0) { return 0 }
    return v
}

// formatFloat formats a float without trailing zeros.
func formatFloat(v float64) string { ... }
```

### 2. Delete all local copies and update callers

For each duplicate:
1. Delete the local function
2. Replace calls with the `converters.go` version
3. If the function was in the `database` package (like `live_state_repo.go:toFloat64`),
   either move it to a shared package or keep it there and delete the `api` copy.
   Prefer: keep ONE copy per package boundary.

### Important constraints

- `toFloat64` in `live_state_repo.go` is in package `database`, not `api`.
  It can stay there if only `database` package uses it. The duplicate in
  `flatten.go` (package `telemetry`) should import or have its own.
  **Key rule: max ONE copy per Go package.**
- Do NOT change function behavior — only location
- Run `go vet ./...` after changes

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
go vet ./...
# Verify no duplicate function names across api/ package
grep -rn "func safeFloat\|func toFloat64\|func formatFloat\|func parseInt64" --include="*.go" internal/api/ | sort
# Each function name should appear exactly once
```

Log result. STATUS=DONE only if go build + vet pass AND each helper exists exactly once per package.
