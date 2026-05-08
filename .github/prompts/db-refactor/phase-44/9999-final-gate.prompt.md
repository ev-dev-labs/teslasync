---
description: "Phase 44 - final gate; verifies all 30 prior prompts + observability invariants"
---

# Prompt 9999 - Final gate - Phase-44 observability complete

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-44-9999-final-gate.log` |
| Depends on | `phase-44-0092-runbook-add-new-slo.log` |
| Allowed files to change | the output log only |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1-11. (See Prompt 0000.) This is the gate that closes phase-44. It must
NOT modify any source file. It must verify every prior prompt log says
EXIT=0 / STATUS=DONE, AND independently re-verify the verification floor:
go build, go test, helm lint, npm build, RED metric coverage, SLO catalog
parse, and the additive-only invariant (no instrumentation deletions).
<!-- END COVENANT -->

## Logging Requirements

`=== PRIOR_LOG_SWEEP ===`, `=== ADDITIVE_INVARIANT ===`,
`=== GO_BUILD ===`, `=== GO_TEST ===`, `=== HELM_LINT ===`,
`=== FRONTEND_BUILD ===`, `=== SLO_CATALOG ===`, `=== GATE ===`,
`=== COMMIT ===`.

## Action Steps

1. None. Gate-only.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-44-9999-final-gate.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

# 1. Sweep prior logs (30 of them).
"=== PRIOR_LOG_SWEEP ===" | Tee-Object -FilePath $log -Append
$slots = @(
  '0000-decision-record-observability-deepening',
  '0001-ADR-008-observability-stack',
  '0002-instructions-observability',
  '0010-tracing-bootstrap-audit',
  '0011-otelhttp-context-propagation',
  '0012-otelpgx-database-instrumentation',
  '0013-tesla-client-spans',
  '0014-mqtt-pipeline-spans',
  '0015-signal-normalize-pipeline-spans',
  '0016-context-propagation-audit',
  '0020-red-metrics-audit',
  '0021-metric-exemplars',
  '0022-business-slis',
  '0030-slo-catalog-yaml',
  '0031-slo-recording-rules-codegen',
  '0032-burn-rate-alerts-codegen',
  '0033-grafana-slo-dashboards-codegen',
  '0040-trace-sampling-policy',
  '0041-log-sampling-policy',
  '0050-helm-otel-collector',
  '0051-helm-tempo-deploy',
  '0052-helm-grafana-tempo-datasource',
  '0060-frontend-otel-browser-bootstrap',
  '0061-frontend-rum-instrumentation',
  '0080-trace-coverage-audit',
  '0081-metric-coverage-audit',
  '0082-slo-coverage-audit',
  '0090-runbook-debug-from-trace',
  '0091-runbook-respond-to-burn-alert',
  '0092-runbook-add-new-slo'
)
$failed = @()
foreach ($s in $slots) {
  $p = ".github\prompts\db-refactor\logs\phase-44-$s.log"
  if (-not (Test-Path $p)) { $failed += "$s : log missing"; continue }
  $lines  = Get-Content $p
  $exit   = ($lines | Where-Object { $_ -match '^EXIT=' }   | Select-Object -Last 1)
  $stat   = ($lines | Where-Object { $_ -match '^STATUS=' } | Select-Object -Last 1)
  if ($exit -ne 'EXIT=0' -or $stat -ne 'STATUS=DONE') { $failed += "$s : $exit / $stat" }
}
if ($failed.Count -gt 0) {
  "Prior logs not all DONE:" | Tee-Object -FilePath $log -Append
  $failed | ForEach-Object { "  - $_" | Tee-Object -FilePath $log -Append }
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# 2. Additive invariant: no deletions of tracing/, metrics/, helm prometheus/grafana files in phase-44.
"=== ADDITIVE_INVARIANT ===" | Tee-Object -FilePath $log -Append
$deletions = git log --diff-filter=D --name-only --pretty=format: HEAD~30..HEAD -- 'internal/tracing/' 'internal/metrics/' 'helm/teslasync/templates/' 'helm/teslasync/files/' 2>$null | Where-Object { $_ -ne '' }
if ($deletions) {
  "Observability files deleted during phase-44 (forbidden by ADR-008 lock #1):" | Tee-Object -FilePath $log -Append
  $deletions | ForEach-Object { "  - $_" | Tee-Object -FilePath $log -Append }
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# 3. Existence + content invariants.
"=== INVARIANTS ===" | Tee-Object -FilePath $log -Append
$mustExist = @(
  'internal/tracing/tracing.go',
  'internal/metrics/business.go',
  'slo/catalog.yaml',
  'cmd/slogen/main.go',
  'helm/teslasync/templates/otel-collector-deployment.yaml',
  'helm/teslasync/templates/tempo-statefulset.yaml',
  'helm/teslasync/templates/grafana-datasources-configmap.yaml',
  'helm/teslasync/files/prometheus/recording-rules.yaml',
  'helm/teslasync/files/prometheus/alerting-rules.yaml',
  'web/src/observability/rum.ts',
  '.github/instructions/observability.instructions.md',
  'docs/runbooks/phase-44-debug-from-trace.md',
  'docs/runbooks/phase-44-respond-to-burn-alert.md',
  'docs/runbooks/phase-44-add-new-slo.md'
)
$missing = $mustExist | Where-Object { -not (Test-Path $_) }
if ($missing) {
  "Required artifacts missing:" | Tee-Object -FilePath $log -Append
  $missing | ForEach-Object { "  - $_" | Tee-Object -FilePath $log -Append }
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

# 4. Go build + test.
"=== GO_BUILD ===" | Tee-Object -FilePath $log -Append
go build ./... 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE }

"=== GO_TEST ===" | Tee-Object -FilePath $log -Append
go test -race -count=1 ./internal/tracing/... ./internal/metrics/... ./internal/api/... 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE }

# 5. Helm lint + template.
"=== HELM_LINT ===" | Tee-Object -FilePath $log -Append
helm lint helm/teslasync 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE }
helm template t helm/teslasync 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { "helm template failed" | Tee-Object -FilePath $log -Append; "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE }

# 6. Frontend build (incl. RUM).
"=== FRONTEND_BUILD ===" | Tee-Object -FilePath $log -Append
Push-Location web
npx tsc --noEmit 2>&1 | Tee-Object -FilePath $log -Append
$tscExit = $LASTEXITCODE
if ($tscExit -eq 0) { npm run build 2>&1 | Tee-Object -FilePath $log -Append; $buildExit = $LASTEXITCODE } else { $buildExit = 1 }
Pop-Location
if ($tscExit -ne 0 -or $buildExit -ne 0) { "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

# 7. SLO catalog still valid.
"=== SLO_CATALOG ===" | Tee-Object -FilePath $log -Append
go run ./cmd/slogen validate slo/catalog.yaml 2>&1 | Tee-Object -FilePath $log -Append
if ($LASTEXITCODE -ne 0) { "EXIT=$LASTEXITCODE" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $LASTEXITCODE }

# 8. Working tree clean.
$status = git status --porcelain
$allowed = @($log)
$badLines = $status | Where-Object { $line = $_; -not ($allowed | Where-Object { $line -match [regex]::Escape($_) }) }
if ($badLines) { "Working tree dirty:" | Tee-Object -FilePath $log -Append; $badLines | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"Phase-44 complete. Observability stack live, additive invariant held." | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
exit 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/logs/phase-44-9999-final-gate.log
git commit -m "phase-44(9999): final gate — observability deepening complete

All 30 prior prompts DONE. Tempo + OTel + SLOs + RUM live. Additive only.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
