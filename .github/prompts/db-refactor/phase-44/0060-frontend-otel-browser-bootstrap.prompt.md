---
description: "Phase 44 - frontend-otel-browser-bootstrap"
---

# Prompt 0060 - Frontend - bootstrap @opentelemetry/sdk-trace-web in main.tsx

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-44-0060-frontend-otel-browser-bootstrap.log` |
| Depends on | `phase-44-0052-helm-grafana-tempo-datasource.log` |
| Allowed files to change | `web/package.json`, `web/package-lock.json`, `web/src/observability/`, `web/src/main.tsx`, `web/.env.example`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1-11. (See Prompt 0000.)
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT ===`, `=== BUILD ===`, `=== TESTS ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

Frontend has no RUM. Add `@opentelemetry/sdk-trace-web`, `@opentelemetry/auto-instrumentations-web`, and `@opentelemetry/exporter-trace-otlp-http`. Bootstrap in `web/src/main.tsx` only — never in pages or components, per ADR-008 lock #6.

## Action Steps

1. Verify Phase 44 Prompt 0052 is DONE.
2. `npm install @opentelemetry/sdk-trace-web @opentelemetry/auto-instrumentations-web @opentelemetry/exporter-trace-otlp-http @opentelemetry/instrumentation-fetch` (in `web/`).
3. Create `web/src/observability/rum.ts` exporting `initRum()`.
4. Call `initRum()` from `web/src/main.tsx` BEFORE React bootstrap.
5. Configure exporter URL via Vite env var (`VITE_OTLP_HTTP_ENDPOINT`).
6. tsc + build green.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-44-0060-frontend-otel-browser-bootstrap.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-44-0052-helm-grafana-tempo-datasource.log"
$prevLines = if (Test-Path $prev) { Get-Content $prev } else { @() }
$prevExit   = ($prevLines | Where-Object { $_ -match '^EXIT=' }   | Select-Object -Last 1)
$prevStatus = ($prevLines | Where-Object { $_ -match '^STATUS=' } | Select-Object -Last 1)
if (-not $prevExit -or $prevExit -ne 'EXIT=0' -or -not $prevStatus -or $prevStatus -ne 'STATUS=DONE') {
  "Predecessor not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

"=== AUDIT ===" | Tee-Object -FilePath $log -Append
$c = Get-Content "web/package.json" -Raw -ErrorAction SilentlyContinue
if (-not $c -or $c -notmatch [regex]::Escape("@opentelemetry/sdk-trace-web")) { "Missing in web/package.json: @opentelemetry/sdk-trace-web" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }
if (-not (Test-Path "web/src/observability/rum.ts")) { "Missing: web/src/observability/rum.ts" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }
$c = Get-Content "web/src/main.tsx" -Raw -ErrorAction SilentlyContinue
if (-not $c -or $c -notmatch [regex]::Escape("initRum")) { "Missing in web/src/main.tsx: initRum() called" | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"=== TSC ===" | Tee-Object -FilePath $log -Append
Push-Location web; npx tsc --noEmit 2>&1 | Tee-Object -FilePath $log -Append; $tscExit = $LASTEXITCODE; Pop-Location
if ($tscExit -ne 0) { "EXIT=$tscExit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $tscExit }

"=== BUILD ===" | Tee-Object -FilePath $log -Append
Push-Location web; npm run build 2>&1 | Tee-Object -FilePath $log -Append; $buildExit = $LASTEXITCODE; Pop-Location
if ($buildExit -ne 0) { "EXIT=$buildExit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $buildExit }

$status = git status --porcelain
$allowed = @('web/package.json','web/package-lock.json','web/src/observability/','web/src/main.tsx','web/.env.example',$log)
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
git add web/package.json web/package-lock.json web/src/observability/ web/src/main.tsx web/.env.example
git add -f .github/prompts/db-refactor/logs/phase-44-0060-frontend-otel-browser-bootstrap.log
git commit -m "phase-44(0060): bootstrap OTel web SDK in main.tsx

RUM via @opentelemetry/sdk-trace-web; OTLP HTTP exporter.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
