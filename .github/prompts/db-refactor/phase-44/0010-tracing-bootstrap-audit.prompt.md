---
description: "Phase 44 - audit and rebase the existing internal/tracing package"
---

# Prompt 0010 - Tracing - Bootstrap audit and rebase

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-44-0010-tracing-bootstrap-audit.log` |
| Depends on | `phase-44-0002-instructions-observability.log` |
| Allowed files to change | `internal/tracing/**`, `cmd/teslasync/main.go`, `internal/config/config.go`, `docker-compose.yml`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1-11. (See Prompt 0000.) Reaffirm rule 11: existing `internal/tracing/`
package is preserved; this prompt rebases / extends but never deletes.
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== TRACING_AUDIT ===`, `=== BOOTSTRAP ===`,
`=== TESTS ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`internal/tracing/` exists but only 3 files in the codebase use it. This
prompt makes it the single canonical bootstrap point with: OTLP exporter
(gRPC, configurable endpoint), service name + version + environment
attributes, batched span processor, graceful shutdown, head-based
sampling probability from env (`OTEL_TRACES_SAMPLER_ARG`), and a global
`otel.SetTracerProvider(...)` so all packages can call
`otel.Tracer("...").Start(ctx, ...)`.

## Action Steps

1. Verify Phase 44 Prompt 0002 is DONE.
2. Audit `internal/tracing/tracing.go` and `internal/tracing/span.go`.
   Log every exported symbol.
3. Rebase the bootstrap so `cmd/teslasync/main.go` calls a single
   `tracing.Init(ctx, cfg)` that:
   - Reads `cfg.OTLPEndpoint` (new env var `OTEL_EXPORTER_OTLP_ENDPOINT`,
     default `http://otel-collector:4317`).
   - Reads `cfg.ServiceVersion` (existing) and `cfg.Environment` (existing).
   - Configures `resource.New` with service.name, service.version,
     deployment.environment.
   - Configures TracerProvider with `BatchSpanProcessor` + OTLP gRPC
     exporter + `TraceIDRatioBased` sampler.
   - Calls `otel.SetTracerProvider(tp)` and `otel.SetTextMapPropagator(...)`
     (W3C Trace Context + Baggage).
   - Returns shutdown func that flushes pending spans.
4. Add Go tests in `internal/tracing/tracing_test.go`:
   - `Init` returns non-nil shutdown func when endpoint configured.
   - `Init` no-ops gracefully when endpoint empty (returns no-op shutdown).
   - Shutdown flushes within 5s.
5. Update `docker-compose.yml` to set `OTEL_EXPORTER_OTLP_ENDPOINT` env
   on the api service pointing at the dev OTel collector (added in
   prompt 0051).
6. Update `internal/config/config.go` to register the new env var (with
   the 3-location sync rule from copilot-instructions.md applied:
   docker-compose AND helm values must follow in their respective prompts;
   helm change is in prompt 0050).

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-44-0010-tracing-bootstrap-audit.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-44-0002-instructions-observability.log"
$prevLines = if (Test-Path $prev) { Get-Content $prev } else { @() }
$prevExit   = ($prevLines | Where-Object { $_ -match '^EXIT=' }   | Select-Object -Last 1)
$prevStatus = ($prevLines | Where-Object { $_ -match '^STATUS=' } | Select-Object -Last 1)
if (-not $prevExit -or $prevExit -ne 'EXIT=0' -or -not $prevStatus -or $prevStatus -ne 'STATUS=DONE') {
  "Predecessor not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# Required exports + behaviors.
"=== TRACING_AUDIT ===" | Tee-Object -FilePath $log -Append
$tracing = Get-Content 'internal/tracing/tracing.go' -Raw
$required = @(
  'func Init(',
  'otlptracegrpc',
  'BatchSpanProcessor',
  'TraceIDRatioBased',
  'otel.SetTracerProvider',
  'otel.SetTextMapPropagator',
  'service.name',
  'service.version',
  'deployment.environment'
)
$missing = $required | Where-Object { $tracing -notmatch [regex]::Escape($_) }
if ($missing) {
  "tracing.go missing required tokens: $($missing -join ', ')" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# main.go must call tracing.Init.
$main = Get-Content 'cmd/teslasync/main.go' -Raw
if ($main -notmatch 'tracing\.Init\(') {
  "main.go does not call tracing.Init" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# Config var registered.
$cfg = Get-Content 'internal/config/config.go' -Raw
if ($cfg -notmatch 'OTEL_EXPORTER_OTLP_ENDPOINT') {
  "config.go does not register OTEL_EXPORTER_OTLP_ENDPOINT" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# docker-compose updated.
$dc = Get-Content 'docker-compose.yml' -Raw
if ($dc -notmatch 'OTEL_EXPORTER_OTLP_ENDPOINT') {
  "docker-compose.yml does not set OTEL_EXPORTER_OTLP_ENDPOINT" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

"=== TESTS ===" | Tee-Object -FilePath $log -Append
go build ./... 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE }
go test -race ./internal/tracing/... 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE }

$status = git status --porcelain
$allowed = @('internal/tracing/','cmd/teslasync/main.go','internal/config/config.go','docker-compose.yml',$log)
$badLines = $status | Where-Object { $line = $_; -not ($allowed | Where-Object { $line -match [regex]::Escape($_) }) }
if ($badLines) { $badLines | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"Tracing bootstrap rebased, tests green." | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
exit 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add internal/tracing/ cmd/teslasync/main.go internal/config/config.go docker-compose.yml
git add -f .github/prompts/db-refactor/logs/phase-44-0010-tracing-bootstrap-audit.log
git commit -m "phase-44(0010): canonical OTLP tracing bootstrap

OTLP gRPC exporter + W3C propagator + ratio sampler + graceful shutdown.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
