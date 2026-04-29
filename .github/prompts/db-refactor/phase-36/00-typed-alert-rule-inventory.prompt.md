---
description: "Phase 36 - rules platform typed inventory and forward-only contract"
---

# Prompt 00B - Rules Platform Typed Inventory and Forward-Only Contract

> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-36-00-typed-alert-rule-inventory.log` |
| Depends on | `phase-36-00-clean-slate-decision-record.log` |
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

## Architectural Boundary Contract

Phase 36 must preserve these domain boundaries:

| Boundary | Owner / source of truth | Phase 36 rule |
|---|---|---|
| Alert rule persistence | `alert_rules` typed columns and `models.AlertRule` | Alert handlers validate/write typed rule rows only; no CEP JSON compatibility layer. |
| Alert evaluation | `rule_engine.go` over typed `AlertRule` + current signal values supplied by the telemetry alert path | Evaluator stays a pure typed evaluator; it must not query snapshot/current-state tables directly. |
| Automation definition persistence | `automations`, `automation_steps`, and CTI child tables | CRUD/import/export persist typed parent + steps + children transactionally; no root JSON action/condition blobs. |
| Automation runtime | typed `AutomationFull` aggregate with CTI children | Workers/runtime dispatch on typed step `kind` values; no hidden `trigger_config` bridge. |
| Notification delivery | notification-channel subsystem | Rules/automations reference delivery through typed action/test targets; rules do not own channel arrays. |
| Signal/current-state data | ADR-001/ADR-007 (`signal.Store` L1, Redis L2, `signal_log` history) | Do not introduce reads from dropped snapshot tables, `vehicle_live_state`, `signal_history`, or legacy `positions` SQL. |
| Security boundary | ForwardAuth for `/api/v1/*`, token auth only for public webhook receiver | Do not add provider-specific auth, frontend-trusted ownership, or unauthenticated create/update paths. |

Future extensibility is schema-first: adding a new alert op, automation step kind, or runtime trigger family requires a migration/enum update, Go model, DTO validation, frontend type, runtime dispatch, tests, docs, and dashboard updates in the same or a later explicit phase.

## Strategic Governance and Risk Posture

Phase 36 is a product/platform governance decision, not just a cleanup:

| Decision area | Final posture |
|---|---|
| Product compatibility | Breaking change is acceptable only because the clean-slate production gate proves there is no rules-platform data to preserve. If the gate fails, Phase 36 stops and a migration phase must be designed. |
| Schema ownership | Do not edit migrations or create ad-hoc schema deltas in this phase. If the typed schema is insufficient, block and create a later schema-governance phase. |
| Rollback | Because Phase 36 should not change schema, rollback is code rollback plus redeploy. Do not add compatibility tables, dual-write paths, or one-off data transforms. |
| Extensibility | Keep the typed CTI model as the extension point; do not introduce a second DSL, JSON rule engine, plugin host, message broker, or policy engine. |
| Compliance/security | No provider-specific auth, no frontend-trusted ownership, no unauthenticated create/update/import paths, no hidden execution of user-supplied JSON. |
| Cost/risk balance | Prefer small typed contracts and explicit unsupported states over over-engineered compatibility for data that production preflight proves does not exist. |
| Future trigger families | Unsupported legacy families (`calendar`, `mqtt`, `webhook`, `sunrise_sunset`, `vehicle_state`, `battery`, `energy`) remain future-phase work unless each gets schema + runtime + docs + tests. |

Non-goals for this phase: multi-tenant policy governance, active-active automation ownership, generic user-defined expression languages, a new workflow engine, compatibility migration for nonzero rules-platform data, or a new observability metric namespace. If any of these become necessary, write `STATUS=BLOCKED` and split a new phase.

## Action Steps

1. Verify Prompt 00A has `EXIT=0` and `STATUS=DONE`.
2. Do not edit source code in this prompt.
3. Do not perform an exhaustive file-by-file inventory in this prompt. This prompt is a fast clean-slate preflight; source-editing prompts own detailed code changes.
4. Read the operator-supplied environment variables or pasted raw production SQL output. Do not connect to production from this prompt.
5. Verify the required source files exist, but do not inspect every line.
6. In `=== SURVEY ===`, include these subsections exactly:
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
   - `ARCHITECTURAL_BOUNDARY_CONTRACT`
   - `STRATEGIC_GOVERNANCE_AND_RISK_POSTURE`
   - `DEPRECATION_TARGETS`
7. In `PRODUCTION_CLEAN_SLATE_COUNTS`, paste the raw production preflight output or the `OPERATOR_SUPPLIED_ENV_COUNTS` values, then normalize them into these exact markers:
   - `ALERT_RULE_COUNT=0`
   - `AUTOMATION_COUNT=0`
   - `AUTOMATION_STEP_COUNT=0`
   - `AUTOMATION_HISTORY_COUNT=0`
8. In `=== REASONING ===`, state that Phase 36 is typed-only and explicitly rejects restoring CEP JSON fields or legacy automation JSON builders because production has no rules-platform data to preserve.
9. In `ARCHITECTURAL_BOUNDARY_CONTRACT`, summarize the owner/source-of-truth for alert persistence, alert evaluation, automation persistence, automation runtime, notification delivery, signal data, and auth boundaries.
10. In `STRATEGIC_GOVERNANCE_AND_RISK_POSTURE`, summarize the clean-slate breaking-change prerequisite, no-schema-change posture, rollback posture, explicit non-goals, and future trigger-family policy.
11. In `DEPRECATION_TARGETS`, summarize the alert and automation legacy surfaces from the Forward-Only Contract table. Do not enumerate every file:line reference.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-36-00-typed-alert-rule-inventory.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-36-00-clean-slate-decision-record.log"
if (-not (Test-Path $prev) -or -not (Select-String -Path $prev -Pattern "^EXIT=0$" -Quiet) -or -not (Select-String -Path $prev -Pattern "^STATUS=DONE$" -Quiet)) {
  "Predecessor log missing or not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  exit 1
}

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

$requiredLogPatterns = @(
  "^=== PREFLIGHT ===$",
  "^=== SURVEY ===$",
  "^=== REASONING ===$",
  "^=== CHANGES ===$",
  "PRODUCTION_CLEAN_SLATE_COUNTS",
  "BACKEND_TYPED_SCHEMA",
  "BACKEND_HANDLER_PAYLOAD",
  "BACKEND_EVALUATOR_OPS",
  "AUTOMATION_TYPED_SCHEMA",
  "AUTOMATION_LEGACY_SURFACES",
  "FRONTEND_API_TYPES",
  "FRONTEND_ALERT_STUDIO_PAYLOAD",
  "FRONTEND_AUTOMATION_BUILDER_PAYLOAD",
  "FRONTEND_LEGACY_COMPONENTS",
  "SEVERITY_NORMALIZATION",
  "OPERATOR_MAPPING",
  "ARCHITECTURAL_BOUNDARY_CONTRACT",
  "Alert rule persistence",
  "Automation runtime",
  "signal.Store",
  "ForwardAuth",
  "STRATEGIC_GOVERNANCE_AND_RISK_POSTURE",
  "no-schema-change",
  "rollback",
  "Non-goals",
  "future trigger",
  "DEPRECATION_TARGETS",
  "typed-only",
  "CEP JSON",
  "legacy automation JSON"
)
$missingLogPatterns = $requiredLogPatterns | Where-Object { -not (Select-String -Path $log -Pattern $_ -Quiet) }
"MISSING_LOG_PATTERN_COUNT=$(@($missingLogPatterns).Count)" | Tee-Object -FilePath $log -Append
if ($missingLogPatterns) {
  $missingLogPatterns | Tee-Object -FilePath $log -Append
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
git commit -m "phase-36/00b-rules-platform-inventory: confirm typed contract

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If the gate cannot run, the log is missing required sections, or any unexpected files changed, write `EXIT=<nonzero>` and `STATUS=BLOCKED` to the log, then commit only the log if possible.

