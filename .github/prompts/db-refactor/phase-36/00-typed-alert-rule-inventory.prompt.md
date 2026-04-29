---
description: "Phase-36 - Rules platform clean-slate inventory and forward-only contract"
---

# Prompt 00 - Rules Platform Clean-Slate Inventory and Forward-Only Contract

> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-36-00-typed-alert-rule-inventory.log` |
| Depends on | none |
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

Alerts and automations are currently broken and unused in production. Phase 36 is therefore a clean-slate rules-platform reset, not a compatibility migration. The phase may remove old alert-rule CEP fields and old automation JSON builder surfaces only if the production preflight proves there are no configured alert rules or automations to preserve.

Alert Studio still submits old CEP-style JSON fields (`conditions`, `msg_template`, `notify_channels`, `type`, `threshold`) to `POST /api/v1/alerts/rules`, while the current typed `alert_rules` schema and backend handler require:

| Field | Required? | Source of truth |
|---|---:|---|
| `name` | yes | `internal/models/alert.go`, `migrations/000142_baseline_typed.up.sql` |
| `enabled` | yes | typed rule schema |
| `vehicle_id` | no | null means all vehicles |
| `signal_name` | yes | typed rule schema |
| `op` | yes | one of `=`, `!=`, `<`, `<=`, `>`, `>=`, `changed`, `between`, `outside` |
| `value_num` | by op/type | numeric single-value operand |
| `value_text` | by op/type | string single-value operand |
| `value_bool` | by op/type | boolean single-value operand |
| `value_min` / `value_max` | by op | range operands for `between`/`outside` |
| `severity` | yes | one of `info`, `warn`, `critical` |
| `cooldown_min` | yes | typed rule schema |

Phase 36 must move forward only. Do not restore CEP JSON storage, do not re-add `conditions` to alert rules, do not support nested AND/OR alert-rule trees in this typed flow, and do not preserve legacy automation JSON request bodies unless a clean-slate gate fails.

## Clean-Slate Production Gate

Before any source-editing prompt runs, the operator must run the production database preflight and paste the raw output into this prompt's log:

```sql
SELECT
  (SELECT COUNT(*) FROM alert_rules) AS alert_rule_count,
  (SELECT COUNT(*) FROM automations) AS automation_count,
  (SELECT COUNT(*) FROM automation_steps) AS automation_step_count,
  (SELECT COUNT(*) FROM automation_history) AS automation_history_count;
```

Required result for Phase 36:

| Count | Required value | Reason |
|---|---:|---|
| `ALERT_RULE_COUNT` | `0` | no legacy/user alert rules to migrate |
| `AUTOMATION_COUNT` | `0` | no legacy/user automations to migrate |
| `AUTOMATION_STEP_COUNT` | `0` | no typed step data to preserve |
| `AUTOMATION_HISTORY_COUNT` | `0` | no automation run history to preserve |

If any count is greater than zero, write `STATUS=BLOCKED` and stop. Do not continue with a best-effort migration in Phase 36.

For non-interactive runner execution, the operator may provide the verified counts through environment variables before running `run-prompts.ps1`:

```powershell
$env:PHASE36_ALERT_RULE_COUNT = "0"
$env:PHASE36_AUTOMATION_COUNT = "0"
$env:PHASE36_AUTOMATION_STEP_COUNT = "0"
$env:PHASE36_AUTOMATION_HISTORY_COUNT = "0"
```

If all four variables are present, treat them as operator-supplied production evidence, log them under `OPERATOR_SUPPLIED_ENV_COUNTS`, and normalize them into the required markers. Do not attempt to connect to production from this prompt.

## Forward-Only Contract

| Legacy surface | Phase 36 direction |
|---|---|
| `conditions` / `RuleConditionTree` | delete from alert-rule frontend/API contract |
| `msg_template` | delete from persisted alert rules; `/alerts/test` uses `message` only |
| `notify_channels` on rules | delete from alert rules; delivery uses enabled notification channels |
| `type` / `threshold` | delete from alert-rule API types and payloads |
| `warning` API severity | reject on writes; API value is `warn`; UI may display "Warning" |
| `changed_to` / `changed_from` | do not persist; use typed `changed` with optional target value |
| `==`, `contains`, `is_true`, `is_false` | do not persist; map UI to typed ops or remove |
| `RuleBuilder` CEP component | remove after Alert Studio no longer imports it |
| automation `trigger_config` / root `conditions` / root `actions` JSON bodies | replace with typed automation step contracts |
| automation builder record bridges (`Record<string, unknown>`, legacy `type` discriminators) | remove after the typed automation builder saves CTI-shaped steps |
| automation `notify_channels` arrays | remove from automation definitions; notification actions target one channel via typed action rows |

## Action Steps

1. Do not edit source code in this prompt.
2. Do not perform an exhaustive file-by-file inventory in this prompt. This prompt is a fast clean-slate preflight; source-editing prompts own detailed code changes.
3. Read the operator-supplied environment variables or pasted raw production SQL output. Do not connect to production from this prompt.
4. Verify the required source files exist, but do not inspect every line.
5. In `=== SURVEY ===`, include these subsections exactly:
   - `PRODUCTION_CLEAN_SLATE_COUNTS`
   - `BACKEND_TYPED_SCHEMA`
   - `BACKEND_HANDLER_PAYLOAD`
   - `BACKEND_EVALUATOR_OPS`
   - `AUTOMATION_TYPED_SCHEMA`
   - `AUTOMATION_LEGACY_SURFACES`
   - `FRONTEND_API_TYPES`
   - `FRONTEND_ALERT_STUDIO_PAYLOAD`
   - `FRONTEND_AUTOMATION_BUILDER_PAYLOAD`
   - `FRONTEND_LEGACY_COMPONENTS`
   - `SEVERITY_NORMALIZATION`
   - `OPERATOR_MAPPING`
   - `DEPRECATION_TARGETS`
6. In `PRODUCTION_CLEAN_SLATE_COUNTS`, paste the raw production preflight output or the `OPERATOR_SUPPLIED_ENV_COUNTS` values, then normalize them into these exact markers:
   - `ALERT_RULE_COUNT=0`
   - `AUTOMATION_COUNT=0`
   - `AUTOMATION_STEP_COUNT=0`
   - `AUTOMATION_HISTORY_COUNT=0`
7. In `=== REASONING ===`, state that Phase 36 is typed-only and explicitly rejects restoring CEP JSON fields or legacy automation JSON builders because production has no rules-platform data to preserve.
8. In `DEPRECATION_TARGETS`, summarize the alert and automation legacy surfaces from the Forward-Only Contract table. Do not enumerate every file:line reference.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-36-00-typed-alert-rule-inventory.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$requiredFiles = @(
  "internal\models\alert.go",
  "internal\database\alert_repo.go",
  "internal\api\alert_handler.go",
  "internal\api\rule_engine.go",
  "internal\api\rule_engine_test.go",
  "internal\worker\worker.go",
  "internal\models\automation.go",
  "internal\models\automation_step_trigger.go",
  "internal\models\automation_step_condition.go",
  "internal\models\automation_step_action.go",
  "internal\api\automation_handler.go",
  "internal\database\automation_repo.go",
  "internal\database\automation_step_repo.go",
  "web\src\api\types.ts",
  "web\src\api\hooks\useNotifications.ts",
  "web\src\api\hooks\useAutomations.ts",
  "web\src\api\settings.ts",
  "web\src\types\admin.ts",
  "web\src\types\automations.ts",
  "web\src\features\notifications\pages\AlertStudioPage.tsx",
  "web\src\features\notifications\pages\AlertsPage.tsx",
  "web\src\features\automations\pages\AutomationBuilderPage.tsx",
  "web\src\features\automations\pages\AutomationsListPage.tsx",
  "web\src\components\forms\RuleBuilder.tsx",
  "web\src\components\forms\index.ts",
  "web\src\lib\signalCatalog.ts"
)
$missing = $requiredFiles | Where-Object { -not (Test-Path $_) }
"MISSING_FILE_COUNT=$(@($missing).Count)" | Tee-Object -FilePath $log -Append
if ($missing) { $missing | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

$counts = @{
  "ALERT_RULE_COUNT" = $env:PHASE36_ALERT_RULE_COUNT
  "AUTOMATION_COUNT" = $env:PHASE36_AUTOMATION_COUNT
  "AUTOMATION_STEP_COUNT" = $env:PHASE36_AUTOMATION_STEP_COUNT
  "AUTOMATION_HISTORY_COUNT" = $env:PHASE36_AUTOMATION_HISTORY_COUNT
}
"OPERATOR_SUPPLIED_ENV_COUNTS" | Tee-Object -FilePath $log -Append
foreach ($key in $counts.Keys) {
  "$key=$($counts[$key])" | Tee-Object -FilePath $log -Append
}
$badCounts = $counts.GetEnumerator() | Where-Object { $_.Value -ne "0" }
"BAD_CLEAN_SLATE_COUNT=$(@($badCounts).Count)" | Tee-Object -FilePath $log -Append
if ($badCounts) {
  $badCounts | ForEach-Object { "$($_.Key)=$($_.Value)" } | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

$status = git --no-pager status --short
$unexpected = $status | Where-Object { $_ -notmatch "\.github[\\/]prompts[\\/]db-refactor[\\/]logs[\\/]phase-36-00-typed-alert-rule-inventory\.log$" }
"UNEXPECTED_STATUS_COUNT=$(@($unexpected).Count)" | Tee-Object -FilePath $log -Append
if ($unexpected) { $unexpected | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
```

## Commit

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-36-00-typed-alert-rule-inventory.log"
git add -f -- $log
git commit -m "phase-36/00-rules-platform-inventory: confirm clean slate

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If the gate cannot run, the log is missing required sections, or any unexpected files changed, write `EXIT=<nonzero>` and `STATUS=BLOCKED` to the log, then commit only the log if possible.

