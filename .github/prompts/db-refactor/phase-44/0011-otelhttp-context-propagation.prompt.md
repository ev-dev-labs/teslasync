---
description: "Phase 44 - otelhttp-context-propagation"
---

# Prompt 0011 - HTTP - otelhttp middleware + context propagation audit

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-44-0011-otelhttp-context-propagation.log` |
| Depends on | `phase-44-0010-tracing-bootstrap-audit.log` |
| Allowed files to change | `internal/api/`, `internal/tesla/`, `internal/notifier/`, `internal/adapter/`, `internal/webpush/`, `internal/integrations/`, `internal/platform/`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1-11. (See Prompt 0000.)
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT ===`, `=== BUILD ===`, `=== TESTS ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`otelhttp.NewHandler` is wired in `internal/api/middleware.go` but no audit confirms every chi router and every outbound `http.Client` uses it. Inbound: every chi sub-router must be wrapped. Outbound: every `http.Client` constructed in code must use `otelhttp.NewTransport` so the W3C `traceparent` header is propagated.

> **Phase-47 coordination note (2026-05-08):** This prompt creates a NEW
> file `internal/api/middleware_test.go`. Phase-47 ADR-006 (HTTP Handler
> Canonical Home, formerly ADR-005) freezes new `.go` files under
> `internal/api/` but has been amended to allow `_test.go` files for
> existing `internal/api/*.go` source files (since tests must live in
> the same Go package as the code under test). If phase-47 ADR-006 is
> NOT yet merged at execution time, this exception still applies — the
> ADR text was intentionally drafted to permit it.

## Action Steps

1. Verify Phase 44 Prompt 0010 is DONE.
2. Audit `internal/api/router.go` and any sub-router file: every `chi.Mux` or `chi.Router` returned to the caller MUST be wrapped with `otelhttp.NewHandler` at exactly one boundary (today: `middleware.go:73`).
3. Audit every `http.Client{...}` literal and every `&http.Client{...}` in `internal/`: the `Transport` field MUST be `otelhttp.NewTransport(http.DefaultTransport)` (or a wrapped custom transport).
4. For each violation, fix in place. Add a `grep`-based test in `internal/api/middleware_test.go` that asserts an outbound request from a fake `http.Client` includes the `traceparent` header when the test sets up an active span.
5. Document allowed exceptions (e.g., metrics scrape clients) in a top-of-file comment in `middleware.go`.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-44-0011-otelhttp-context-propagation.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-44-0010-tracing-bootstrap-audit.log"
$prevLines = if (Test-Path $prev) { Get-Content $prev } else { @() }
$prevExit   = ($prevLines | Where-Object { $_ -match '^EXIT=' }   | Select-Object -Last 1)
$prevStatus = ($prevLines | Where-Object { $_ -match '^STATUS=' } | Select-Object -Last 1)
if (-not $prevExit -or $prevExit -ne 'EXIT=0' -or -not $prevStatus -or $prevStatus -ne 'STATUS=DONE') {
  "Predecessor not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

"=== AUDIT ===" | Tee-Object -FilePath $log -Append
$internal_api_middleware_go = Get-Content "internal/api/middleware.go" -Raw -ErrorAction SilentlyContinue
if (-not $internal_api_middleware_go -or $internal_api_middleware_go -notmatch [regex]::Escape("otelhttp.NewHandler")) { "Required token not found in internal/api/middleware.go: otelhttp.NewHandler" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }
$internal_api_middleware_go = Get-Content "internal/api/middleware.go" -Raw -ErrorAction SilentlyContinue
if (-not $internal_api_middleware_go -or $internal_api_middleware_go -notmatch [regex]::Escape("otelhttp.NewTransport")) { "Required token not found in internal/api/middleware.go: otelhttp.NewTransport" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"=== AUDIT_GREP ===" | Tee-Object -FilePath $log -Append
$bad = Select-String -Path 'internal/**/*.go' -Pattern 'http\.Client\{' | Where-Object { (Get-Content $_.Path -Raw) -notmatch 'otelhttp\.NewTransport' }
if ($bad) { $bad | ForEach-Object { '  - {0}:{1}' -f $_.Path, $_.LineNumber | Tee-Object -FilePath $log -Append }; 'http.Client without otelhttp.NewTransport' | Tee-Object -FilePath $log -Append; 'EXIT=1' | Tee-Object -FilePath $log -Append; 'STATUS=BLOCKED' | Tee-Object -FilePath $log -Append; exit 1 }

"=== BUILD ===" | Tee-Object -FilePath $log -Append
go build ./... 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE }

"=== TESTS ===" | Tee-Object -FilePath $log -Append
go test -race ./internal/api/... 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE }

$status = git status --porcelain
$allowed = @('internal/api/','internal/tesla/','internal/notifier/','internal/adapter/','internal/webpush/','internal/integrations/','internal/platform/',$log)
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
git add internal/api/ internal/tesla/ internal/notifier/ internal/adapter/ internal/webpush/ internal/integrations/ internal/platform/
git add -f .github/prompts/db-refactor/logs/phase-44-0011-otelhttp-context-propagation.log
git commit -m "phase-44(0011): wire otelhttp inbound + outbound everywhere

Every chi router wrapped, every http.Client uses otelhttp.NewTransport.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```


