---
description: "Phase 36 - automation builder typed state"
---

# Prompt 12 - Automation Builder Typed State

> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-36-12-automation-builder-typed-state.log` |
| Depends on | `phase-36-11-automation-frontend-types-hooks.log` |
| Allowed files to change | files under `web/src/features/automations/pages/`, optional new files under `web/src/features/automations/components/`, and the log file |

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

Automation Builder still bridges through loose `Record<string, unknown>` state and old `type` discriminators. Refactor the UI state to typed `AutomationStepInput` arrays.

## Action Steps

1. Verify Prompt 11 is DONE.
2. Replace builder state with typed `triggers`, `conditions`, and `actions` arrays.
3. Refactor trigger, condition, and action configurators to emit typed step inputs directly.
4. Remove old fields from the form state: `trigger_type`, `trigger_config`, `notify_channels`, and legacy record `type` discriminators.
5. Use backend kind strings only: `trigger_schedule`, not `trigger_time`; `action_notify`, not `action_notification`; `action_command`, not `action_vehicle_command`; `action_set_setting`, not `action_set_state`.
6. Preserve the domain concepts of triggers, conditions, and actions.
7. Use shared UI components only; no raw controls.
8. Wrap visible strings in `t(...)`.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-36-12-automation-builder-typed-state.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-36-11-automation-frontend-types-hooks.log"
if (-not (Test-Path $prev) -or -not (Select-String -Path $prev -Pattern "^EXIT=0$" -Quiet) -or -not (Select-String -Path $prev -Pattern "^STATUS=DONE$" -Quiet)) {
  "Predecessor log missing or not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

$files = @()
$files += Get-ChildItem "web\src\features\automations\pages" -Recurse -File -Include *.tsx,*.ts | ForEach-Object FullName
if (Test-Path "web\src\features\automations\components") {
  $files += Get-ChildItem "web\src\features\automations\components" -Recurse -File -Include *.tsx,*.ts | ForEach-Object FullName
}
$legacy = Select-String -Path $files -Pattern "trigger_config|notify_channels|Record<string, unknown>|type: 'state_check'|type: 'command'|type: 'notify'|kind: 'trigger_time'|kind: 'trigger_webhook'|kind: 'action_notification'|kind: 'action_vehicle_command'|kind: 'action_set_state'|threshold_numeric|compare_numeric" -ErrorAction SilentlyContinue
"AUTOMATION_BUILDER_LEGACY_REF_COUNT=$(@($legacy).Count)" | Tee-Object -FilePath $log -Append
if ($legacy) { $legacy | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

$raw = Select-String -Path $files -Pattern "<(button|input|select|textarea|table)(\s|>|/)" -CaseSensitive -ErrorAction SilentlyContinue
"RAW_CONTROL_COUNT=$(@($raw).Count)" | Tee-Object -FilePath $log -Append
if ($raw) { $raw | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

Set-Location web
npx tsc --noEmit 2>&1 | Tee-Object -FilePath "..\$log" -Append
$tsExit = $LASTEXITCODE
if ($tsExit -eq 0) {
  npx eslint src\features\automations\pages\AutomationBuilderPage.tsx --ext ts,tsx --report-unused-disable-directives --max-warnings 0 --quiet 2>&1 | Tee-Object -FilePath "..\$log" -Append
  $eslintExit = $LASTEXITCODE
} else { $eslintExit = 1 }
Set-Location ..
"TSC_EXIT=$tsExit" | Tee-Object -FilePath $log -Append
"ESLINT_AUTOMATION_BUILDER_EXIT=$eslintExit" | Tee-Object -FilePath $log -Append
if ($tsExit -ne 0 -or $eslintExit -ne 0) { "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

$status = git --no-pager status --short
$unexpected = $status | Where-Object {
  $_ -notmatch "web[\\/]src[\\/]features[\\/]automations[\\/](pages|components)[\\/].*" -and
  $_ -notmatch "\.github[\\/]prompts[\\/]db-refactor[\\/]logs[\\/]phase-36-12-automation-builder-typed-state\.log$"
}
"UNEXPECTED_STATUS_COUNT=$(@($unexpected).Count)" | Tee-Object -FilePath $log -Append
if ($unexpected) { $unexpected | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
```

## Commit

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-36-12-automation-builder-typed-state.log"
git add -f -- web\src\features\automations\pages web\src\features\automations\components $log
git commit -m "phase-36/12-automations: use typed builder state

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If TypeScript, ESLint, raw-control scan, or legacy-state scan fails, write `EXIT=<nonzero>` and `STATUS=BLOCKED` to the log, then commit only the log if possible.

