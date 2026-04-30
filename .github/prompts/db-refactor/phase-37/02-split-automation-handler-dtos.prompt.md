---
description: "Phase 37 - Split automation_handler.go - extract automation handler DTO types"
---

# Prompt 02 - Split automation_handler.go - DTO Types

> **Severity:** Refactor | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-37-02-split-automation-handler-dtos.log` |
| Depends on | [`.github/prompts/db-refactor/logs/phase-37-01-create-split-map-template.log`](../logs/phase-37-01-create-split-map-template.log) STATUS=DONE |
| Allowed files to change | `internal/api/automation_handler.go`, `internal/api/automation_handler_dtos.go`, `.github/prompts/db-refactor/logs/phase-37-02-split-automation-handler-dtos.log` |

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

`internal/api/automation_handler.go` is a Go monolith mixing several cohesive concerns. This prompt extracts
the following sub-area into one or more new files in the same Go package
(`package api`):

  - All package-level request and response struct types used by automation HTTP handlers (e.g., create/update automation requests, condition/action/trigger DTOs, list response wrappers).
  - Embedded sub-structs that exist only to shape JSON request or response bodies for these handlers.
  - Type-only `MarshalJSON`/`UnmarshalJSON` overrides that belong to those DTOs.

> Mechanical decomposition only. Move cohesive code into new files in the same package. Do not change behavior, exported names, public APIs, route paths, SQL, JSON tags, config, migrations, logging semantics, error wrapping, validation behavior, or runtime ordering. Do not introduce new abstractions unless required to preserve behavior. Run `gofmt` on touched Go files and targeted `go test` for the affected package.

## Action Steps

1. Verify predecessor: `.github/prompts/db-refactor/logs/phase-37-01-create-split-map-template.log` exists with `EXIT=0` and `STATUS=DONE`.
2. Read `internal/api/automation_handler.go` and locate the cohesive subset described above.
3. **Before editing any `.go` file**, append a per-prompt split map to the log
   under `## REASONING` covering: source file, destination filenames, every
   top-level identifier (type/func/method/const/var) being moved grouped by
   destination file, and any cross-file unexported references that must remain
   visible in the same package.
4. Create the following new file(s) in the same package:
  - `internal/api/automation_handler_dtos.go`
5. Move the listed types, functions, methods, constants, and variables verbatim
   from `internal/api/automation_handler.go` into the new file(s). Preserve identifier names, JSON tags,
   error messages, log fields, comment text, and statement ordering.
6. Update `internal/api/automation_handler.go` only by removing the moved code. Do not rewrite, rename, or
   restructure any remaining declarations. Preserve every existing import that
   is still referenced; remove only imports that become unused.
7. Each new file must declare `package api` and import only what it actually
   uses. Do not add new third-party dependencies.
8. Do not modify any other Go file, test, route, SQL, JSON tag, config, or
   migration. Do not change exported names. Do not add new abstractions.
9. Run `gofmt -w` on every touched Go file.
10. Run `go build ./...`, `go vet ./internal/api`, and `go test ./internal/api -count=1` from the
    repo root.
11. Run `git --no-pager status --short` and confirm only the allowed files
    appear.

## Gate

```powershell
$log = '.github/prompts/db-refactor/logs/phase-37-02-split-automation-handler-dtos.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"## PREFLIGHT" | Set-Content -Path $log
"start_utc=$([DateTimeOffset]::UtcNow.ToString('o'))" | Add-Content $log
$exit = 0

$prev = '.github/prompts/db-refactor/logs/phase-37-01-create-split-map-template.log'
if (-not (Test-Path $prev)) { "predecessor log missing: $prev" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $prev -Pattern '^EXIT=0$' -Quiet)) { "predecessor not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $prev -Pattern '^STATUS=DONE$' -Quiet)) { "predecessor not STATUS=DONE" | Add-Content $log; $exit = 1 }

# Exported-identifier invariant: package's top-level exports at HEAD must equal the working tree's exports
# (mechanical splits move exports between files but never add or remove them).
$pkgDir = 'internal/api'
$exportPattern = '^(func \([^)]+\) [A-Z]\w*|func [A-Z]\w*|type [A-Z]\w*|var [A-Z]\w*|const [A-Z]\w*)'
$headFiles = git ls-tree -r --name-only HEAD -- $pkgDir 2>$null | Where-Object { $_ -like '*.go' -and $_ -notlike '*_test.go' }
$beforeExports = @()
foreach ($f in $headFiles) {
  $content = git show "HEAD:$f" 2>$null
  if ($content) {
    $beforeExports += ($content -split "`n") | Select-String -Pattern $exportPattern | ForEach-Object { $_.Line.Trim() }
  }
}
$beforeExports = $beforeExports | Sort-Object -Unique
$afterFiles = Get-ChildItem -Path $pkgDir -Filter *.go -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '*_test.go' }
$afterExports = @()
foreach ($f in $afterFiles) {
  $afterExports += Get-Content -LiteralPath $f.FullName | Select-String -Pattern $exportPattern | ForEach-Object { $_.Line.Trim() }
}
$afterExports = $afterExports | Sort-Object -Unique
if ($beforeExports -and $afterExports) {
  $diff = Compare-Object $beforeExports $afterExports
  if ($diff) {
    "exports drift in package $pkgDir (split must preserve exported identifiers):" | Add-Content $log
    $diff | ForEach-Object { "  $($_.SideIndicator) $($_.InputObject)" } | Add-Content $log
    $exit = 1
  } else {
    "exports invariant ok: $($afterExports.Count) exported identifiers preserved" | Add-Content $log
  }
} elseif (-not $beforeExports) {
  "could not snapshot HEAD exports for $pkgDir (no files at HEAD?)" | Add-Content $log
  $exit = 1
}

"## SURVEY" | Add-Content $log
$src = 'internal/api/automation_handler.go'
if (-not (Test-Path $src)) { "source missing: $src" | Add-Content $log; $exit = 1 }
else {
  $srcLines = (Get-Content -LiteralPath $src | Measure-Object -Line).Lines
  "source_lines_after=$srcLines" | Add-Content $log
}
$newFiles = @('internal/api/automation_handler_dtos.go')
foreach ($nf in $newFiles) {
  if (-not (Test-Path $nf)) {
    "missing new file: $nf" | Add-Content $log
    $exit = 1
  } else {
    $nfLines = (Get-Content -LiteralPath $nf | Measure-Object -Line).Lines
    "new_file=$nf lines=$nfLines" | Add-Content $log
    $head = (Get-Content -LiteralPath $nf -TotalCount 80) -join "`n"
    if ($head -notmatch '(?m)^package\s+api\b') {
      "wrong package decl in $nf (expected package api)" | Add-Content $log
      $exit = 1
    }
  }
}

"## REASONING" | Add-Content $log
"mechanical decomposition: split $src into $($newFiles -join ', ')" | Add-Content $log
"no behavior, API, SQL, JSON, route, config, or runtime ordering changes" | Add-Content $log
"per-prompt split map must be appended above this line by the engineer before edits" | Add-Content $log

"## CHANGES" | Add-Content $log
$touched = @($src) + $newFiles
foreach ($f in $touched) {
  if (Test-Path $f) {
    $sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash
    "$f sha256=$sha" | Add-Content $log
  }
}

"## GATE" | Add-Content $log
$env:CGO_ENABLED = '0'
$gofmtOut = gofmt -l $touched 2>&1
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
  $testOut = & go test ./internal/api -count=1 2>&1
  $testExit = $LASTEXITCODE
  "go test exit=$testExit" | Add-Content $log
  $testOut | Out-String | Add-Content $log
  if ($testExit -ne 0) { $exit = 1 }
} else {
  "skipping go test because earlier step failed" | Add-Content $log
}

$drift = git --no-pager status --short
if ($drift) {
  $allowed = '^\s*[?MAR]+\s+(internal[\\/]api[\\/]automation_handler\.go|internal[\\/]api[\\/]automation_handler_dtos\.go|\.github[\\/]prompts[\\/]db-refactor[\\/]logs[\\/]phase-37-02-split-automation-handler-dtos\.log)$'
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
$paths = @('internal/api/automation_handler.go', 'internal/api/automation_handler_dtos.go', '.github/prompts/db-refactor/logs/phase-37-02-split-automation-handler-dtos.log')
git add -f $paths
git commit -m "refactor(api): extract automation handler DTO types" -m "Phase 37 prompt 02 - mechanical split, no behavior change" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If `STATUS=BLOCKED`, do not proceed to the next prompt. Commit only the log
file with a `chore(phase-37): prompt 02 blocked` message and resolve the
failure (compile error, test failure, or drift) before re-running the gate.
