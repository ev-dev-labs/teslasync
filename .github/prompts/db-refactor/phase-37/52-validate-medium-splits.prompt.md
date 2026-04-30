---
description: "Phase 37 - Re-run gates against all medium-split outputs from prompts 28-51"
---

# Prompt 52 - Validate Medium Splits (Prompts 28-51)

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-37-52-validate-medium-splits.log` |
| Depends on | [`.github/prompts/db-refactor/logs/phase-37-51-split-metrics.log`](../logs/phase-37-51-split-metrics.log) STATUS=DONE |
| Allowed files to change | `.github/prompts/db-refactor/logs/phase-37-52-validate-medium-splits.log` (validation log only - no source edits permitted) |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1. No red-as-green - EXIT != 0 means STATUS=BLOCKED, no exceptions.
2. No scope narrowing - run the exact gate command, no subsets.
3. No skip-and-assume - cannot run gate means BLOCKED, never DONE.
4. No field resurrection - do not add back deleted fields to "fix" things.
5. No stubs - no `return nil`, `// TODO`, or `panic("not impl")`.
6. No delegation - NO sub-agents, NO parallel, NO background tasks.
7. No predecessor bypass - verify predecessor STATUS=DONE first when a predecessor exists.
8. No commit on red - commit only the log when BLOCKED.
9. No silent drift - `git status` outside allowed files means BLOCKED.
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on their own lines.
<!-- END COVENANT -->

## Logging Requirements

Append the following sections to the log in order: `## PREFLIGHT`, `## SURVEY`, `## REASONING`, `## CHANGES`, `## GATE`, `## COMMIT`. The GATE section MUST end with two lines containing exactly `EXIT=<int>` and `STATUS=DONE` or `STATUS=BLOCKED`.

## Problem

The preceding split prompts decomposed `internal/api/router.go` into multiple cohesive files in
package `api`. This prompt validates that the split preserved all behavior,
public APIs, SQL, JSON, route, config, and runtime ordering. **No `.go` file
may be edited in this prompt.** If a regression is found, mark BLOCKED and
defer the fix to a follow-up prompt.

## Action Steps

1. Verify predecessor: `.github/prompts/db-refactor/logs/phase-37-51-split-metrics.log` exists with `EXIT=0` and `STATUS=DONE`.
2. Confirm every expected file exists and declares `package api`:
  - `internal/api/router.go`
  - `internal/api/router_routes_telemetry.go`
  - `internal/api/router_routes_admin.go`
  - `internal/api/router_middleware.go`
  - `internal/api/devtools_handler_dtos.go`
  - `internal/api/devtools_handler_logs.go`
  - `internal/api/devtools_handler_database.go`
  - `internal/models/vehicle.go`
  - `internal/models/drive.go`
  - `internal/models/charging.go`
  - `internal/models/telemetry.go`
  - `internal/api/battery_degradation_handler_dtos.go`
  - `internal/api/battery_degradation_handler_calculations.go`
  - `internal/api/drive_handler_dtos.go`
  - `internal/api/drive_handler_listing.go`
  - `internal/api/drive_handler_detail.go`
  - `cmd/teslasync/setup.go`
  - `cmd/teslasync/lifecycle.go`
  - `internal/database/signal_history_writer_buffer.go`
  - `internal/database/signal_history_writer_flush.go`
  - `internal/database/automation_step_child_repo_persistence.go`
  - `internal/database/automation_step_child_repo_query.go`
  - `internal/automation/engine_evaluation.go`
  - `internal/automation/engine_execution.go`
  - `internal/worker/worker_jobs.go`
  - `internal/worker/worker_lifecycle.go`
  - `internal/api/range_projection_handler_dtos.go`
  - `internal/api/range_projection_handler_compute.go`
  - `internal/api/alert_handler_dtos.go`
  - `internal/api/alert_handler_rules.go`
  - `internal/api/charging_optimizer_handler_dtos.go`
  - `internal/api/charging_optimizer_handler_compute.go`
  - `internal/api/fsm_handler_dtos.go`
  - `internal/api/fsm_handler_query.go`
  - `internal/api/charge_planner_handler_dtos.go`
  - `internal/api/charge_planner_handler_compute.go`
  - `internal/api/analytics_handler_dtos.go`
  - `internal/api/analytics_handler_queries.go`
  - `internal/database/signal_log_reader_query.go`
  - `internal/database/signal_log_reader_aggregations.go`
  - `internal/api/trip_planner_handler_dtos.go`
  - `internal/api/trip_planner_handler_compute.go`
  - `internal/enums/parse_drive.go`
  - `internal/enums/parse_charging.go`
  - `internal/enums/parse_climate.go`
  - `internal/api/tesla_energy_history_handler_dtos.go`
  - `internal/api/tesla_energy_history_handler_query.go`
  - `internal/database/notification_repo_logs.go`
  - `internal/database/notification_repo_rules.go`
  - `internal/database/automation_repo_query.go`
  - `internal/database/automation_repo_mutation.go`
  - `internal/api/chatbot_handler_dtos.go`
  - `internal/api/chatbot_handler_chat.go`
  - `internal/metrics/metrics_telemetry.go`
  - `internal/metrics/metrics_drive_charging.go`
3. Re-run `gofmt -l` on every expected file (output must be empty).
4. Re-run `go build ./...`, `go vet ./internal/api`, and
   `go test ./internal/api -race -count=1`.
5. Inspect the diff range covered by the split commits and confirm:
   - no exported identifier was renamed or removed
   - no JSON tag, SQL string literal, error message, or log field changed
   - no route registration moved or changed path/method
   - no config key was added, removed, or renamed
   - import ordering changes are limited to gofmt-managed grouping
6. Do not edit any `.go` file. The only file permitted to change in this
   prompt is the validation log itself.

## Gate

```powershell
$log = '.github/prompts/db-refactor/logs/phase-37-52-validate-medium-splits.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"## PREFLIGHT" | Set-Content -Path $log
"start_utc=$([DateTimeOffset]::UtcNow.ToString('o'))" | Add-Content $log
$exit = 0

$prev = '.github/prompts/db-refactor/logs/phase-37-51-split-metrics.log'
if (-not (Test-Path $prev)) { "predecessor log missing: $prev" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $prev -Pattern '^EXIT=0$' -Quiet)) { "predecessor not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $prev -Pattern '^STATUS=DONE$' -Quiet)) { "predecessor not STATUS=DONE" | Add-Content $log; $exit = 1 }

"## SURVEY" | Add-Content $log
$expected = @('internal/api/router.go', 'internal/api/router_routes_telemetry.go', 'internal/api/router_routes_admin.go', 'internal/api/router_middleware.go', 'internal/api/devtools_handler_dtos.go', 'internal/api/devtools_handler_logs.go', 'internal/api/devtools_handler_database.go', 'internal/models/vehicle.go', 'internal/models/drive.go', 'internal/models/charging.go', 'internal/models/telemetry.go', 'internal/api/battery_degradation_handler_dtos.go', 'internal/api/battery_degradation_handler_calculations.go', 'internal/api/drive_handler_dtos.go', 'internal/api/drive_handler_listing.go', 'internal/api/drive_handler_detail.go', 'cmd/teslasync/setup.go', 'cmd/teslasync/lifecycle.go', 'internal/database/signal_history_writer_buffer.go', 'internal/database/signal_history_writer_flush.go', 'internal/database/automation_step_child_repo_persistence.go', 'internal/database/automation_step_child_repo_query.go', 'internal/automation/engine_evaluation.go', 'internal/automation/engine_execution.go', 'internal/worker/worker_jobs.go', 'internal/worker/worker_lifecycle.go', 'internal/api/range_projection_handler_dtos.go', 'internal/api/range_projection_handler_compute.go', 'internal/api/alert_handler_dtos.go', 'internal/api/alert_handler_rules.go', 'internal/api/charging_optimizer_handler_dtos.go', 'internal/api/charging_optimizer_handler_compute.go', 'internal/api/fsm_handler_dtos.go', 'internal/api/fsm_handler_query.go', 'internal/api/charge_planner_handler_dtos.go', 'internal/api/charge_planner_handler_compute.go', 'internal/api/analytics_handler_dtos.go', 'internal/api/analytics_handler_queries.go', 'internal/database/signal_log_reader_query.go', 'internal/database/signal_log_reader_aggregations.go', 'internal/api/trip_planner_handler_dtos.go', 'internal/api/trip_planner_handler_compute.go', 'internal/enums/parse_drive.go', 'internal/enums/parse_charging.go', 'internal/enums/parse_climate.go', 'internal/api/tesla_energy_history_handler_dtos.go', 'internal/api/tesla_energy_history_handler_query.go', 'internal/database/notification_repo_logs.go', 'internal/database/notification_repo_rules.go', 'internal/database/automation_repo_query.go', 'internal/database/automation_repo_mutation.go', 'internal/api/chatbot_handler_dtos.go', 'internal/api/chatbot_handler_chat.go', 'internal/metrics/metrics_telemetry.go', 'internal/metrics/metrics_drive_charging.go')
foreach ($f in $expected) {
  if (-not (Test-Path $f)) {
    "missing expected file: $f" | Add-Content $log
    $exit = 1
  } else {
    $head = (Get-Content -LiteralPath $f -TotalCount 80) -join "`n"
    if ($head -notmatch '(?m)^package\s+api\b') {
      "wrong package decl in $f (expected package api)" | Add-Content $log
      $exit = 1
    }
    $lc = (Get-Content -LiteralPath $f | Measure-Object -Line).Lines
    "expected_file=$f lines=$lc" | Add-Content $log
  }
}

"## REASONING" | Add-Content $log
"validation only - confirm split preserved behavior, no source edits" | Add-Content $log

"## CHANGES" | Add-Content $log
"none (validation only)" | Add-Content $log

"## GATE" | Add-Content $log
$env:CGO_ENABLED = '0'
$gofmtOut = gofmt -l $expected 2>&1
if ($LASTEXITCODE -ne 0 -or $gofmtOut) {
  "gofmt issues:" | Add-Content $log
  $gofmtOut | Out-String | Add-Content $log
  $exit = 1
}

$buildOut = & go build ./... 2>&1
$buildExit = $LASTEXITCODE
"go build exit=$buildExit" | Add-Content $log
$buildOut | Out-String | Add-Content $log
if ($buildExit -ne 0) { $exit = 1 }

if ($exit -eq 0) {
  $vetOut = & go vet ./internal/api 2>&1
  $vetExit = $LASTEXITCODE
  "go vet exit=$vetExit" | Add-Content $log
  $vetOut | Out-String | Add-Content $log
  if ($vetExit -ne 0) { $exit = 1 }
} else {
  "skipping go vet because earlier step failed" | Add-Content $log
}

if ($exit -eq 0) {
  $testOut = & go test ./internal/api -race -count=1 2>&1
  $testExit = $LASTEXITCODE
  "go test exit=$testExit" | Add-Content $log
  $testOut | Out-String | Add-Content $log
  if ($testExit -ne 0) { $exit = 1 }
} else {
  "skipping go test because earlier step failed" | Add-Content $log
}

$drift = git --no-pager status --short
if ($drift) {
  $allowed = '^\s*[?MAR]+\s+\.github[\\/]prompts[\\/]db-refactor[\\/]logs[\\/]phase-37-52-validate-medium-splits\.log$'
  $bad = $drift | Where-Object { $_ -notmatch $allowed }
  if ($bad) {
    "drift detected (validation prompts must not edit Go files):" | Add-Content $log
    $bad | Add-Content $log
    $exit = 1
  }
}

"EXIT=$exit" | Add-Content $log
if ($exit -eq 0) { "STATUS=DONE" | Add-Content $log } else { "STATUS=BLOCKED" | Add-Content $log }
exit $exit
```

## Commit

```powershell
git add -f '.github/prompts/db-refactor/logs/phase-37-52-validate-medium-splits.log'
git commit -m "chore(phase-37): prompt 52 - validate split of internal/api/router.go" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If `STATUS=BLOCKED`, do not author a fix prompt yet. Re-read the failing
output, mark the validation log committed, and decide whether to defer the
fix as a follow-up prompt or to revert the split commits and retry.
