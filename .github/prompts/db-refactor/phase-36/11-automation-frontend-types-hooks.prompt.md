---
description: "Phase 36 - automation frontend types and hooks"
---

# Prompt 11 - Automation Frontend Types and Hooks

> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-36-11-automation-frontend-types-hooks.log` |
| Depends on | `phase-36-10-automation-step-persistence.log` |
| Allowed files to change | `web/src/api/types.ts`, `web/src/api/hooks/useAutomations.ts`, `web/src/types/automations.ts`, `web/src/lib/automations.ts`, and the log file |

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

Frontend automation hooks and types must match the typed CTI contract before the builder is refactored.

## Backend Kind and Field Mapping

Use backend-shaped names from the Go models and JSON tags. Do not keep frontend-only kind aliases or bridge fields.

| Old frontend surface | New backend-shaped surface |
|---|---|
| `position` | `step_order` |
| `trigger_time` | `trigger_schedule` |
| `trigger_webhook` | deleted; no CTI kind exists in the typed backend contract |
| `condition_day_of_week` | `condition_time_window.days_of_week` |
| `action_notification` | `action_notify` |
| `action_vehicle_command` | `action_command` |
| `action_set_state` | `action_set_setting` |
| `signal_name` in automation steps | `signal` |
| `operator` | `op` |
| `threshold_numeric`, `compare_numeric` | `value_num` |
| `threshold_text`, `compare_text` | `value_text` |
| `threshold_bool`, `compare_bool` | `value_bool` |
| `geofence_id` | `place_id` |
| `direction` | `event` (`either` maps to `both`) |
| `must_be_inside` | `state` (`inside` or `outside`) |
| `command` | `command_name` |
| `state_key` | `setting_key` |

## Action Steps

1. Verify Prompt 10 is DONE.
2. Update `web/src/types/automations.ts` to use backend-shaped names from the table above: `step_order`, `signal`, `op`, `value_num`, `value_text`, `value_bool`, `value_min`, `value_max`, `place_id`, `event`, `channel_id`, and backend `kind` discriminators.
3. Update `AutomationFullInput` in `useAutomations.ts` to use typed `triggers`, `conditions`, and `actions`.
4. Remove old root fields from API-facing automation types: `trigger_type`, `trigger_config`, root loose JSON `actions`, `notify_channels`, `cooldown_minutes`, `max_executions_hour`, `priority`, and `tags`.
5. Remove frontend-only kind aliases: `trigger_time`, `trigger_webhook`, `condition_day_of_week`, `action_notification`, `action_vehicle_command`, and `action_set_state`.
6. Keep hook URLs without `/api/v1/` and query params snake_case.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-36-11-automation-frontend-types-hooks.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-36-10-automation-step-persistence.log"
if (-not (Test-Path $prev) -or -not (Select-String -Path $prev -Pattern "^EXIT=0$" -Quiet) -or -not (Select-String -Path $prev -Pattern "^STATUS=DONE$" -Quiet)) {
  "Predecessor log missing or not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

$anchors = @{
  "AUTOMATION_FULL_INPUT" = (Select-String -Path "web\src\api\hooks\useAutomations.ts" -Pattern "AutomationFullInput" -Quiet)
  "TYPED_STEP_FIELDS" = (Select-String -Path "web\src\types\automations.ts" -Pattern "step_order|signal|op|value_num|value_text|value_bool|value_min|value_max|channel_id" -Quiet)
  "TYPED_KINDS" = (Select-String -Path "web\src\types\automations.ts" -Pattern "trigger_schedule|condition_other_automation|action_notify|action_command|action_set_setting|action_call_automation" -Quiet)
}
foreach ($key in $anchors.Keys) { "$key=$($anchors[$key])" | Tee-Object -FilePath $log -Append }
if ($anchors.Values -contains $false) { "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

$legacy = Select-String -Path "web\src\api\types.ts","web\src\api\hooks\useAutomations.ts","web\src\types\automations.ts" -Pattern "trigger_config|notify_channels|threshold_numeric|threshold_text|threshold_bool|compare_numeric|compare_text|compare_bool|operator: '=='|trigger_time|trigger_webhook|condition_day_of_week|action_notification|action_vehicle_command|action_set_state|position:" -ErrorAction SilentlyContinue
"AUTOMATION_LEGACY_TYPE_REF_COUNT=$(@($legacy).Count)" | Tee-Object -FilePath $log -Append
if ($legacy) { $legacy | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

Set-Location web
$tscOutput = npx tsc --noEmit 2>&1
$tsExit = $LASTEXITCODE
$tscOutput | Tee-Object -FilePath "..\$log" -Append
Set-Location ..
"TSC_FULL_EXIT=$tsExit" | Tee-Object -FilePath $log -Append
$tsErrors = @($tscOutput | Where-Object { $_ -match '^src[\\/].*\(\d+,\d+\): error TS' })
$allowedFilePattern = '^src[\\/](api[\\/]types\.ts|api[\\/]hooks[\\/]useAutomations\.ts|types[\\/]automations\.ts|lib[\\/]automations\.ts)\(\d+,\d+\): error TS'
$expectedCascadePattern = '^src[\\/]features[\\/]automations[\\/]pages[\\/](AutomationBuilderPage|AutomationsListPage|PresetGallery)\.tsx\(\d+,\d+\): error TS'
$allowedFileErrors = $tsErrors | Where-Object { $_ -match $allowedFilePattern }
$expectedCascadeErrors = $tsErrors | Where-Object { $_ -match $expectedCascadePattern }
$unexpectedTsErrors = $tsErrors | Where-Object { $_ -notmatch $allowedFilePattern -and $_ -notmatch $expectedCascadePattern }
"AUTOMATION_API_TSC_ALLOWED_FILE_ERROR_COUNT=$(@($allowedFileErrors).Count)" | Tee-Object -FilePath $log -Append
"EXPECTED_AUTOMATION_CONSUMER_TSC_ERROR_COUNT=$(@($expectedCascadeErrors).Count)" | Tee-Object -FilePath $log -Append
"UNEXPECTED_TSC_ERROR_COUNT=$(@($unexpectedTsErrors).Count)" | Tee-Object -FilePath $log -Append
if ($allowedFileErrors -or $unexpectedTsErrors) {
  $allowedFileErrors | Tee-Object -FilePath $log -Append
  $unexpectedTsErrors | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

$status = git --no-pager status --short
$unexpected = $status | Where-Object {
  $_ -notmatch "web[\\/]src[\\/]api[\\/]types\.ts$" -and
  $_ -notmatch "web[\\/]src[\\/]api[\\/]hooks[\\/]useAutomations\.ts$" -and
  $_ -notmatch "web[\\/]src[\\/]types[\\/]automations\.ts$" -and
  $_ -notmatch "web[\\/]src[\\/]lib[\\/]automations\.ts$" -and
  $_ -notmatch "\.github[\\/]prompts[\\/]db-refactor[\\/]logs[\\/]phase-36-11-automation-frontend-types-hooks\.log$"
}
"UNEXPECTED_STATUS_COUNT=$(@($unexpected).Count)" | Tee-Object -FilePath $log -Append
if ($unexpected) { $unexpected | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
```

## Commit

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-36-11-automation-frontend-types-hooks.log"
git add -f -- web\src\api\types.ts web\src\api\hooks\useAutomations.ts web\src\types\automations.ts web\src\lib\automations.ts $log
git commit -m "phase-36/11-automations: type frontend hooks

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If allowed automation API/type files have TypeScript errors, unexpected TypeScript errors appear outside the known automation-page cascade, or legacy automation API fields remain, write `EXIT=<nonzero>` and `STATUS=BLOCKED` to the log, then commit only the log if possible.

