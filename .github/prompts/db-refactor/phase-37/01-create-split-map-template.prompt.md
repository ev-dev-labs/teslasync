---
description: "Phase 37 - Generic split-map methodology used by every Phase 37 split prompt"
---

# Prompt 01 - Split-Map Template (Methodology Only)

> **Severity:** Methodology | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-37-01-create-split-map-template.log` |
| Depends on | [`phase-37-00-go-monolith-inventory.log`](../logs/phase-37-00-go-monolith-inventory.log) STATUS=DONE |
| Allowed files to change | `.github/prompts/db-refactor/logs/phase-37-01-create-split-map-template.log` (log only, no source edits) |

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

Every implementation prompt in Phase 37 must follow the same split-map shape so
that splits are reviewable and reversible. This prompt records that template
in the log so downstream prompts (and future phases) can reference it.

## Action Steps

1. Verify predecessor: prompt 00 log exists with `EXIT=0` and `STATUS=DONE`.
2. Append the following template to the log under `## REASONING`:
   - **Source file** - the monolith being split.
   - **Existing file responsibility** - one paragraph describing what stays in
     the source file after the split.
   - **New files** - destination filenames in the same package, named
     `<basename>_<concern>.go`. No `helpers.go`, `utils.go`, `common.go`, or
     `misc.go`.
   - **Items to move** - list each top-level type, function, method receiver,
     constant, and variable being moved, grouped by destination file.
   - **Validation commands** - `gofmt -l`, `go build ./...`, and the targeted
     `go test` package path.
   - **Risks** - any cross-file references, unexported identifiers shared with
     other files, init-order sensitivities, or comment blocks tied to the
     original line layout.
3. Note that the template **must not** be applied to any `.go` file in this
   prompt - downstream split prompts apply it.

## Gate

```powershell
$log = '.github/prompts/db-refactor/logs/phase-37-01-create-split-map-template.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"## PREFLIGHT" | Set-Content -Path $log
"start_utc=$([DateTimeOffset]::UtcNow.ToString('o'))" | Add-Content $log
"go_version=$((go version 2>$null) -replace '\s+',' ')" | Add-Content $log
"engineer_email=$((git config user.email 2>$null))" | Add-Content $log
"powershell_version=$($PSVersionTable.PSVersion.ToString())" | Add-Content $log
"os_platform=$($PSVersionTable.Platform)" | Add-Content $log
$exit = 0

$prev = '.github/prompts/db-refactor/logs/phase-37-00-go-monolith-inventory.log'
if (-not (Test-Path $prev)) { "predecessor log missing: $prev" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $prev -Pattern '^EXIT=0$' -Quiet)) { "predecessor not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $prev -Pattern '^STATUS=(DONE|DEFERRED)$' -Quiet)) { "predecessor STATUS not DONE or DEFERRED" | Add-Content $log; $exit = 1 }

"## SURVEY" | Add-Content $log
"template recorded inline (see REASONING section)" | Add-Content $log

"## REASONING" | Add-Content $log
@(
  "Split-map template:",
  "  - Source file: <path>",
  "  - Existing responsibility: <one paragraph>",
  "  - New files: <basename>_<concern>.go (no helpers/utils/common/misc)",
  "  - Items to move: list types, funcs, methods, consts, vars per dest file",
  "  - Validation: gofmt -l, go build ./..., go test <package> -count=1",
  "  - Risks: cross-file unexported references, init order, comment anchors"
) | Add-Content $log

"## CHANGES" | Add-Content $log
"none (methodology only)" | Add-Content $log

"## GATE" | Add-Content $log
$drift = git --no-pager status --short
if ($drift) {
  $allowed = '^\s*[?MAR]+\s+\.github[\\/]prompts[\\/]db-refactor[\\/]logs[\\/]phase-37-01-create-split-map-template\.log$'
  $bad = $drift | Where-Object { $_ -notmatch $allowed }
  if ($bad) {
    "drift detected:" | Add-Content $log
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
git add -f '.github/prompts/db-refactor/logs/phase-37-01-create-split-map-template.log'
git commit -m "chore(phase-37): prompt 01 - split-map template" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If `STATUS=BLOCKED`, do not proceed. Re-run inventory if needed.
