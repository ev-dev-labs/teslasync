---
description: "Phase 37 - Split telemetry_handler.go - extract telemetry handler live store updates"
---

# Prompt 17 - Split telemetry_handler.go - Live Store Updates

> **Severity:** Refactor | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-37-17-split-telemetry-handler-live-store.log` |
| Depends on | [`.github/prompts/db-refactor/logs/phase-37-16-split-telemetry-handler-ingest.log`](../logs/phase-37-16-split-telemetry-handler-ingest.log) STATUS=DONE |
| Allowed files to change | `internal/api/telemetry_handler.go`, `internal/api/telemetry_handler_live_store.go`, `.github/prompts/db-refactor/logs/phase-37-17-split-telemetry-handler-live-store.log` |

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

`internal/api/telemetry_handler.go` is a Go monolith mixing several cohesive concerns. This prompt extracts
the following sub-area into one or more new files in the same Go package
(`package api`):

  - Helpers that write into the in-process `signal.Store` L1 cache.
  - Helpers that mirror current-state values into the Redis HSET L2 (`vehicle:{vehicleID}:signals`).
  - Helpers that publish change notifications on the Redis `vehicle_signals` pub/sub channel.

> Mechanical decomposition only. Move cohesive code into new files in the same package. Do not change behavior, exported names, public APIs, route paths, SQL, JSON tags, config, migrations, logging semantics, error wrapping, validation behavior, or runtime ordering. Do not introduce new abstractions unless required to preserve behavior. Run `gofmt` on touched Go files and targeted `go test` for the affected package.

> **Architectural note - layered live-state contract.** TeslaSync's telemetry pipeline maintains a 3-layer contract: SignalStore L1 (in-process hot path for FSM, sessions, and merge context), Redis L2 (`vehicle:{vehicleID}:signals` HSET for cross-pod current state and restart recovery), and `signal_log` (durable TimescaleDB history for charts, replay, and point-in-time reconstruction). Mechanical splits MUST preserve which functions touch which layer. Do NOT co-locate SignalStore hot-path code with `signal_log` query code, do NOT interleave Redis cache writes with FSM commit logic, and do NOT split a function chain across files in a way that would later require an exported helper to re-stitch it. When in doubt, keep the original cohesion - mechanical splits never split logical pipeline stages.

## Action Steps

1. Verify predecessor: `.github/prompts/db-refactor/logs/phase-37-16-split-telemetry-handler-ingest.log` exists with `EXIT=0` and `STATUS=DONE`.
2. Read `internal/api/telemetry_handler.go` and locate the cohesive subset described above.
3. **Before editing any `.go` file**, append a per-prompt split map to the log
   under `## REASONING` covering: source file, destination filenames, every
   top-level identifier (type/func/method/const/var) being moved grouped by
   destination file, and any cross-file unexported references that must remain
   visible in the same package.
4. Create the following new file(s) in the same package:
  - `internal/api/telemetry_handler_live_store.go`
5. Move the listed types, functions, methods, constants, and variables verbatim
   from `internal/api/telemetry_handler.go` into the new file(s). Preserve identifier names, JSON tags,
   error messages, log fields, comment text, and statement ordering.
6. Update `internal/api/telemetry_handler.go` only by removing the moved code. Do not rewrite, rename, or
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
$log = '.github/prompts/db-refactor/logs/phase-37-17-split-telemetry-handler-live-store.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"## PREFLIGHT" | Set-Content -Path $log
"start_utc=$([DateTimeOffset]::UtcNow.ToString('o'))" | Add-Content $log
$exit = 0

$prev = '.github/prompts/db-refactor/logs/phase-37-16-split-telemetry-handler-ingest.log'
if (-not (Test-Path $prev)) { "predecessor log missing: $prev" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $prev -Pattern '^EXIT=0$' -Quiet)) { "predecessor not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $prev -Pattern '^STATUS=DONE$' -Quiet)) { "predecessor not STATUS=DONE" | Add-Content $log; $exit = 1 }

# Exported-identifier invariant: package's top-level exports at HEAD must equal the working tree's exports
# (mechanical splits move exports between files but never add or remove them).
# Parser-style helper handles grouped const/var ( ... ) blocks, generics, and method receivers.
$pkgDir = 'internal/api'
function Get-GoExportedDecls {
  param([string[]]$lines)
  $set = @{}
  $inBlock = $null
  foreach ($line in $lines) {
    if (-not $line) { continue }
    if ($line -match '^(var|const)\s*\(\s*$') { $inBlock = $matches[1]; continue }
    if ($inBlock -and $line -match '^\s*\)\s*$') { $inBlock = $null; continue }
    if ($inBlock -and $line -match '^\s+([A-Z]\w*)') { $set["$inBlock $($matches[1])"] = $true; continue }
    if ($line -match '^func\s+\(([^)]+)\)\s+([A-Z]\w*)') {
      $recv = (($matches[1] -split '\s+') | Where-Object { $_ })[-1] -replace '\*',''
      $set["method $recv.$($matches[2])"] = $true
      continue
    }
    if ($line -match '^func\s+([A-Z]\w*)') { $set["func $($matches[1])"] = $true; continue }
    if ($line -match '^type\s+([A-Z]\w*)') { $set["type $($matches[1])"] = $true; continue }
    if ($line -match '^(var|const)\s+([A-Z]\w*)') { $set["$($matches[1]) $($matches[2])"] = $true; continue }
  }
  return ($set.Keys | Sort-Object)
}

$headFiles = git ls-tree -r --name-only HEAD -- $pkgDir 2>$null | Where-Object { $_ -like '*.go' -and $_ -notlike '*_test.go' }
$beforeDecls = @()
foreach ($f in $headFiles) {
  $content = git show "HEAD:$f" 2>$null
  if ($content) { $beforeDecls += Get-GoExportedDecls -lines ($content -split "`n") }
}
$beforeDecls = $beforeDecls | Sort-Object -Unique

$afterFiles = Get-ChildItem -Path $pkgDir -Filter *.go -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '*_test.go' }
$afterDecls = @()
foreach ($f in $afterFiles) {
  $afterDecls += Get-GoExportedDecls -lines (Get-Content -LiteralPath $f.FullName)
}
$afterDecls = $afterDecls | Sort-Object -Unique

if ($beforeDecls -and $afterDecls) {
  $diff = Compare-Object $beforeDecls $afterDecls
  if ($diff) {
    "exports drift in package $pkgDir (split must preserve exported identifiers):" | Add-Content $log
    $diff | ForEach-Object { "  $($_.SideIndicator) $($_.InputObject)" } | Add-Content $log
    $exit = 1
  } else {
    "exports invariant ok: $($afterDecls.Count) exported identifiers preserved" | Add-Content $log
  }
} elseif (-not $beforeDecls) {
  "could not snapshot HEAD exports for $pkgDir (no files at HEAD?)" | Add-Content $log
  $exit = 1
}

# Import-graph invariant: package's union of imports at HEAD must equal the working tree's
# (mechanical splits never add or remove dependencies). Catches accidental coupling.
function Get-GoImports {
  param([string[]]$lines)
  $set = @{}
  $inImport = $false
  foreach ($line in $lines) {
    if ($line -match '^import\s+(?:\w+\s+)?"([^"]+)"') { $set[$matches[1]] = $true; continue }
    if ($line -match '^import\s*\(\s*$') { $inImport = $true; continue }
    if ($inImport -and $line -match '^\s*\)\s*$') { $inImport = $false; continue }
    if ($inImport -and $line -match '^\s*(?:\w+\s+)?"([^"]+)"') { $set[$matches[1]] = $true; continue }
  }
  return ($set.Keys | Sort-Object)
}

$beforeImports = @()
foreach ($f in $headFiles) {
  $content = git show "HEAD:$f" 2>$null
  if ($content) { $beforeImports += Get-GoImports -lines ($content -split "`n") }
}
$beforeImports = $beforeImports | Sort-Object -Unique

$afterImports = @()
foreach ($f in $afterFiles) {
  $afterImports += Get-GoImports -lines (Get-Content -LiteralPath $f.FullName)
}
$afterImports = $afterImports | Sort-Object -Unique

if ($beforeImports -and $afterImports) {
  $diff = Compare-Object $beforeImports $afterImports
  if ($diff) {
    "import-graph drift in package $pkgDir (split must not add/remove imports):" | Add-Content $log
    $diff | ForEach-Object { "  $($_.SideIndicator) $($_.InputObject)" } | Add-Content $log
    $exit = 1
  } else {
    "import-graph invariant ok: $($afterImports.Count) imports preserved" | Add-Content $log
  }
}

"## SURVEY" | Add-Content $log
$src = 'internal/api/telemetry_handler.go'
if (-not (Test-Path $src)) { "source missing: $src" | Add-Content $log; $exit = 1 }
else {
  $srcLines = (Get-Content -LiteralPath $src | Measure-Object -Line).Lines
  "source_lines_after=$srcLines" | Add-Content $log
}
$newFiles = @('internal/api/telemetry_handler_live_store.go')
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

# Fast-fail: build the affected package first, then the whole repo
$pkgBuildOut = & go build "./$pkgDir/..." 2>&1
$pkgBuildExit = $LASTEXITCODE
"go build ./$pkgDir/... exit=$pkgBuildExit" | Add-Content $log
$pkgBuildOut | Out-String | Add-Content $log
if ($pkgBuildExit -ne 0) { $exit = 1 }

if ($exit -eq 0) {
  $buildOut = & go build ./... 2>&1
  $buildExit = $LASTEXITCODE
  "go build ./... exit=$buildExit" | Add-Content $log
  $buildOut | Out-String | Add-Content $log
  if ($buildExit -ne 0) { $exit = 1 }
} else {
  "skipping go build ./... because package build failed" | Add-Content $log
}

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
  $allowed = '^\s*[?MAR]+\s+(internal[\\/]api[\\/]telemetry_handler\.go|internal[\\/]api[\\/]telemetry_handler_live_store\.go|\.github[\\/]prompts[\\/]db-refactor[\\/]logs[\\/]phase-37-17-split-telemetry-handler-live-store\.log)$'
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
$paths = @('internal/api/telemetry_handler.go', 'internal/api/telemetry_handler_live_store.go', '.github/prompts/db-refactor/logs/phase-37-17-split-telemetry-handler-live-store.log')
git add -f $paths
git commit -m "refactor(api): extract telemetry handler live store updates" -m "Phase 37 prompt 17 - mechanical split, no behavior change" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If `STATUS=BLOCKED`, do not proceed to the next prompt. Commit only the log
file with a `chore(phase-37): prompt 17 blocked` message and resolve the
failure (compile error, test failure, or drift) before re-running the gate.

If the split was already committed before the BLOCKED outcome (e.g., gate
detected exports drift after commit), recover with:

```powershell
# Inspect the bad commit
git --no-pager log -1
# If unpushed and standalone: drop the commit cleanly
git reset --hard HEAD~1
# If pushed or interleaved with the log commit: revert
git revert --no-edit HEAD
```

After recovery, re-run this prompt's gate. Do not skip ahead to the next
prompt.
