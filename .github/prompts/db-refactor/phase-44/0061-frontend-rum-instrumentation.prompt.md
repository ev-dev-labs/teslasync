---
description: "Phase 44 - frontend-rum-instrumentation"
---

# Prompt 0061 - Frontend - fetch + route + error instrumentation

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-44-0061-frontend-rum-instrumentation.log` |
| Depends on | `phase-44-0060-frontend-otel-browser-bootstrap.log` |
| Allowed files to change | `web/src/observability/`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1-11. (See Prompt 0000.)
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT ===`, `=== BUILD ===`, `=== TESTS ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

Bootstrap exists; now add concrete instrumentation: every `request()` call in `api/client.ts` produces a span (already happens via FetchInstrumentation auto-loaded), but route-change spans and uncaught error reporting need explicit wiring.

## Action Steps

1. Verify Phase 44 Prompt 0060 is DONE.
2. In `web/src/observability/rum.ts`, register a `window.addEventListener('error', ...)` handler that records the error on the active span.
3. Add a React Router listener that opens a span `route.<path>` on each navigation.
4. Add unit tests using `@opentelemetry/sdk-trace-web` InMemorySpanExporter.
5. NO MUTATIONS to pages or features (ADR-008 lock #6).

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-44-0061-frontend-rum-instrumentation.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-44-0060-frontend-otel-browser-bootstrap.log"
$prevLines = if (Test-Path $prev) { Get-Content $prev } else { @() }
$prevExit   = ($prevLines | Where-Object { $_ -match '^EXIT=' }   | Select-Object -Last 1)
$prevStatus = ($prevLines | Where-Object { $_ -match '^STATUS=' } | Select-Object -Last 1)
if (-not $prevExit -or $prevExit -ne 'EXIT=0' -or -not $prevStatus -or $prevStatus -ne 'STATUS=DONE') {
  "Predecessor not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

"=== AUDIT ===" | Tee-Object -FilePath $log -Append
$c = Get-Content "web/src/observability/rum.ts" -Raw -ErrorAction SilentlyContinue
if (-not $c -or $c -notmatch [regex]::Escape("addEventListener")) { "Missing in web/src/observability/rum.ts: global error handler" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }
$c = Get-Content "web/src/observability/rum.ts" -Raw -ErrorAction SilentlyContinue
if (-not $c -or $c -notmatch [regex]::Escape("route.")) { "Missing in web/src/observability/rum.ts: route span name prefix" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

# UI preservation: no page deletions vs phase-43.
$pageCount = (Get-ChildItem "web/src/features" -Recurse -Filter *.tsx | Where-Object { $_.FullName -match "\\pages\\" }).Count
if ($pageCount -lt 110) { "Page count regressed: $pageCount < 110" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"=== TSC ===" | Tee-Object -FilePath $log -Append
Push-Location web; npx tsc --noEmit 2>&1 | Tee-Object -FilePath $log -Append; $tscExit = $LASTEXITCODE; Pop-Location
if ($tscExit -ne 0) { "EXIT=$tscExit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $tscExit }

"=== BUILD ===" | Tee-Object -FilePath $log -Append
Push-Location web; npm run build 2>&1 | Tee-Object -FilePath $log -Append; $buildExit = $LASTEXITCODE; Pop-Location
if ($buildExit -ne 0) { "EXIT=$buildExit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $buildExit }

$status = git status --porcelain
$allowed = @('web/src/observability/',$log)
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
git add web/src/observability/
git add -f .github/prompts/db-refactor/logs/phase-44-0061-frontend-rum-instrumentation.log
git commit -m "phase-44(0061): RUM instrumentation: route spans + global errors

Route-change spans + window.error handler. Zero page mutations.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
