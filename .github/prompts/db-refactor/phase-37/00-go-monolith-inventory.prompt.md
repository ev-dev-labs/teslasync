---
description: "Phase 37 - Inventory all Go monolith candidates and classify them"
---

# Prompt 00 - Go Monolith Inventory

> **Severity:** Inventory | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-37-00-go-monolith-inventory.log` |
| Depends on | (none - first prompt of phase) |
| Allowed files to change | `.github/prompts/db-refactor/logs/phase-37-00-go-monolith-inventory.log` (log only, no source edits) |

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

Phase 37 will decompose oversized Go monolith files via mechanical, same-package
file splits. Before any split prompt runs, we need a fresh, ranked inventory of
every `.go` file in the repository, classified into one of:

- **production refactor candidate** - non-test Go file >= 300 lines outside
  `vendor/`, `web/`, `node_modules/`, generated code, and protobuf output.
- **test refactor candidate** - `_test.go` file >= 400 lines.
- **declarative/config candidate** - file dominated by package-level `var`/`const`
  declarations (data tables, error catalogs, route maps).
- **generated/exempt** - protobuf, mock, swagger, or other generated output.

This prompt is **inventory only**. It does not modify any `.go` file.

## Action Steps

1. From the repository root run a `Get-ChildItem` over `*.go` files excluding
   `vendor`, `node_modules`, `web`, and any directory named `mocks` or
   `generated`.
2. For each file emit `<line_count>\t<path>` and sort descending by line count.
3. Classify each file >= 300 lines using the four categories above. Files below
   300 lines that are not test/declarative/generated are out of scope for
   Phase 37 and are not classified.
4. Cross-reference the result against the user-supplied seed list in the
   `phase-37` plan and explicitly note any seed entry that does not exist in
   the working tree (for example `internal/automation/trigger/mqtt.go` if
   absent).
5. Write the full inventory and classification to the output log under the
   `## SURVEY` section. Do not edit any `.go` file.

## Gate

```powershell
$log = '.github/prompts/db-refactor/logs/phase-37-00-go-monolith-inventory.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"## PREFLIGHT" | Set-Content -Path $log
"start_utc=$([DateTimeOffset]::UtcNow.ToString('o'))" | Add-Content $log
$exit = 0

"## SURVEY" | Add-Content $log
$files = Get-ChildItem -Path . -Recurse -Filter *.go -File |
  Where-Object { $_.FullName -notmatch '\\(vendor|node_modules|web)\\' } |
  Where-Object { $_.FullName -notmatch '\\mocks?\\' } |
  Where-Object { $_.FullName -notmatch '\\generated\\' }
$rows = foreach ($f in $files) {
  $count = (Get-Content -LiteralPath $f.FullName | Measure-Object -Line).Lines
  [pscustomobject]@{ Lines = $count; Path = (Resolve-Path -Relative $f.FullName) }
}
$rows | Sort-Object -Property Lines -Descending |
  ForEach-Object { "{0,6}`t{1}" -f $_.Lines, $_.Path } |
  Add-Content $log

"## REASONING" | Add-Content $log
"Inventory only. No source edits." | Add-Content $log

"## CHANGES" | Add-Content $log
"none (inventory only)" | Add-Content $log

"## GATE" | Add-Content $log
$drift = git --no-pager status --short
if ($drift) {
  $allowed = '^\s*[?MAR]+\s+\.github[\\/]prompts[\\/]db-refactor[\\/]logs[\\/]phase-37-00-go-monolith-inventory\.log$'
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
git add -f '.github/prompts/db-refactor/logs/phase-37-00-go-monolith-inventory.log'
git commit -m "chore(phase-37): prompt 00 - go monolith inventory" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If `STATUS=BLOCKED`, do not proceed to prompt 01. Resolve drift, re-run the
gate, and only commit the log on `STATUS=DONE`.
