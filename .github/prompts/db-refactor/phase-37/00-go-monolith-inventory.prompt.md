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
6. After the SURVEY block, append a `## PARALLEL_FAMILIES` block listing the
   independent prompt families that may be executed concurrently by different
   engineers. Phase 37 currently defines these families (each entry is the
   prompt-number range that touches a single source file or related cluster):

   - **automation_handler family** (02 - 08): `internal/api/automation_handler.go`
   - **telemetry_sessions family** (09 - 14): `internal/api/telemetry_sessions.go`
   - **telemetry_handler family** (15 - 20): `internal/api/telemetry_handler.go`
   - **tesla_client family** (21 - 27): `internal/tesla/client.go`
   - **medium_singletons family** (28 - 52): one source file per prompt; each
     prompt is independent of the others in this family

   The strict predecessor chain in each prompt is preserved within a family;
   the families themselves are independent because they touch disjoint source
   files. Any engineer executing Phase 37 in parallel MUST still respect each
   family's internal predecessor chain.
7. Append a `## CONVENTIONS_LOCK` block declaring the file-naming convention
   that Phase 37 commits to:

   - All split destination files use `<orig_basename>_<suffix>.go` (e.g.,
     `automation_handler_dtos.go`, `automation_handler_crud.go`).
   - Suffixes are lowercase, snake_case, and describe the cohesive concern.
   - This convention is **locked** after Phase 37 completes. Phase 38+ may
     elevate split files to subpackages via `git mv`, but MUST NOT rename
     the suffix or change the convention without a separate governance
     decision.

## Gate

```powershell
$log = '.github/prompts/db-refactor/logs/phase-37-00-go-monolith-inventory.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"## PREFLIGHT" | Set-Content -Path $log
"start_utc=$([DateTimeOffset]::UtcNow.ToString('o'))" | Add-Content $log
"go_version=$((go version 2>$null) -replace '\s+',' ')" | Add-Content $log
"engineer_email=$((git config user.email 2>$null))" | Add-Content $log
"powershell_version=$($PSVersionTable.PSVersion.ToString())" | Add-Content $log
"os_platform=$($PSVersionTable.Platform)" | Add-Content $log
$exit = 0

"## SURVEY" | Add-Content $log
$baselineSha = (git rev-parse HEAD).Trim()
"phase_37_baseline_sha=$baselineSha" | Add-Content $log
"phase_37_baseline_branch=$((git rev-parse --abbrev-ref HEAD).Trim())" | Add-Content $log
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

"## PARALLEL_FAMILIES" | Add-Content $log
"automation_handler`t02-08`tinternal/api/automation_handler.go" | Add-Content $log
"telemetry_sessions`t09-14`tinternal/api/telemetry_sessions.go" | Add-Content $log
"telemetry_handler`t15-20`tinternal/api/telemetry_handler.go" | Add-Content $log
"tesla_client`t21-27`tinternal/tesla/client.go" | Add-Content $log
"medium_singletons`t28-52`tone-source-per-prompt; independent of each other" | Add-Content $log
"families are independent across source files; honor predecessor chain within each family" | Add-Content $log

"## CONVENTIONS_LOCK" | Add-Content $log
"naming_convention=<orig_basename>_<suffix>.go" | Add-Content $log
"suffix_style=lowercase_snake_case" | Add-Content $log
"locked_after=phase-37" | Add-Content $log
"future_extraction=Phase 38+ may git mv to subpackage; MUST NOT rename suffix without separate governance decision" | Add-Content $log

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
