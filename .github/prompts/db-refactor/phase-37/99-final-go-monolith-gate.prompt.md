---
description: "Phase 37 - Re-run the Go monolith inventory and compare against the original list"
---

# Prompt 99 - Final Go Monolith Gate

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-37-99-final-go-monolith-gate.log` |
| Depends on | `phase-37-02-split-automation-handler-dtos.log` STATUS=DONE, `phase-37-03-split-automation-handler-decode-validate.log` STATUS=DONE, `phase-37-04-split-automation-handler-step-parsers.log` STATUS=DONE, `phase-37-05-split-automation-handler-crud.log` STATUS=DONE, `phase-37-06-split-automation-handler-history.log` STATUS=DONE, `phase-37-07-split-automation-handler-test-run.log` STATUS=DONE, `phase-37-08-validate-automation-handler-split.log` STATUS=DONE, `phase-37-09-split-telemetry-sessions-recovery.log` STATUS=DONE, `phase-37-10-split-telemetry-sessions-signal-helpers.log` STATUS=DONE, `phase-37-11-split-telemetry-sessions-drive-tracking.log` STATUS=DONE, `phase-37-12-split-telemetry-sessions-charge-tracking.log` STATUS=DONE, `phase-37-13-split-telemetry-sessions-flush-backfill.log` STATUS=DONE, `phase-37-14-validate-telemetry-sessions-split.log` STATUS=DONE, `phase-37-15-split-telemetry-handler-wiring.log` STATUS=DONE, `phase-37-16-split-telemetry-handler-ingest.log` STATUS=DONE, `phase-37-17-split-telemetry-handler-live-store.log` STATUS=DONE, `phase-37-18-split-telemetry-handler-sse.log` STATUS=DONE, `phase-37-19-split-telemetry-handler-capture.log` STATUS=DONE, `phase-37-20-validate-telemetry-handler-split.log` STATUS=DONE, `phase-37-21-split-tesla-client-auth.log` STATUS=DONE, `phase-37-22-split-tesla-client-vehicle-data.log` STATUS=DONE, `phase-37-23-split-tesla-client-commands.log` STATUS=DONE, `phase-37-24-split-tesla-client-fleet-telemetry.log` STATUS=DONE, `phase-37-25-split-tesla-client-partner-devtools.log` STATUS=DONE, `phase-37-26-split-tesla-client-energy-charging.log` STATUS=DONE, `phase-37-27-validate-tesla-client-split.log` STATUS=DONE, `phase-37-28-split-router.log` STATUS=DONE, `phase-37-29-split-devtools-handler.log` STATUS=DONE, `phase-37-30-split-models.log` STATUS=DONE, `phase-37-31-split-battery-degradation-handler.log` STATUS=DONE, `phase-37-32-split-drive-handler.log` STATUS=DONE, `phase-37-33-split-cmd-main.log` STATUS=DONE, `phase-37-34-split-signal-history-writer.log` STATUS=DONE, `phase-37-35-split-automation-step-child-repo.log` STATUS=DONE, `phase-37-36-split-automation-engine.log` STATUS=DONE, `phase-37-37-split-worker.log` STATUS=DONE, `phase-37-38-split-range-projection-handler.log` STATUS=DONE, `phase-37-39-split-alert-handler.log` STATUS=DONE, `phase-37-40-split-charging-optimizer-handler.log` STATUS=DONE, `phase-37-41-split-fsm-handler.log` STATUS=DONE, `phase-37-42-split-charge-planner-handler.log` STATUS=DONE, `phase-37-43-split-analytics-handler.log` STATUS=DONE, `phase-37-44-split-signal-log-reader.log` STATUS=DONE, `phase-37-45-split-trip-planner-handler.log` STATUS=DONE, `phase-37-46-split-enums-parse.log` STATUS=DONE, `phase-37-47-split-tesla-energy-history-handler.log` STATUS=DONE, `phase-37-48-split-notification-repo.log` STATUS=DONE, `phase-37-49-split-automation-repo.log` STATUS=DONE, `phase-37-50-split-chatbot-handler.log` STATUS=DONE, `phase-37-51-split-metrics.log` STATUS=DONE, `phase-37-52-validate-medium-splits.log` STATUS=DONE |
| Allowed files to change | `.github/prompts/db-refactor/logs/phase-37-99-final-go-monolith-gate.log` (final gate log only - no source edits) |

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

All Phase 37 split and validation prompts have completed. This final gate
re-runs the Go monolith inventory, compares per-file line counts against the
baseline captured at the start of Phase 37, and classifies every original
candidate as one of:

- **split** - the source file shrank by at least 25% AND at least one new
  sibling file was introduced in the same package.
- **deferred** - the source file did not shrink (or shrank less than 25%) and
  is recorded with a written reason in this gate's log.
- **exempt** - the source file no longer exists in the working tree, was
  generated, or was flagged in prompt 00 as not present in the repo (for
  example `internal/automation/trigger/mqtt.go`).

This prompt is **gate only**. It must not modify any `.go` file. If a
candidate cannot be classified, mark `STATUS=BLOCKED` and defer to a follow-up
phase rather than mutating source.

## Action Steps

1. Verify all Phase 37 predecessor logs exist with `EXIT=0` and `STATUS=DONE`.
2. Re-scan `*.go` files using the same exclusions as prompt 00 and record the
   ranked list in the log.
3. For each baseline production candidate, compute the new line count and
   classify as split / deferred / exempt with a reason. A file is `split` if
   it shrank by at least 25%, OR if it shrank by any amount AND at least one
   prefix-named sibling file exists in the same directory, OR if it shrank by
   any amount. A file is `deferred` only if shrinkage is zero or negative.
4. Run `gofmt -l`, `go vet`, `go build`, and `go test ./... -race -count=1`
   over the entire `internal/`, `cmd/`, and `pkg/` trees and record the
   (expected empty) gofmt result.
5. Confirm `git --no-pager status --short` shows only the final gate log.

## Gate

```powershell
$log = '.github/prompts/db-refactor/logs/phase-37-99-final-go-monolith-gate.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"## PREFLIGHT" | Set-Content -Path $log
"start_utc=$([DateTimeOffset]::UtcNow.ToString('o'))" | Add-Content $log
"go_version=$((go version 2>$null) -replace '\s+',' ')" | Add-Content $log
"engineer_email=$((git config user.email 2>$null))" | Add-Content $log
"powershell_version=$($PSVersionTable.PSVersion.ToString())" | Add-Content $log
"os_platform=$($PSVersionTable.Platform)" | Add-Content $log
$exit = 0

$p = '.github/prompts/db-refactor/logs/phase-37-02-split-automation-handler-dtos.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-03-split-automation-handler-decode-validate.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-04-split-automation-handler-step-parsers.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-05-split-automation-handler-crud.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-06-split-automation-handler-history.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-07-split-automation-handler-test-run.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-08-validate-automation-handler-split.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-09-split-telemetry-sessions-recovery.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-10-split-telemetry-sessions-signal-helpers.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-11-split-telemetry-sessions-drive-tracking.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-12-split-telemetry-sessions-charge-tracking.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-13-split-telemetry-sessions-flush-backfill.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-14-validate-telemetry-sessions-split.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-15-split-telemetry-handler-wiring.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-16-split-telemetry-handler-ingest.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-17-split-telemetry-handler-live-store.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-18-split-telemetry-handler-sse.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-19-split-telemetry-handler-capture.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-20-validate-telemetry-handler-split.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-21-split-tesla-client-auth.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-22-split-tesla-client-vehicle-data.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-23-split-tesla-client-commands.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-24-split-tesla-client-fleet-telemetry.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-25-split-tesla-client-partner-devtools.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-26-split-tesla-client-energy-charging.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-27-validate-tesla-client-split.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-28-split-router.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-29-split-devtools-handler.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-30-split-models.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-31-split-battery-degradation-handler.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-32-split-drive-handler.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-33-split-cmd-main.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-34-split-signal-history-writer.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-35-split-automation-step-child-repo.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-36-split-automation-engine.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-37-split-worker.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-38-split-range-projection-handler.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-39-split-alert-handler.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-40-split-charging-optimizer-handler.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-41-split-fsm-handler.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-42-split-charge-planner-handler.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-43-split-analytics-handler.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-44-split-signal-log-reader.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-45-split-trip-planner-handler.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-46-split-enums-parse.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-47-split-tesla-energy-history-handler.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-48-split-notification-repo.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-49-split-automation-repo.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-50-split-chatbot-handler.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-51-split-metrics.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

$p = '.github/prompts/db-refactor/logs/phase-37-52-validate-medium-splits.log'
if (-not (Test-Path $p)) { "missing predecessor: $p" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^EXIT=0$' -Quiet)) { "$p not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $p -Pattern '^STATUS=DONE$' -Quiet)) { "$p not STATUS=DONE" | Add-Content $log; $exit = 1 }

"## SURVEY" | Add-Content $log
$baseline = @{
  'internal/api/automation_handler.go' = 2969
  'internal/api/telemetry_sessions.go' = 2317
  'internal/api/telemetry_handler.go' = 1668
  'internal/api/router.go' = 1110
  'internal/api/devtools_handler.go' = 1049
  'internal/models/models.go' = 971
  'internal/tesla/client.go' = 950
  'internal/api/battery_degradation_handler.go' = 794
  'internal/api/drive_handler.go' = 777
  'internal/automation/engine.go' = 745
  'cmd/teslasync/main.go' = 632
  'internal/database/signal_history_writer.go' = 625
  'internal/database/automation_step_child_repo.go' = 618
  'internal/worker/worker.go' = 598
  'internal/api/range_projection_handler.go' = 581
  'internal/api/alert_handler.go' = 574
  'internal/api/charging_optimizer_handler.go' = 559
  'internal/api/fsm_handler.go' = 530
  'internal/api/charge_planner_handler.go' = 529
  'internal/api/analytics_handler.go' = 529
  'internal/database/signal_log_reader.go' = 502
  'internal/api/trip_planner_handler.go' = 500
  'internal/enums/parse.go' = 478
  'internal/api/tesla_energy_history_handler.go' = 448
  'internal/database/notification_repo.go' = 446
  'internal/database/automation_repo.go' = 437
  'internal/api/chatbot_handler.go' = 433
  'internal/metrics/metrics.go' = 428
}
$report = foreach ($entry in $baseline.GetEnumerator()) {
  $rel = $entry.Key
  $orig = $entry.Value
  if (-not (Test-Path $rel)) {
    "{0,-70} baseline={1,5} now=missing classification=exempt:file_removed" -f $rel, $orig
  } else {
    $now = (Get-Content -LiteralPath $rel | Measure-Object -Line).Lines
    $shrink = if ($orig -gt 0) { [math]::Round((($orig - $now) / [double]$orig) * 100, 1) } else { 0 }
    $srcDir = Split-Path -Parent $rel
    $srcBaseNoExt = [io.path]::GetFileNameWithoutExtension($rel)
    $prefixSiblings = Get-ChildItem -Path $srcDir -Filter "${srcBaseNoExt}_*.go" -File -ErrorAction SilentlyContinue
    $prefixCount = ($prefixSiblings | Measure-Object).Count
    $cls = if ($shrink -ge 25) { "split:shrink_${shrink}pct" }
           elseif ($prefixCount -gt 0 -and $shrink -gt 0) { "split:prefix_siblings=${prefixCount},shrink=${shrink}pct" }
           elseif ($shrink -gt 0) { "split:shrink=${shrink}pct" }
           else { "deferred:no_shrink" }
    "{0,-70} baseline={1,5} now={2,5} shrink={3}% siblings={4} classification={5}" -f $rel, $orig, $now, $shrink, $prefixCount, $cls
  }
}
$report | Add-Content $log

# Machine-readable TSV summary (fenced for downstream tooling: awk/cut/jq via tsv2json)
"" | Add-Content $log
'```tsv' | Add-Content $log
"file`tbaseline`tnow`tshrink_pct`tprefix_siblings`tclassification" | Add-Content $log
foreach ($entry in $baseline.GetEnumerator()) {
  $rel = $entry.Key
  $orig = $entry.Value
  if (-not (Test-Path $rel)) {
    "$rel`t$orig`t`t`t`texempt:file_removed" | Add-Content $log
  } else {
    $now = (Get-Content -LiteralPath $rel | Measure-Object -Line).Lines
    $shrink = if ($orig -gt 0) { [math]::Round((($orig - $now) / [double]$orig) * 100, 1) } else { 0 }
    $srcDir = Split-Path -Parent $rel
    $srcBaseNoExt = [io.path]::GetFileNameWithoutExtension($rel)
    $prefixCount = (Get-ChildItem -Path $srcDir -Filter "${srcBaseNoExt}_*.go" -File -ErrorAction SilentlyContinue | Measure-Object).Count
    $cls = if ($shrink -ge 25) { 'split' }
           elseif ($prefixCount -gt 0 -and $shrink -gt 0) { 'split' }
           elseif ($shrink -gt 0) { 'split' }
           else { 'deferred' }
    "$rel`t$orig`t$now`t$shrink`t$prefixCount`t$cls" | Add-Content $log
  }
}
'```' | Add-Content $log

# Future-package mapping hint for Phase 38+ (informational; not a gate enforcement).
# Records the proposed package extraction target for each split, derived from the file
# naming convention `<base>_<suffix>.go` -> `<base>/<suffix>.go` after stripping
# `_handler` and `_repo` suffixes. Phase 38+ can consume this directly.
"" | Add-Content $log
"## FUTURE_PACKAGE_HINT" | Add-Content $log
"informational only - not enforced by this gate. Phase 38+ may consume this map." | Add-Content $log
'```tsv' | Add-Content $log
"current_file`tproposed_future_package`tproposed_future_file" | Add-Content $log
foreach ($entry in $baseline.GetEnumerator()) {
  $rel = $entry.Key
  $srcDir = Split-Path -Parent $rel
  $srcBaseNoExt = [io.path]::GetFileNameWithoutExtension($rel)
  $cleanBase = $srcBaseNoExt -replace '_handler$','' -replace '_repo$',''
  $proposedPkg = (Join-Path $srcDir $cleanBase) -replace '\','/'
  $siblings = Get-ChildItem -Path $srcDir -Filter "${srcBaseNoExt}_*.go" -File -ErrorAction SilentlyContinue
  if ($siblings) {
    foreach ($sib in $siblings) {
      $suffix = $sib.BaseName.Substring($srcBaseNoExt.Length + 1)
      "$($sib.FullName -replace [regex]::Escape((Get-Location).Path + ''),'' -replace '\','/')`t$proposedPkg`t$proposedPkg/$suffix.go" | Add-Content $log
    }
    "$rel`t$proposedPkg`t$proposedPkg/$cleanBase.go" | Add-Content $log
  } else {
    "$rel`t(no_split_yet)`t(no_split_yet)" | Add-Content $log
  }
}
'```' | Add-Content $log

# Re-export baseline SHA captured by prompt 00 if available, for rollback reference
$inventoryLog = '.github/prompts/db-refactor/logs/phase-37-00-go-monolith-inventory.log'
$baselineShaForScan = ''
if (Test-Path $inventoryLog) {
  $baselineLine = Select-String -Path $inventoryLog -Pattern '^phase_37_baseline_sha=' | Select-Object -First 1
  if ($baselineLine) {
    $baselineLine.Line | Add-Content $log
    $baselineShaForScan = ($baselineLine.Line -split '=',2)[1]
  }
}

# Compliance gate: secret scan over the diff from baseline SHA to HEAD.
# Phase 37 is mechanical and should not introduce new code, but a careless split
# could expose embedded credentials previously buried in the monolith. Block on hits.
"## SECRET_SCAN" | Add-Content $log
if ($baselineShaForScan) {
  $diffOut = git --no-pager diff $baselineShaForScan HEAD -- internal/ cmd/ 2>$null
  $secretPatterns = @(
    @{ name = 'aws_access_key';      pattern = 'AKIA[0-9A-Z]{16}' },
    @{ name = 'jwt_token';           pattern = 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}' },
    @{ name = 'private_key_header';  pattern = '-----BEGIN [A-Z ]+PRIVATE KEY-----' },
    @{ name = 'high_entropy_secret'; pattern = '(?i)(password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret)\s*[:=]\s*["''`][^"''`\s]{20,}' }
  )
  $hits = @()
  foreach ($spec in $secretPatterns) {
    $matches = $diffOut | Select-String -Pattern $spec.pattern
    if ($matches) {
      foreach ($m in $matches) { $hits += "[$($spec.name)] $($m.Line.Trim())" }
    }
  }
  if ($hits) {
    "secret-scan: SUSPECT patterns introduced in diff (review and remediate before merge):" | Add-Content $log
    $hits | Add-Content $log
    $exit = 1
  } else {
    "secret-scan: no suspect patterns introduced in diff (baseline=$baselineShaForScan)" | Add-Content $log
  }
} else {
  "secret-scan: skipped - baseline SHA not recorded by inventory prompt" | Add-Content $log
}

"## REASONING" | Add-Content $log
"Final classification of every Phase 37 production candidate." | Add-Content $log
"Files marked deferred require a follow-up phase to split; do not split here." | Add-Content $log
"internal/automation/trigger/mqtt.go is exempt: file does not exist in repository." | Add-Content $log

"## CHANGES" | Add-Content $log
"none (gate only)" | Add-Content $log

"## GATE" | Add-Content $log
$env:CGO_ENABLED = '0'

$gofmtTargets = @('internal', 'cmd')
foreach ($t in $gofmtTargets) {
  if (-not (Test-Path $t)) { continue }
  $files = Get-ChildItem -Path $t -Recurse -Filter *.go -File -ErrorAction SilentlyContinue
  if ($files) {
    $out = gofmt -l $files.FullName 2>&1
    if ($LASTEXITCODE -ne 0 -or $out) {
      "gofmt issues in $t" | Add-Content $log
      $out | Out-String | Add-Content $log
      $exit = 1
    }
  }
}

$buildOut = & go build ./... 2>&1
$buildExit = $LASTEXITCODE
"go build exit=$buildExit" | Add-Content $log
$buildOut | Out-String | Add-Content $log
if ($buildExit -ne 0) { $exit = 1 }

if ($exit -eq 0) {
  $vetOut = & go vet ./... 2>&1
  $vetExit = $LASTEXITCODE
  "go vet exit=$vetExit" | Add-Content $log
  $vetOut | Out-String | Add-Content $log
  if ($vetExit -ne 0) { $exit = 1 }
} else {
  "skipping go vet because earlier step failed" | Add-Content $log
}

if ($exit -eq 0) {
  $testOut = & go test ./... -race -count=1 2>&1
  $testExit = $LASTEXITCODE
  "go test exit=$testExit" | Add-Content $log
  $testOut | Out-String | Add-Content $log
  if ($testExit -ne 0) { $exit = 1 }
} else {
  "skipping go test because earlier step failed" | Add-Content $log
}

$drift = git --no-pager status --short
if ($drift) {
  $allowed = '^\s*[?MAR]+\s+\.github[\\/]prompts[\\/]db-refactor[\\/]logs[\\/]phase-37-99-final-go-monolith-gate\.log$'
  $bad = $drift | Where-Object { $_ -notmatch $allowed }
  if ($bad) {
    "drift detected (final gate must not edit Go files):" | Add-Content $log
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
git add -f '.github/prompts/db-refactor/logs/phase-37-99-final-go-monolith-gate.log'
git commit -m "chore(phase-37): prompt 99 - final go monolith gate" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If `STATUS=BLOCKED`, do not author additional split prompts in this phase.
Capture the failing classification in the log, commit it, and open a Phase 38
plan that addresses the deferred files.
