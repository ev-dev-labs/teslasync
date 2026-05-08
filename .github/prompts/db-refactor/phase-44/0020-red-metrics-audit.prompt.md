---
description: "Phase 44 - red-metrics-audit"
---

# Prompt 0020 - Metrics - RED audit (Rate, Errors, Duration on every handler)

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-44-0020-red-metrics-audit.log` |
| Depends on | `phase-44-0016-context-propagation-audit.log` |
| Allowed files to change | `internal/api/`, `docs/runbooks/phase-44-metrics-conventions.md`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1-11. (See Prompt 0000.)
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT ===`, `=== BUILD ===`, `=== TESTS ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

Every HTTP handler must emit three Prometheus metrics: a counter (`http_requests_total{method,route,status_class}`), a counter (`http_request_errors_total{method,route,status_class}`), and a histogram (`http_request_duration_seconds{method,route}`). Today, `internal/api/middleware.go` emits some metrics but coverage and label conventions are not audited. This prompt: audits, fills gaps, enforces label conventions.

> **Phase-47 coordination note (2026-05-08):** This prompt creates a NEW
> file `internal/api/middleware_metrics_test.go`. Phase-47 ADR-006 (HTTP
> Handler Canonical Home, formerly ADR-005) freezes new `.go` files
> under `internal/api/` but has been amended to allow `_test.go` files
> for existing `internal/api/*.go` source files (since tests must live
> in the same Go package as the code under test). If phase-47 ADR-006 is
> NOT yet merged at execution time, this exception still applies — the
> ADR text was intentionally drafted to permit it.

## Action Steps

1. Verify Phase 44 Prompt 0016 is DONE.
2. Inventory metric registrations in `internal/api/`.
3. Refactor middleware so RED metrics are emitted exactly once per request, with `status_class` = `2xx`/`3xx`/`4xx`/`5xx`.
4. Add `internal/api/middleware_metrics_test.go` covering happy + error paths.
5. Update `docs/runbooks/phase-44-metrics-conventions.md` with the label vocabulary.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-44-0020-red-metrics-audit.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-44-0016-context-propagation-audit.log"
$prevLines = if (Test-Path $prev) { Get-Content $prev } else { @() }
$prevExit   = ($prevLines | Where-Object { $_ -match '^EXIT=' }   | Select-Object -Last 1)
$prevStatus = ($prevLines | Where-Object { $_ -match '^STATUS=' } | Select-Object -Last 1)
if (-not $prevExit -or $prevExit -ne 'EXIT=0' -or -not $prevStatus -or $prevStatus -ne 'STATUS=DONE') {
  "Predecessor not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

"=== AUDIT ===" | Tee-Object -FilePath $log -Append
$c = Get-Content "internal/api/middleware.go" -Raw -ErrorAction SilentlyContinue
if (-not $c -or $c -notmatch [regex]::Escape("http_requests_total")) { "Missing in internal/api/middleware.go: http_requests_total" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }
$c = Get-Content "internal/api/middleware.go" -Raw -ErrorAction SilentlyContinue
if (-not $c -or $c -notmatch [regex]::Escape("http_request_errors_total")) { "Missing in internal/api/middleware.go: http_request_errors_total" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }
$c = Get-Content "internal/api/middleware.go" -Raw -ErrorAction SilentlyContinue
if (-not $c -or $c -notmatch [regex]::Escape("http_request_duration_seconds")) { "Missing in internal/api/middleware.go: http_request_duration_seconds" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }
$c = Get-Content "internal/api/middleware.go" -Raw -ErrorAction SilentlyContinue
if (-not $c -or $c -notmatch [regex]::Escape("status_class")) { "Missing in internal/api/middleware.go: status_class" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"=== BUILD ===" | Tee-Object -FilePath $log -Append
go build ./... 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE }

"=== TESTS ===" | Tee-Object -FilePath $log -Append
go test -race ./internal/api/... 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE }

$status = git status --porcelain
$allowed = @('internal/api/','docs/runbooks/phase-44-metrics-conventions.md',$log)
$badLines = $status | Where-Object { $line = $_; -not ($allowed | Where-Object { $line -match [regex]::Escape($_) }) }
if ($badLines) { $badLines | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"All gate checks passed." | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
exit 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add internal/api/ docs/runbooks/phase-44-metrics-conventions.md
git add -f .github/prompts/db-refactor/logs/phase-44-0020-red-metrics-audit.log
git commit -m "phase-44(0020): audit + enforce RED metrics on every handler

Rate/Errors/Duration metrics with consistent labels.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
