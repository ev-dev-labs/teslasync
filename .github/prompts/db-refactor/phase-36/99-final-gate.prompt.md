---
description: "Phase 36 - final typed rules-platform gate"
---

# Prompt 99 - Final Typed Rules-Platform Gate

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-36-99-final-gate.log` |
| Depends on | `phase-36-00A`, `phase-36-00B`, `phase-36-01` through `phase-36-13`, `phase-36-13A`, and `phase-36-14` through `phase-36-15` |
| Allowed files to change | the log file only |

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

Write `=== PREFLIGHT ===`, `=== SURVEY ===`, `=== REASONING ===`, `=== CHANGES ===`, `=== GATE ===`, and `=== COMMIT ===` to the output log.

## Problem

The final gate proves Phase 36 completed as a typed, clean-slate rules-platform reset without resurrecting old alert CEP or automation JSON surfaces.

## Final Governance Gate

This gate also proves the phase stayed within the approved strategic posture: clean-slate only, no schema changes, no hidden compatibility layer, no over-engineered workflow/DSL infrastructure, documented operator impact, and no new auth or data-source boundary violations.

## Action Steps

1. Do not edit source code or docs.
2. Verify all predecessor logs have `EXIT=0` and `STATUS=DONE`.
3. Verify Prompt 00A clean-slate markers remain zero and Prompt 00B inventory is DONE.
4. Run all checks exactly as written.
5. If any check fails, write `EXIT=1` and `STATUS=BLOCKED`.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-36-99-final-gate.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
Set-Content -Path $log -Value "=== PREFLIGHT ==="
"=== SURVEY ===" | Tee-Object -FilePath $log -Append
"Final gate checks predecessor logs, clean-slate markers, typed alert contracts, typed automation contracts, route conventions, governance posture, tests, TypeScript, docs, and drift." | Tee-Object -FilePath $log -Append
"=== REASONING ===" | Tee-Object -FilePath $log -Append
"No code changes are allowed in this gate." | Tee-Object -FilePath $log -Append
"=== CHANGES ===" | Tee-Object -FilePath $log -Append
"No source files changed." | Tee-Object -FilePath $log -Append
"=== GATE ===" | Tee-Object -FilePath $log -Append

$failed = $false
$predecessors = @(
  ".github\prompts\db-refactor\logs\phase-36-00-clean-slate-decision-record.log",
  ".github\prompts\db-refactor\logs\phase-36-00-typed-alert-rule-inventory.log",
  ".github\prompts\db-refactor\logs\phase-36-01-alert-api-contract-tests.log",
  ".github\prompts\db-refactor\logs\phase-36-02-alert-handler-validation.log",
  ".github\prompts\db-refactor\logs\phase-36-03-alert-evaluator-typed-ops.log",
  ".github\prompts\db-refactor\logs\phase-36-04-alert-frontend-types-hooks.log",
  ".github\prompts\db-refactor\logs\phase-36-05-alert-studio-save-path.log",
  ".github\prompts\db-refactor\logs\phase-36-06-alert-studio-ui-polish.log",
  ".github\prompts\db-refactor\logs\phase-36-07-alert-legacy-cleanup.log",
  ".github\prompts\db-refactor\logs\phase-36-08-automation-api-contract-tests.log",
  ".github\prompts\db-refactor\logs\phase-36-09-automation-backend-input-dto.log",
  ".github\prompts\db-refactor\logs\phase-36-10-automation-step-persistence.log",
  ".github\prompts\db-refactor\logs\phase-36-11-automation-frontend-types-hooks.log",
  ".github\prompts\db-refactor\logs\phase-36-12-automation-builder-typed-state.log",
  ".github\prompts\db-refactor\logs\phase-36-13-automation-import-export-reset.log",
  ".github\prompts\db-refactor\logs\phase-36-13a-automation-runtime-typed-contract.log",
  ".github\prompts\db-refactor\logs\phase-36-14-rules-platform-copy-docs.log",
  ".github\prompts\db-refactor\logs\phase-36-15-grafana-rules-platform-dashboards.log"
)
$badLogs = foreach ($prev in $predecessors) {
  if (-not (Test-Path $prev)) { "$prev missing"; continue }
  if (-not (Select-String -Path $prev -Pattern "^EXIT=0$" -Quiet)) { "$prev missing EXIT=0" }
  if (-not (Select-String -Path $prev -Pattern "^STATUS=DONE$" -Quiet)) { "$prev missing STATUS=DONE" }
}
"BAD_LOG_COUNT=$(@($badLogs).Count)" | Tee-Object -FilePath $log -Append
if ($badLogs) { $badLogs | Tee-Object -FilePath $log -Append; $failed = $true }

$decision = ".github\prompts\db-refactor\logs\phase-36-00-clean-slate-decision-record.log"
$cleanSlate = @{
  "ALERT_RULE_COUNT_ZERO" = (Select-String -Path $decision -Pattern "^ALERT_RULE_COUNT=0$" -Quiet)
  "AUTOMATION_COUNT_ZERO" = (Select-String -Path $decision -Pattern "^AUTOMATION_COUNT=0$" -Quiet)
  "AUTOMATION_STEP_COUNT_ZERO" = (Select-String -Path $decision -Pattern "^AUTOMATION_STEP_COUNT=0$" -Quiet)
  "AUTOMATION_HISTORY_COUNT_ZERO" = (Select-String -Path $decision -Pattern "^AUTOMATION_HISTORY_COUNT=0$" -Quiet)
}
foreach ($key in $cleanSlate.Keys) { "$key=$($cleanSlate[$key])" | Tee-Object -FilePath $log -Append }
if ($cleanSlate.Values -contains $false) { $failed = $true }

$inventory = ".github\prompts\db-refactor\logs\phase-36-00-typed-alert-rule-inventory.log"
$governanceMarkers = @{
  "INVENTORY_ARCH_BOUNDARY" = "ARCHITECTURAL_BOUNDARY_CONTRACT"
  "INVENTORY_GOVERNANCE" = "STRATEGIC_GOVERNANCE_AND_RISK_POSTURE"
  "INVENTORY_ROLLBACK" = "rollback"
  "INVENTORY_NO_SCHEMA_CHANGE" = "no-schema-change|no schema change"
  "INVENTORY_NON_GOALS" = "Non-goals"
}
foreach ($key in $governanceMarkers.Keys) {
  $found = Select-String -Path $inventory -Pattern $governanceMarkers[$key] -Quiet
  "$key=$found" | Tee-Object -FilePath $log -Append
  if (-not $found) { $failed = $true }
}

$alertLegacy = Select-String -Path "internal\api\rule_engine.go","internal\api\rule_engine_test.go","web\src\api\hooks\useNotifications.ts","web\src\features\notifications\pages\AlertStudioPage.tsx","web\src\api\types.ts" -Pattern "RuleConditionTree|msg_template|notify_channels|\bthreshold\s*:|json:`"threshold|changed_to|changed_from|is_true|is_false|contains|RuleBuilder" -ErrorAction SilentlyContinue
"ALERT_LEGACY_REF_COUNT=$(@($alertLegacy).Count)" | Tee-Object -FilePath $log -Append
if ($alertLegacy) { $alertLegacy | Tee-Object -FilePath $log -Append; $failed = $true }

$automationLegacy = Select-String -Path "internal\api\automation_handler.go","web\src\api\hooks\useAutomations.ts","web\src\types\automations.ts","web\src\features\automations\pages\*.tsx" -Pattern "trigger_config|notify_channels|conditions\??:\s*Record<string, unknown>|actions\??:\s*Record<string, unknown>|threshold_numeric|compare_numeric|operator: '=='|trigger_time|trigger_webhook|condition_day_of_week|action_notification|action_vehicle_command|action_set_state|legacy JSON" -ErrorAction SilentlyContinue
"AUTOMATION_LEGACY_REF_COUNT=$(@($automationLegacy).Count)" | Tee-Object -FilePath $log -Append
if ($automationLegacy) { $automationLegacy | Tee-Object -FilePath $log -Append; $failed = $true }

$runtimeFiles = @()
$runtimeFiles += Get-ChildItem "internal\automation" -Recurse -File -Include *.go | ForEach-Object FullName
$runtimeFiles += Get-ChildItem "internal\worker" -Recurse -File -Include *.go | ForEach-Object FullName
$runtimeFiles += "internal\models\automation.go","internal\database\automation_repo.go","internal\database\automation_step_child_repo.go"
$runtimeLegacy = Select-String -Path $runtimeFiles -Pattern "TriggerConfig\(|trigger_config|ValidateTriggerConfig|parse[A-Za-z0-9]*Config\(" -ErrorAction SilentlyContinue
"AUTOMATION_RUNTIME_LEGACY_REF_COUNT=$(@($runtimeLegacy).Count)" | Tee-Object -FilePath $log -Append
if ($runtimeLegacy) { $runtimeLegacy | Tee-Object -FilePath $log -Append; $failed = $true }

$runtimeSearchFiles = @($runtimeFiles) + @("internal\api\rule_engine.go","internal\api\telemetry_alerts.go")
$forbiddenRuntimeDataSources = Select-String -Path $runtimeSearchFiles -Pattern "vehicle_live_state|signal_history|FROM positions|JOIN positions|battery_snapshots|state_snapshots|climate_snapshots|tire_pressure_snapshots|security_snapshots|media_state|location_snapshots|safety_snapshots|user_preference_snapshots" -ErrorAction SilentlyContinue
"FORBIDDEN_RUNTIME_DATA_SOURCE_COUNT=$(@($forbiddenRuntimeDataSources).Count)" | Tee-Object -FilePath $log -Append
if ($forbiddenRuntimeDataSources) { $forbiddenRuntimeDataSources | Tee-Object -FilePath $log -Append; $failed = $true }

$grafanaOldSql = Select-String -Path "grafana\dashboards\system\alerts-notifications.json" -Pattern 'type AS|expression|threshold::text|threshold AS|msg_template|notify_channels' -ErrorAction SilentlyContinue
"GRAFANA_OLD_ALERT_SQL_COUNT=$(@($grafanaOldSql).Count)" | Tee-Object -FilePath $log -Append
if ($grafanaOldSql) { $grafanaOldSql | Tee-Object -FilePath $log -Append; $failed = $true }

$grafanaTypedSql = Select-String -Path "grafana\dashboards\system\alerts-notifications.json" -Pattern "signal_name|value_num|value_text|value_bool|value_min|value_max|op" -Quiet
"GRAFANA_TYPED_ALERT_SQL=$grafanaTypedSql" | Tee-Object -FilePath $log -Append
if (-not $grafanaTypedSql) { $failed = $true }

$grafanaUid = Select-String -Path "grafana\dashboards\infra\cep-rule-engine.json" -Pattern '"uid"\s*:\s*"teslasync-infra-cep"' -Quiet
"GRAFANA_UID_PRESERVED=$grafanaUid" | Tee-Object -FilePath $log -Append
if (-not $grafanaUid) { $failed = $true }

$requiredPromMetrics = @(
  "teslasync_cep_active_rules",
  "teslasync_cep_rules_evaluated_total",
  "teslasync_cep_rules_cooldown_skipped_total",
  "teslasync_cep_eval_duration_seconds_bucket",
  "teslasync_cep_rules_fired_total"
)
$missingPromMetrics = $requiredPromMetrics | Where-Object { -not (Select-String -Path "grafana\dashboards\infra\cep-rule-engine.json" -Pattern $_ -Quiet) }
"GRAFANA_MISSING_PROM_CEP_METRIC_COUNT=$(@($missingPromMetrics).Count)" | Tee-Object -FilePath $log -Append
if ($missingPromMetrics) { $missingPromMetrics | Tee-Object -FilePath $log -Append; $failed = $true }

$linkFiles = @("grafana\dashboards\infra\api-performance.json","grafana\dashboards\infra\infrastructure.json")
$missingGrafanaLinks = $linkFiles | Where-Object { -not (Select-String -Path $_ -Pattern "/d/teslasync-infra-cep" -Quiet) }
"GRAFANA_MISSING_STABLE_LINK_COUNT=$(@($missingGrafanaLinks).Count)" | Tee-Object -FilePath $log -Append
if ($missingGrafanaLinks) { $missingGrafanaLinks | Tee-Object -FilePath $log -Append; $failed = $true }

$doublePrefix = Select-String -Path "web\src\api\hooks\*.ts","web\src\api\settings.ts" -Pattern "/api/v1/" -ErrorAction SilentlyContinue
$camelParams = Select-String -Path "web\src\api\hooks\*.ts","web\src\api\settings.ts" -Pattern "vehicleId=|driveId=|sessionId=|chargingId=" -ErrorAction SilentlyContinue
"DOUBLE_PREFIX_COUNT=$(@($doublePrefix).Count)" | Tee-Object -FilePath $log -Append
"CAMEL_PARAM_COUNT=$(@($camelParams).Count)" | Tee-Object -FilePath $log -Append
if ($doublePrefix -or $camelParams) { $failed = $true }

$platformFiles = @()
$platformFiles += Get-ChildItem "internal" -Recurse -File -Include *.go -ErrorAction SilentlyContinue | ForEach-Object FullName
$platformFiles += Get-ChildItem "web\src" -Recurse -File -Include *.ts,*.tsx -ErrorAction SilentlyContinue | ForEach-Object FullName
$forbiddenInfra = Select-String -Path $platformFiles -Pattern "github.com/open-policy-agent|open-policy-agent/opa|cel-go|go.temporal.io|temporalio|cadence-workflow|nats.go|segmentio/kafka-go|confluent-kafka-go|rabbitmq/amqp|amqp091-go" -ErrorAction SilentlyContinue
"FORBIDDEN_NEW_PLATFORM_INFRA_COUNT=$(@($forbiddenInfra).Count)" | Tee-Object -FilePath $log -Append
if ($forbiddenInfra) { $forbiddenInfra | Tee-Object -FilePath $log -Append; $failed = $true }

$schemaDrift = git --no-pager status --short -- migrations helm docker-compose.yml Dockerfile Dockerfile.* 2>$null
"SCHEMA_OR_INFRA_DRIFT_COUNT=$(@($schemaDrift).Count)" | Tee-Object -FilePath $log -Append
if ($schemaDrift) { $schemaDrift | Tee-Object -FilePath $log -Append; $failed = $true }

$docsFiles = @(
  "docs\index.md","docs\api-reference.md","docs\contributing\api-reference.md","docs\contributing\code-structure.md",
  "docs\features\alerts.md","docs\features\vehicle-tracking.md","docs\guide\api-endpoints.md","docs\guide\architecture.md",
  "docs\guide\database.md","docs\guide\roadmap.md","docs\caching.md"
) | Where-Object { Test-Path $_ }
$docsGovernance = @{
  "DOCS_CLEAN_SLATE" = "clean-slate|zero.*counts|counts.*zero"
  "DOCS_BREAKING_CHANGE" = "breaking change|rejected rather than silently translated|not migrated"
  "DOCS_ROLLBACK" = "rollback|code rollback|redeploy"
  "DOCS_FUTURE_EXTENSIBILITY" = "future.*trigger|new.*operator|typed CTI"
}
foreach ($key in $docsGovernance.Keys) {
  $found = Select-String -Path $docsFiles -Pattern $docsGovernance[$key] -Quiet
  "$key=$found" | Tee-Object -FilePath $log -Append
  if (-not $found) { $failed = $true }
}

$env:CGO_ENABLED = "0"
go test ./internal/api ./internal/automation/... -run "Test.*Rule|Test.*Alert|Test.*Automation|Test.*Trigger|Test.*Condition|Test.*Action" 2>&1 | Tee-Object -FilePath $log -Append
$goApiExit = $LASTEXITCODE
"GO_API_TEST_EXIT=$goApiExit" | Tee-Object -FilePath $log -Append
if ($goApiExit -ne 0) { $failed = $true }

Set-Location web
npx tsc --noEmit 2>&1 | Tee-Object -FilePath "..\$log" -Append
$tsExit = $LASTEXITCODE
Set-Location ..
"TSC_EXIT=$tsExit" | Tee-Object -FilePath $log -Append
if ($tsExit -ne 0) { $failed = $true }

if (Test-Path docs\package.json) {
  Set-Location docs
  npm run docs:build 2>&1 | Tee-Object -FilePath "..\$log" -Append
  $docsExit = $LASTEXITCODE
  Set-Location ..
} else { $docsExit = 0 }
"DOCS_BUILD_EXIT=$docsExit" | Tee-Object -FilePath $log -Append
if ($docsExit -ne 0) { $failed = $true }

$status = git --no-pager status --short
$unexpected = $status | Where-Object { $_ -notmatch "\.github[\\/]prompts[\\/]db-refactor[\\/]logs[\\/]phase-36-99-final-gate\.log$" }
"UNEXPECTED_STATUS_COUNT=$(@($unexpected).Count)" | Tee-Object -FilePath $log -Append
if ($unexpected) { $unexpected | Tee-Object -FilePath $log -Append; $failed = $true }

if ($failed) {
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}
"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
```

## Commit

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-36-99-final-gate.log"
git add -f -- $log
git commit -m "phase-36/99-gate: verify typed rules platform

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If any check fails, write `EXIT=1` and `STATUS=BLOCKED` to the log, then commit only the log if possible.

