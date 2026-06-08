#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync — PARALLEL worktree-isolated runner for the monorepo prompt sequence.

.DESCRIPTION
  Sibling of run-prompts.ps1. Same discovery + log-gate semantics, but runs the
  large blocks of MUTUALLY-INDEPENDENT "surface" prompts (one page/widget/view
  each) CONCURRENTLY, each Copilot session isolated in its own git worktree +
  branch, then merges the green branches back into a single integration branch.

  WHY a parallel sibling instead of editing run-prompts.ps1:
    The sequential runner is the proven, resumable fallback. This script reuses
    its sort/gate logic but adds worktree pooling, wave scheduling and merge —
    enough new surface area that keeping it separate protects the known-good path.

  DEPENDENCY MODEL (this is the crux — read it):
    Prompts are NOT a flat list you can shuffle. Within a platform the infra
    chain W0->W1->W2->...->W9 is strictly ordered (W2-0002 depends on W2-0001),
    the ~861 surface prompts (pages/, dashboard-widgets/, feature-views/, ...)
    are mutually INDEPENDENT, and the W99 acceptance gate must run LAST.
    p0-foundation (scaffold steps) and p5-hardening (cross-cutting audits) are
    fully sequential.

    => We ONLY parallelize the surface bucket. A prompt is parallelizable iff its
       sort phase is 999 or 9999 AND it lives in a program SUBDIR. Everything else
       (foundation, infra chains, acceptance gates) runs SEQUENTIALLY, in the exact
       same order the sequential runner would use. The script walks the globally
       sorted prompt list and splits it into SEGMENTS at every change of program
       or parallel/sequential class. Sequential segments run one prompt at a time;
       parallel segments run up to -MaxParallel at once with a barrier + merge at
       the end. Because infra segments complete + merge BEFORE the surface segment
       starts, every surface prompt's "Depends on W1..W9" predecessor holds.

  ISOLATION + MERGE:
    * An INTEGRATION worktree on a fresh branch auto/integration-<ts> off -BaseRef.
      All merges and done.txt updates happen here. Your dirty working branch is
      never touched. Fast-forward it onto the integration branch when satisfied.
    * A POOL of -MaxParallel worker worktrees (created once, reused). Each job:
      detach the worker to the current integration tip, create a unique branch
      auto/p/<label>, pipe the prompt to copilot in that worktree, gate the log.
    * Green branches are merged sequentially into the integration branch. The two
      additive shared catalogs every page may append to (the *.resw string catalog
      and resource dictionaries) use git's built-in `union` merge driver (wired via
      .git/info/attributes) so concurrent additions concatenate with no conflict.
      Any OTHER conflict falls back to a SEQUENTIAL FIXUP pass: the prompt is
      re-run alone on the merged tip (deterministic parity codegen regenerates its
      shared-file additions cleanly), then merged.

.USAGE
  .\run-prompts-parallel.ps1 -DryRun                 # Show the segment/wave plan, execute nothing
  .\run-prompts-parallel.ps1 -SelfTest               # Run mechanics self-tests (no copilot, no agents)
  .\run-prompts-parallel.ps1 -Program p2-windows -MaxParallel 6
  .\run-prompts-parallel.ps1 -MaxParallel 4 -Model claude-sonnet-4.6
  .\run-prompts-parallel.ps1 -Program p2-windows -Single APIKeysPage.prompt.md  # one prompt, isolated
  .\run-prompts-parallel.ps1 -Resume                 # reconcile state + continue an interrupted run
#>

param(
    [string]$RepoRoot      = "D:\repos\teslasync",
    [string]$Program       = "",                # restrict to one program dir, e.g. p2-windows
    [string]$Single        = "",                # run a single prompt by filename (still isolated+merged)
    [string]$Model         = "",
    [int]$MaxParallel      = 4,                 # default deliberately low; see -MaxParallel note below
    [string]$BaseRef       = "HEAD",            # integration branch starts here
    [string]$WorktreeRoot  = "",                # default: <repo>\..\teslasync-wt
    [string]$IntegrationBranch = "",            # default: auto/integration-<timestamp>
    [int]$TimeoutMinutes   = 600,
    [int]$PollSeconds      = 5,
    [switch]$ContinueOnRed = $false,            # keep going to later segments even if a segment had reds
    [switch]$CleanIgnored  = $false,            # worker recovery uses `git clean -ffdx` (wipes node_modules/bin/obj)
    [switch]$KeepWorktrees = $false,            # don't prune the worker pool on exit
    [switch]$DryRun        = $false,
    [switch]$Reset         = $false,            # ignore done.txt (re-run everything)
    [switch]$Resume        = $false,            # reconcile prior run state before scheduling
    [string]$FakeAgentScript = "",              # TEST SEAM: run this pwsh script instead of copilot
                                                # (invoked as: pwsh -File <script> <worktreeDir> <promptFile>)
    [switch]$SelfTest      = $false
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Shared helpers (kept byte-compatible with run-prompts.ps1 where they overlap)
# ---------------------------------------------------------------------------
$promptsRoot = Join-Path $RepoRoot ".github\prompts\monorepo"
$logDir      = Join-Path $promptsRoot "logs"

function Get-PromptSortKey {
    param($file, [string]$programRoot)
    $name   = ($file.BaseName -replace '\.prompt$', '')
    $relDir = $file.DirectoryName.Substring($programRoot.Length).TrimStart('\')

    if ($name -match '^([A-Za-z]+)(\d+)-(\d+)') {
        $letter = $Matches[1]; $phase = [int]$Matches[2]
        if ($phase -eq 99) { $phase = 99999 }   # acceptance gates run last
        return [PSCustomObject]@{ Letter=$letter; Phase=$phase; Seq=[int]$Matches[3]; Dir=$relDir; Name=$name }
    }
    if ($name -match '^(\d+)-') {
        return [PSCustomObject]@{ Letter=''; Phase=0; Seq=[int]$Matches[1]; Dir=$relDir; Name=$name }
    }
    if ($name -match '^([A-Za-z]+)-(\d+)') {
        return [PSCustomObject]@{ Letter=$Matches[1]; Phase=999; Seq=[int]$Matches[2]; Dir=$relDir; Name=$name }
    }
    return [PSCustomObject]@{ Letter='zzz-unprefixed'; Phase=9999; Seq=0; Dir=$relDir; Name=$name }
}

# A prompt is parallelizable iff it is a SURFACE prompt: a phase-999/9999 prompt
# living in a program subdir. Infra (phase < 999), foundation (phase 0) and
# acceptance gates (phase 99999, always top-level) are sequential.
function Test-IsParallelizable {
    param($key)
    return (($key.Phase -eq 999 -or $key.Phase -eq 9999) -and $key.Dir -ne '')
}

# Log-gate: detect red markers even when the CLI exits 0. Final-marker-wins.
function Test-LogSaysRed {
    param([string]$LogPath)
    if (-not (Test-Path $LogPath)) { return @($true, 'log file missing') }
    $content = Get-Content $LogPath -Raw
    $reasons = @()

    $exitMatches = [regex]::Matches($content, '(?m)^EXIT=(\d+)\s*$')
    if ($exitMatches.Count -gt 0 -and $exitMatches[$exitMatches.Count - 1].Groups[1].Value -ne '0') {
        $reasons += "final EXIT=$($exitMatches[$exitMatches.Count - 1].Groups[1].Value)"
    }
    $statusMatches = [regex]::Matches($content, '(?m)^STATUS=(\w+)\s*$')
    if ($statusMatches.Count -gt 0 -and $statusMatches[$statusMatches.Count - 1].Groups[1].Value -ne 'DONE') {
        $reasons += "final STATUS=$($statusMatches[$statusMatches.Count - 1].Groups[1].Value)"
    }
    if ($content -match '(?m)^\s*\[FAIL\]')                    { $reasons += '[FAIL] marker' }
    if ($content -match '(?m)^UNEXPECTED_COUNT=(?!0\s*$)\d+')  { $reasons += 'UNEXPECTED_COUNT' }
    $commitMatches = [regex]::Matches($content, '(?m)^COMMIT_EXIT=(\d+)\s*$')
    if ($commitMatches.Count -gt 0 -and $commitMatches[$commitMatches.Count - 1].Groups[1].Value -ne '0') {
        $reasons += "commit failed (COMMIT_EXIT=$($commitMatches[$commitMatches.Count - 1].Groups[1].Value))"
    }
    if ($content -match '(?m)^PARITY_COVERED=(\d+)') {
        $cov = [int]$Matches[1]
        if ($content -match '(?m)^PARITY_REQUIRED=(\d+)') {
            if ($cov -lt [int]$Matches[1]) { $reasons += "parity gap (COVERED=$cov < REQUIRED=$($Matches[1]))" }
        }
    }
    if ($reasons.Count -gt 0) { return @($true, ($reasons -join ', ')) }
    return @($false, '')
}

# Resolve the prompt's declared artifact log (| Log | `path` |) RELATIVE TO a
# given worktree root, since the prompt writes it inside its own worktree.
function Get-ArtifactLogInWorktree {
    param([string]$PromptContent, [string]$WorktreeDir)
    $m = [regex]::Match($PromptContent, '\|\s*(?:Output\s+log|Log)\s*\|\s*`([^`]+)`\s*\|')
    if (-not $m.Success) { return $null }
    $leaf = Split-Path ($m.Groups[1].Value.Replace('/', '\')) -Leaf
    return (Join-Path $WorktreeDir ".github\prompts\monorepo\logs\$leaf")
}

# PID-based recursive process-tree kill (no name-based killing).
function Stop-ProcessTree {
    param([int]$ProcessId)
    try {
        $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ProcessId" -ErrorAction SilentlyContinue
        foreach ($k in $kids) { Stop-ProcessTree -ProcessId ([int]$k.ProcessId) }
    } catch {}
    try { Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue } catch {}
}

# ---------------------------------------------------------------------------
# Discover + globally sort prompts (identical ordering to the sequential runner)
# ---------------------------------------------------------------------------
function Get-OrderedPrompts {
    if (-not (Test-Path $promptsRoot)) { throw "monorepo prompts root not found: $promptsRoot" }

    $programDirs = if ($Program) {
        $candidate = Join-Path $promptsRoot $Program
        if (-not (Test-Path $candidate -PathType Container)) { throw "Program directory not found: $candidate" }
        @(Get-Item $candidate)
    } else {
        Get-ChildItem -Path $promptsRoot -Directory -Filter "p*-*" |
            Sort-Object @{ Expression = { if ($_.Name -match '^p(\d+)-') { [int]$Matches[1] } else { 9999 } } }, Name
    }

    $list = @()
    $index = 0
    foreach ($pd in $programDirs) {
        $files = Get-ChildItem -Path $pd.FullName -Recurse -Filter "*.prompt.md" -File
        $sorted = $files |
            Select-Object @{Name='File';Expression={$_}}, @{Name='Key';Expression={ Get-PromptSortKey $_ $pd.FullName }} |
            Sort-Object @{Expression={$_.Key.Phase}}, @{Expression={$_.Key.Letter}}, @{Expression={$_.Key.Dir}}, @{Expression={$_.Key.Seq}}, @{Expression={$_.Key.Name}}
        foreach ($row in $sorted) {
            $index++
            $rel = $row.File.FullName.Substring($promptsRoot.Length + 1).Replace('\','/')
            $list += [PSCustomObject]@{
                Index    = $index
                Program  = $pd.Name
                Label    = ($row.File.BaseName -replace '\.prompt$', '')
                RelPath  = $rel
                FullPath = $row.File.FullName
                Key      = $row.Key
                Parallel = (Test-IsParallelizable $row.Key)
            }
        }
    }

    if ($Single) {
        $match = $list | Where-Object { (Split-Path $_.RelPath -Leaf) -eq $Single }
        if (-not $match) { throw "No prompt named '$Single' under any program directory." }
        $list = @($match)
    }
    return $list
}

# Split the ordered list into segments at every change of Program or Parallel class.
function Get-Segments {
    param($prompts)
    $segments = @()
    $cur = $null
    foreach ($p in $prompts) {
        if ($null -eq $cur -or $cur.Program -ne $p.Program -or $cur.Parallel -ne $p.Parallel) {
            if ($cur) { $segments += $cur }
            $cur = [PSCustomObject]@{ Program = $p.Program; Parallel = $p.Parallel; Items = @() }
        }
        $cur.Items += $p
    }
    if ($cur) { $segments += $cur }
    return $segments
}

# ---------------------------------------------------------------------------
# Self-test: prove classification, segmentation, gate, and union-merge mechanics
# WITHOUT launching copilot or any agent.
# ---------------------------------------------------------------------------
if ($SelfTest) {
    $fails = 0
    function Check([string]$name, [bool]$ok) {
        Write-Host ("  [{0}] {1}" -f $(if ($ok) {'PASS'} else {'FAIL'}), $name) -ForegroundColor $(if ($ok){'Green'}else{'Red'})
        if (-not $ok) { $script:fails++ }
    }
    Write-Host "Classification self-test:" -ForegroundColor Cyan
    Check 'W2-0002 infra is sequential'      (-not (Test-IsParallelizable ([PSCustomObject]@{Phase=2;Dir=''})))
    Check 'p0 0001 (phase 0) is sequential'  (-not (Test-IsParallelizable ([PSCustomObject]@{Phase=0;Dir=''})))
    Check 'W99 gate (99999) is sequential'   (-not (Test-IsParallelizable ([PSCustomObject]@{Phase=99999;Dir=''})))
    Check 'W-0020 surface in subdir parallel' (Test-IsParallelizable ([PSCustomObject]@{Phase=999;Dir='dashboard-widgets'}))
    Check 'unprefixed page (9999) in subdir parallel' (Test-IsParallelizable ([PSCustomObject]@{Phase=9999;Dir='pages/admin'}))
    Check 'phase-999 at TOP level not parallel' (-not (Test-IsParallelizable ([PSCustomObject]@{Phase=999;Dir=''})))

    Write-Host "`nLog-gate self-test:" -ForegroundColor Cyan
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("par-selftest-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    function GateCase([string]$n,[string]$body,[bool]$expectRed){
        $f = Join-Path $tmp "$n.log"; Set-Content $f $body -Encoding UTF8
        Check "$n -> red=$expectRed" ((Test-LogSaysRed $f)[0] -eq $expectRed)
    }
    GateCase 'green'  "EXIT=0`nSTATUS=DONE" $false
    GateCase 'blocked' "STATUS=BLOCKED" $true
    GateCase 'parity' "PARITY_REQUIRED=10`nPARITY_COVERED=3`nEXIT=0`nSTATUS=DONE" $true
    Check 'missing-log is red' ((Test-LogSaysRed (Join-Path $tmp 'nope.log'))[0])

    Write-Host "`nUnion-merge mechanics self-test:" -ForegroundColor Cyan
    $g = Join-Path $tmp "repo"; git init -q $g
    Push-Location $g
    try {
        git config user.email t@t.t; git config user.name t
        "root-start`nENTRY-A`nroot-end" | Set-Content cat.resw
        git add .; git commit -qm base | Out-Null
        $base = (git rev-parse HEAD).Trim()
        git switch -q --detach $base; git switch -q -c b1
        "root-start`nENTRY-A`nENTRY-B1`nroot-end" | Set-Content cat.resw; git add .; git commit -qm b1 | Out-Null
        git switch -q --detach $base; git switch -q -c b2
        "root-start`nENTRY-A`nENTRY-B2`nroot-end" | Set-Content cat.resw; git add .; git commit -qm b2 | Out-Null
        git switch -q --detach $base; git switch -q -c integ
        "*.resw merge=union" | Set-Content .git/info/attributes
        git merge -q --no-edit b1 *>$null
        git merge -q --no-edit b2 *>$null
        $merged = Get-Content cat.resw -Raw
        Check 'union merged both additive entries (no conflict)' ($merged -match 'ENTRY-B1' -and $merged -match 'ENTRY-B2' -and -not ($merged -match '<<<<<<<'))
    } finally { Pop-Location }
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host ""
    if ($fails -eq 0) { Write-Host "SELFTEST STATUS=DONE" -ForegroundColor Green; exit 0 }
    else { Write-Host "SELFTEST STATUS=FAILED ($fails)" -ForegroundColor Red; exit 1 }
}

# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------
$prompts  = Get-OrderedPrompts
$segments = Get-Segments $prompts
$total    = $prompts.Count
if ($total -eq 0) { Write-Host "No prompts discovered." -ForegroundColor Red; exit 1 }

if (-not $WorktreeRoot) { $WorktreeRoot = Join-Path (Split-Path $RepoRoot -Parent) "teslasync-wt" }
if (-not $IntegrationBranch) { $IntegrationBranch = "auto/integration-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
$runId       = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$runStateDir = Join-Path $WorktreeRoot ".runner\run-$runId"
$integWt     = Join-Path $WorktreeRoot "integration"

# done.txt is read from the integration worktree once it exists; pre-run we read
# the main repo copy so -Resume / normal runs skip already-completed prompts.
$doneSet = New-Object 'System.Collections.Generic.HashSet[string]'
$mainDone = Join-Path $logDir "done.txt"
if (-not $Reset -and (Test-Path $mainDone)) {
    Get-Content $mainDone | Where-Object { $_.Trim() -ne "" } | ForEach-Object { $doneSet.Add($_.Trim()) | Out-Null }
}
# Resume-aware planning: fold the newest integration branch's done.txt into the
# skip set so the plan/-DryRun pending counts reflect a prior partial run.
if ($Resume -and -not $Reset) {
    $resumeBranch = git -C $RepoRoot for-each-ref --sort=-creatordate --format='%(refname:short)' 'refs/heads/auto/integration-*' 2>$null |
                    Select-Object -First 1
    if ($resumeBranch) {
        $rb = $resumeBranch.Trim()
        $branchDone = git -C $RepoRoot show "${rb}:.github/prompts/monorepo/logs/done.txt" 2>$null
        if ($branchDone) { $branchDone -split "`n" | Where-Object { $_.Trim() -ne "" } | ForEach-Object { $doneSet.Add($_.Trim()) | Out-Null } }
    }
}
$pendingCount = ($prompts | Where-Object { -not $doneSet.Contains($_.RelPath) }).Count

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  TeslaSync — monorepo PARALLEL worktree runner" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Prompts root      : $promptsRoot"
Write-Host "  Total prompts     : $total  (pending: $pendingCount)"
Write-Host "  Segments          : $($segments.Count)"
Write-Host "  Max parallel      : $MaxParallel"
Write-Host "  Base ref          : $BaseRef"
Write-Host "  Integration branch: $IntegrationBranch"
Write-Host "  Worktree root     : $WorktreeRoot"
Write-Host "  Model             : $(if ($Model) { $Model } else { '(default)' })"
Write-Host "  Timeout           : $TimeoutMinutes min/prompt"
Write-Host "================================================================" -ForegroundColor Cyan

if ($MaxParallel -gt 8) {
    Write-Host "  WARNING: MaxParallel=$MaxParallel. Surface prompts may run dotnet/gradle/xcode" -ForegroundColor Yellow
    Write-Host "           builds+tests; >8 concurrent on a 16-core host tends to oversubscribe CPU" -ForegroundColor Yellow
    Write-Host "           and hit model-API rate limits, REDUCING throughput. 4-6 is the sweet spot." -ForegroundColor Yellow
}

# Segment/wave plan
Write-Host ""
Write-Host "Execution plan:" -ForegroundColor Cyan
$si = 0
foreach ($seg in $segments) {
    $si++
    $pend = ($seg.Items | Where-Object { -not $doneSet.Contains($_.RelPath) }).Count
    $mode = if ($seg.Parallel) { "PARALLEL x$MaxParallel" } else { "SEQUENTIAL    " }
    $first = $seg.Items[0].Label
    $last  = $seg.Items[$seg.Items.Count-1].Label
    Write-Host ("  [{0,2}] {1,-16} {2}  {3,4} prompts ({4,4} pending)  {5} .. {6}" -f `
        $si, $seg.Program, $mode, $seg.Items.Count, $pend, $first, $last)
}
Write-Host ""

if ($DryRun) { Write-Host "DRY RUN — nothing executed." -ForegroundColor Yellow; exit 0 }

# ---------------------------------------------------------------------------
# Live-run preflight
# ---------------------------------------------------------------------------
if (-not $FakeAgentScript -and -not (Get-Command copilot -ErrorAction SilentlyContinue)) { Write-Host "copilot CLI not found on PATH." -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Path $runStateDir -Force | Out-Null
$runLog    = Join-Path $runStateDir "orchestrator.log"
$stateFile = Join-Path $runStateDir "state.jsonl"   # append-only manifest (finding 7)
function Log([string]$m) { $e = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m; Write-Host $e; Add-Content $runLog $e }
function State([hashtable]$row) { ($row + @{ ts = (Get-Date -Format 'o') } | ConvertTo-Json -Compress) | Add-Content $stateFile }

# Disable background maintenance so concurrent commits don't race a repack/gc (finding 5).
git -C $RepoRoot config gc.auto 0           | Out-Null
git -C $RepoRoot config maintenance.auto false | Out-Null

# Wire the built-in `union` driver for additive catalogs via the COMMON git dir's
# info/attributes (applies to every worktree, not committed) (finding 2).
$commonDir = (git -C $RepoRoot rev-parse --git-common-dir).Trim()
if (-not [System.IO.Path]::IsPathRooted($commonDir)) { $commonDir = Join-Path $RepoRoot $commonDir }
$infoDir = Join-Path $commonDir "info"
New-Item -ItemType Directory -Path $infoDir -Force | Out-Null
$attrLines = @('*.resw merge=union','*.resx merge=union','*.xlf merge=union')
Set-Content -Path (Join-Path $infoDir "attributes") -Value $attrLines -Encoding UTF8
Log "Union merge driver wired for: $($attrLines -join ', ')"

$baseSha = (git -C $RepoRoot rev-parse $BaseRef).Trim()
Log "Base SHA: $baseSha"

# Integration worktree on a fresh branch (your dirty branch stays untouched).
function New-Worktree {
    param([string]$Path, [string]$Branch, [string]$StartSha)
    if (Test-Path $Path) { git -C $RepoRoot worktree remove --force $Path *>$null }
    if ($Branch) { git -C $RepoRoot worktree add -q --force -b $Branch $Path $StartSha 2>&1 | Out-Null }
    else         { git -C $RepoRoot worktree add -q --force --detach $Path $StartSha 2>&1 | Out-Null }
}
git -C $RepoRoot worktree prune | Out-Null

# -Resume: continue on the NEWEST existing auto/integration-* branch (preserving a
# prior partial run's merged work) instead of starting a fresh branch off HEAD.
if ($Resume) {
    $existing = git -C $RepoRoot for-each-ref --sort=-creatordate --format='%(refname:short)' 'refs/heads/auto/integration-*' |
                Select-Object -First 1
    if ($existing) { $IntegrationBranch = $existing.Trim(); Log "Resuming on existing integration branch: $IntegrationBranch" }
    else { Log "Resume requested but no auto/integration-* branch found — starting fresh." }
}

$branchExists = [bool](git -C $RepoRoot branch --list $IntegrationBranch)
if ($branchExists -and $Resume) {
    if (Test-Path $integWt) { git -C $RepoRoot worktree remove --force $integWt *>$null }
    git -C $RepoRoot worktree add -q --force $integWt $IntegrationBranch 2>&1 | Out-Null
} else {
    if (-not $Resume) { git -C $RepoRoot branch -D $IntegrationBranch *>$null }  # drop stale same-name branch
    New-Worktree -Path $integWt -Branch $IntegrationBranch -StartSha $baseSha
}
Log "Integration worktree: $integWt ($IntegrationBranch)"

# Neutralize phantom EOL drift ONCE on the integration branch. Some committed blobs
# carry CRLF despite `.gitattributes eol=lf`, so every fresh checkout shows a fixed set
# of web/src *.tsx files as "modified" that reset --hard can't clear. Left unfixed, each
# worker worktree starts dirty -> the prompt's drift gate miscounts and the agent commits
# EOL-only noise into its branch. Renormalizing here (scoped to auto/integration-*, NOT
# your feature branch) makes every worker that branches off this tip start clean.
git -C $integWt add --renormalize -- . *>$null
$normCount = (git -C $integWt diff --cached --name-only 2>$null | Measure-Object).Count
if ($normCount -gt 0) {
    git -C $integWt commit -q -m "chore(runner): renormalize EOL for clean worktree base ($normCount files)" *>$null
    Log "Renormalized EOL on $IntegrationBranch ($normCount files) — workers will start clean."
}

# Subsequent waves branch off the integration tip; align the recorded base + worker
# seed to it so resume continues from real merged state, not the original HEAD.
$baseSha = (git -C $integWt rev-parse HEAD).Trim()

# If the integration worktree carries a done.txt, fold it into the skip set.
$integDone = Join-Path $integWt ".github\prompts\monorepo\logs\done.txt"
if (Test-Path $integDone) {
    Get-Content $integDone | Where-Object { $_.Trim() -ne "" } | ForEach-Object { $doneSet.Add($_.Trim()) | Out-Null }
}
function Add-Done([string]$rel) {
    if (-not (Test-Path $integDone)) { New-Item -ItemType File -Path $integDone -Force | Out-Null }
    Add-Content -Path $integDone -Value $rel
    $doneSet.Add($rel) | Out-Null
    git -C $integWt add -- ".github/prompts/monorepo/logs/done.txt" *>$null
    git -C $integWt commit -q -m "chore(runner): mark $rel done" *>$null
}

# Worker pool (created once; reused). (finding 5 — serial creation)
$pool = @()
for ($i = 1; $i -le $MaxParallel; $i++) {
    $wt = Join-Path $WorktreeRoot ("wt-{0:D2}" -f $i)
    New-Worktree -Path $wt -Branch $null -StartSha $baseSha
    $pool += [PSCustomObject]@{ Path = $wt; Busy = $false }
    Log "Worker worktree ready: $wt"
}

# Recover a worker to a clean detached base before reuse (finding 9).
function Reset-Worker {
    param([string]$Wt, [string]$Sha)
    foreach ($op in @('merge --abort','rebase --abort','cherry-pick --abort')) {
        git -C $Wt @($op.Split(' ')) *>$null
    }
    # Remove a stale per-worktree index lock (orchestrator serializes git, so no
    # live git process is using this worktree at reset time).
    $gd = (git -C $Wt rev-parse --git-dir 2>$null)
    if ($gd) {
        if (-not [System.IO.Path]::IsPathRooted($gd)) { $gd = Join-Path $Wt $gd }
        $il = Join-Path $gd "index.lock"
        if (Test-Path $il) { Remove-Item $il -Force -ErrorAction SilentlyContinue }
    }
    # CRITICAL: detach HEAD *before* resetting. If we reset --hard while still on
    # the previous job's branch (auto/p/<label>), we would rewind THAT branch and
    # silently discard its commit before the barrier merge can pick it up.
    git -C $Wt checkout -f --detach $Sha *>$null
    git -C $Wt reset --hard $Sha *>$null
    if ($CleanIgnored) { git -C $Wt clean -ffdx *>$null } else { git -C $Wt clean -ffd *>$null }
    # Validate the worker is healthy; recreate if not.
    $head = (git -C $Wt rev-parse HEAD 2>$null)
    if (-not $head) {
        Log "Worker $Wt unhealthy — recreating"
        New-Worktree -Path $Wt -Branch $null -StartSha $Sha
    }
}

$copilotArgs = @('--yolo','--autopilot','-s')
if ($Model) { $copilotArgs += @('--model', $Model) }

# Launch copilot (or the fake agent) with stdin delivered THEN CLOSED. Closing stdin
# is what makes `copilot` (run without -p) finish and exit — a file redirect leaves
# stdin open at EOF and the interactive session hangs forever (observed: 0 CPU,
# 0-byte transcript, partial edits, no exit).
#
# Output capture uses Stream.CopyToAsync (runs on the .NET threadpool, independent of
# this script's pipeline) rather than Register-ObjectEvent -Action. The event-handler
# approach does NOT fire while the orchestrator's main thread is busy in the poll loop,
# which produced 0-byte transcripts under load. CopyToAsync drains continuously and is
# complete after WaitForExit + task.Wait, exactly when the log-gate reads the file.
function Start-AgentProcess {
    param([string]$Exe, [string[]]$ArgList, [string]$Wt, [string]$StdinText,
          [string]$Transcript, [string]$ErrFile, [int]$Idx, [bool]$WriteStdin)
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName               = $Exe
    $psi.WorkingDirectory       = $Wt
    $psi.UseShellExecute        = $false
    $psi.CreateNoWindow         = $true
    $psi.RedirectStandardInput  = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError  = $true
    foreach ($a in $ArgList) { $psi.ArgumentList.Add($a) }
    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    # bufferSize 1 + ReadWrite share => the on-disk transcript grows near-live so you can tail it.
    $outFs = [System.IO.FileStream]::new($Transcript, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite, 1)
    $errFs = [System.IO.FileStream]::new($ErrFile,    [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite, 1)
    [void]$proc.Start()
    $outTask = $proc.StandardOutput.BaseStream.CopyToAsync($outFs)
    $errTask = $proc.StandardError.BaseStream.CopyToAsync($errFs)
    if ($WriteStdin) { try { $proc.StandardInput.Write($StdinText) } catch {} }
    try { $proc.StandardInput.Close() } catch {}   # EOF -> copilot completes and exits
    return [PSCustomObject]@{ Proc=$proc; OutFs=$outFs; ErrFs=$errFs; OutTask=$outTask; ErrTask=$errTask; Idx=$Idx }
}

# Flush + tear down a job's output plumbing (call once after the process exits).
function Close-AgentProcess {
    param($Job)
    try { $Job.Proc.WaitForExit() } catch {}        # process done -> stdout/stderr hit EOF
    try { [void]$Job.OutTask.Wait(5000) } catch {}  # let the async copies drain to EOF
    try { [void]$Job.ErrTask.Wait(5000) } catch {}
    try { $Job.OutFs.Flush(); $Job.OutFs.Dispose() } catch {}
    try { $Job.ErrFs.Flush(); $Job.ErrFs.Dispose() } catch {}
}

# Run ONE prompt in a given worker worktree off $tip; returns a result object.
function Invoke-PromptJob {
    param($Prompt, [string]$Wt, [string]$Tip)
    $label   = $Prompt.Label
    $branch  = "auto/p/" + ($Prompt.RelPath -replace '[^A-Za-z0-9._/-]','_' -replace '/','__')
    $promptContent = (Get-Content $Prompt.FullPath -Raw).Trim()
    $promptFile = Join-Path $runStateDir ("prompt-" + $Prompt.Index + ".txt")
    $transcript = Join-Path $runStateDir ("transcript-" + $Prompt.Index + "-" + $label + ".log")
    $errFile    = Join-Path $runStateDir ("transcript-" + $Prompt.Index + "-" + $label + ".err.log")
    Set-Content -Path $promptFile -Value $promptContent -Encoding UTF8 -NoNewline

    # Serial git prologue (the orchestrator is single-process, so worker setup is
    # naturally serialized; only the copilot processes run concurrently).
    Reset-Worker -Wt $Wt -Sha $Tip
    git -C $Wt branch -D $branch *>$null
    git -C $Wt switch -q -c $branch $Tip *>$null

    if ($FakeAgentScript) {
        $launched = Start-AgentProcess -Exe 'pwsh' -ArgList @('-NoProfile','-File',$FakeAgentScript,$Wt,$promptFile) `
            -Wt $Wt -StdinText '' -Transcript $transcript -ErrFile $errFile -Idx $Prompt.Index -WriteStdin $false
    } else {
        $launched = Start-AgentProcess -Exe 'copilot' -ArgList $copilotArgs `
            -Wt $Wt -StdinText $promptContent -Transcript $transcript -ErrFile $errFile -Idx $Prompt.Index -WriteStdin $true
    }
    $proc = $launched.Proc
    State @{ event='start'; idx=$Prompt.Index; rel=$Prompt.RelPath; branch=$branch; wt=$Wt; pid=$proc.Id; tip=$Tip }
    return [PSCustomObject]@{
        Prompt=$Prompt; Wt=$Wt; Branch=$branch; Proc=$proc; Tip=$Tip; Launched=$launched
        Transcript=$transcript; ArtifactLog=(Get-ArtifactLogInWorktree $promptContent $Wt)
        Start=(Get-Date); PromptContent=$promptContent
    }
}

# Evaluate a finished job; return @{ Green=$bool; Reason=$str }.
function Resolve-JobResult {
    param($Job, [bool]$TimedOut)
    if ($TimedOut) { return @{ Green=$false; Reason="timeout > $TimeoutMinutes min" } }
    $exit = $Job.Proc.ExitCode
    if ($exit -ne 0) { return @{ Green=$false; Reason="exit $exit" } }
    $g = Test-LogSaysRed $Job.Transcript
    if ($g[0]) { return @{ Green=$false; Reason="transcript: $($g[1])" } }
    if ($Job.ArtifactLog) {
        $ag = Test-LogSaysRed $Job.ArtifactLog
        if ($ag[0]) { return @{ Green=$false; Reason="artifact: $($ag[1])" } }
    }
    return @{ Green=$true; Reason='' }
}

# Merge a green branch into the integration branch. Returns 'merged' | 'conflict'.
function Merge-GreenBranch {
    param([string]$Branch)
    $r = git -C $integWt merge --no-edit --no-ff $Branch 2>&1
    if ($LASTEXITCODE -eq 0) { return 'merged' }
    $conflicts = (git -C $integWt diff --name-only --diff-filter=U) -split "`n" | Where-Object { $_ }
    git -C $integWt merge --abort *>$null
    Log "  merge conflict on $Branch -> $($conflicts -join ', ')"
    return 'conflict'
}

# ---------------------------------------------------------------------------
# Execute segments in order
# ---------------------------------------------------------------------------
$results   = @()    # { Rel, Green, Reason }
$fixupList = @()     # prompts needing a sequential fixup pass (merge conflict)
$tip       = $baseSha
$successCount = 0; $failCount = 0; $skipCount = 0

function Get-IntegTip { return (git -C $integWt rev-parse HEAD).Trim() }

function Invoke-Wave {
    param($Items, [bool]$Parallel)
    $queue   = [System.Collections.Generic.Queue[object]]::new()
    $Items | Where-Object { -not $doneSet.Contains($_.RelPath) } | ForEach-Object { $queue.Enqueue($_) }
    $running = @()   # active job objects
    $green   = @()   # branches to merge (in completion order; merged after barrier)
    $cap     = if ($Parallel) { $MaxParallel } else { 1 }

    while ($queue.Count -gt 0 -or $running.Count -gt 0) {
        # Fill free slots
        while ($running.Count -lt $cap -and $queue.Count -gt 0) {
            $p = $queue.Dequeue()
            $slot = $pool | Where-Object { -not $_.Busy } | Select-Object -First 1
            $slot.Busy = $true
            $job = Invoke-PromptJob -Prompt $p -Wt $slot.Path -Tip (Get-IntegTip)
            $job | Add-Member -NotePropertyName Slot -NotePropertyValue $slot
            $running += $job
            Log ("START [{0}/{1}] {2}  (wt={3})" -f $p.Index, $total, $p.Label, (Split-Path $slot.Path -Leaf))
        }
        Start-Sleep -Seconds $PollSeconds
        # Reap finished / timed-out
        $still = @()
        foreach ($job in $running) {
            $elapsedMin = ((Get-Date) - $job.Start).TotalMinutes
            $timedOut = ($elapsedMin -gt $TimeoutMinutes)
            if ($job.Proc.HasExited -or $timedOut) {
                if ($timedOut -and -not $job.Proc.HasExited) {
                    Log ("TIMEOUT {0} — killing PID {1}" -f $job.Prompt.Label, $job.Proc.Id)
                    Stop-ProcessTree -ProcessId $job.Proc.Id
                    Start-Sleep -Seconds 2
                }
                Close-AgentProcess -Job $job.Launched
                $res = Resolve-JobResult -Job $job -TimedOut:$timedOut
                $commitSha = (git -C $job.Wt rev-parse HEAD 2>$null)
                State @{ event='done'; idx=$job.Prompt.Index; rel=$job.Prompt.RelPath; branch=$job.Branch; green=$res.Green; reason=$res.Reason; commit=$commitSha }
                if ($res.Green) {
                    $green += [PSCustomObject]@{ Branch=$job.Branch; Prompt=$job.Prompt }
                    Log ("GREEN  [{0}] {1}" -f $job.Prompt.Index, $job.Prompt.Label) 
                } else {
                    $script:failCount++
                    $script:results += [PSCustomObject]@{ Rel=$job.Prompt.RelPath; Green=$false; Reason=$res.Reason }
                    Log ("RED    [{0}] {1} — {2}" -f $job.Prompt.Index, $job.Prompt.Label, $res.Reason)
                }
                $job.Slot.Busy = $false
            } else {
                $still += $job
            }
        }
        $running = $still
    }

    # Barrier: merge all green branches sequentially into integration (finding 2/5).
    foreach ($g in $green) {
        $outcome = Merge-GreenBranch -Branch $g.Branch
        if ($outcome -eq 'merged') {
            $script:successCount++
            $script:results += [PSCustomObject]@{ Rel=$g.Prompt.RelPath; Green=$true; Reason='' }
            Add-Done $g.Prompt.RelPath
            git -C $RepoRoot branch -D $g.Branch *>$null
        } else {
            # Defer to sequential fixup on the merged tip.
            $script:fixupList += $g.Prompt
            git -C $RepoRoot branch -D $g.Branch *>$null
            State @{ event='fixup-queued'; rel=$g.Prompt.RelPath }
        }
    }
}

foreach ($seg in $segments) {
    $segPend = ($seg.Items | Where-Object { -not $doneSet.Contains($_.RelPath) })
    if ($segPend.Count -eq 0) { $skipCount += $seg.Items.Count; continue }
    Write-Host ""
    Write-Host (">>> {0} segment — {1} ({2} pending) <<<" -f `
        $(if ($seg.Parallel){'PARALLEL'}else{'SEQUENTIAL'}), $seg.Program, $segPend.Count) -ForegroundColor Magenta

    Invoke-Wave -Items $seg.Items -Parallel:$seg.Parallel

    # STOP between segments if this segment produced reds (a red infra prompt must
    # block dependent segments) unless -ContinueOnRed.
    if ($failCount -gt 0 -and -not $ContinueOnRed) {
        Log "STOP: segment had $failCount red prompt(s). Fix + re-run with -Resume (or -ContinueOnRed)."
        break
    }
}

# ---------------------------------------------------------------------------
# Sequential fixup pass for merge-conflicted (shared-file) prompts
# ---------------------------------------------------------------------------
if ($fixupList.Count -gt 0 -and ($failCount -eq 0 -or $ContinueOnRed)) {
    Write-Host ""
    Write-Host (">>> SEQUENTIAL FIXUP pass — {0} conflicted prompt(s) <<<" -f $fixupList.Count) -ForegroundColor Magenta
    foreach ($p in $fixupList) {
        $job = Invoke-PromptJob -Prompt $p -Wt $pool[0].Path -Tip (Get-IntegTip)
        while (-not $job.Proc.HasExited -and ((Get-Date)-$job.Start).TotalMinutes -le $TimeoutMinutes) { Start-Sleep -Seconds $PollSeconds }
        $timedOut = -not $job.Proc.HasExited
        if ($timedOut) { Stop-ProcessTree -ProcessId $job.Proc.Id }
        Close-AgentProcess -Job $job.Launched
        $res = Resolve-JobResult -Job $job -TimedOut:$timedOut
        if ($res.Green) {
            $outcome = Merge-GreenBranch -Branch $job.Branch
            if ($outcome -eq 'merged') {
                $successCount++; $results += [PSCustomObject]@{ Rel=$p.RelPath; Green=$true; Reason='(fixup)' }
                Add-Done $p.RelPath
                Log "FIXUP merged $($p.Label)"
            } else {
                $failCount++; $results += [PSCustomObject]@{ Rel=$p.RelPath; Green=$false; Reason='fixup still conflicts' }
                Log "FIXUP still conflicts: $($p.Label)"
            }
        } else {
            $failCount++; $results += [PSCustomObject]@{ Rel=$p.RelPath; Green=$false; Reason="fixup: $($res.Reason)" }
        }
        git -C $RepoRoot branch -D $job.Branch *>$null
    }
}

# ---------------------------------------------------------------------------
# Teardown + summary
# ---------------------------------------------------------------------------
if (-not $KeepWorktrees) {
    foreach ($w in $pool) { git -C $RepoRoot worktree remove --force $w.Path *>$null }
    git -C $RepoRoot worktree prune | Out-Null
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  PARALLEL RUN FINISHED" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Merged green : $successCount" -ForegroundColor Green
Write-Host "  Red/failed   : $failCount" -ForegroundColor $(if ($failCount){'Red'}else{'Green'})
Write-Host "  Skipped done : $skipCount" -ForegroundColor DarkGray
Write-Host "  Integration  : $IntegrationBranch  (in $integWt)"
Write-Host "  Run state    : $runStateDir"
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To adopt the work:  git checkout feature/apps; git merge --ff-only $IntegrationBranch" -ForegroundColor Yellow
Write-Host "  (or review first:   git -C `"$integWt`" log --oneline $baseSha..HEAD )" -ForegroundColor DarkGray

if ($results.Count -gt 0) {
    $reds = $results | Where-Object { -not $_.Green }
    if ($reds) {
        Write-Host ""
        Write-Host "  Red prompts:" -ForegroundColor Red
        foreach ($r in $reds) { Write-Host ("    {0,-60} {1}" -f $r.Rel, $r.Reason) -ForegroundColor Red }
    }
}
if ($failCount -gt 0) { exit 1 }
