#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync — Master runner for the monorepo native-apps prompt sequence
  (Windows / Android / Apple, plus shared core + foundation + hardening).

.DESCRIPTION
  Auto-discovers .prompt.md files under .github/prompts/monorepo/p*-*/
  (recursive — picks up pages/, dashboard-widgets/, modals-dialogs/,
  feature-views/, widget-primitives/, shared-meaningful/, misc-surfaces/
  subdirs inside each platform program) and runs them via
  `copilot -p "..." --yolo --autopilot`.

  Walks program directories in numeric order:
    p0-foundation → p1-shared → p2-windows → p3-android → p4-apple → p5-hardening
  Within each program, prompts run in lexical order. A single done.txt at
  monorepo/logs/done.txt tracks completion across all programs so reruns
  are safe and resumable.

  The top-level 0000-methodology.prompt.md at the monorepo root is the
  meta-document — it is NOT executed by the runner.

  Each prompt is expected to commit its own changes (see "Commit" section
  of every monorepo prompt). The runner does not commit on the prompt's
  behalf.

  This script is structurally identical to
  .github/prompts/db-refactor/run-prompts.ps1 with monorepo paths/labels
  and recursive program-dir walking. Keep them in sync when the upstream
  runner gains new features.

.USAGE
  .\run-prompts.ps1                                  # Run all pending prompts across all programs
  .\run-prompts.ps1 -Program p2-windows              # Run only one program directory
  .\run-prompts.ps1 -StartFrom 5                     # Resume from global prompt #5
  .\run-prompts.ps1 -DryRun                          # Preview without executing
  .\run-prompts.ps1 -Model "claude-sonnet-4.6"       # Use a specific model
  .\run-prompts.ps1 -Single "0001-apps-skeleton.prompt.md"
                                                       # Run one prompt by filename (recursive search)
  .\run-prompts.ps1 -Reset                           # Wipe done.txt and start fresh
#>

param(
    [string]$RepoRoot     = "D:\repos\teslasync",
    [string]$Program      = "",              # e.g. p2-windows — restrict to one program dir
    [string]$Single       = "",              # Run a single prompt by filename (searches all programs)
    [string]$Model        = "",              # claude-sonnet-4.6, claude-opus-4.7, gpt-5.4, etc.
    [switch]$DryRun       = $false,
    [switch]$Reset        = $false,
    [int]$StartFrom       = 1,
    [int]$DelaySeconds    = 10,
    [int]$TimeoutMinutes  = 600,              # Platform UI prompts often need more than schema work
    [switch]$ContinueOnRed = $false,         # Do not STOP after a red prompt (default: STOP on red)
    [switch]$SelfTest      = $false          # Run Test-LogSaysRed self-test and exit
)

$ErrorActionPreference = "Stop"

# NOTE on prompt delivery:
# Many monorepo prompts (especially per-page / per-widget / per-feature-view
# prompts emitted into pages/, dashboard-widgets/, etc.) exceed Windows'
# 32768-wchar CreateProcessW command-line limit. Passing them via `-p <text>`
# therefore fails at process-launch with the misleading PS error:
#   "StandardOutputEncoding is only supported when standard output is redirected"
# (which masks the underlying Win32 ERROR_FILENAME_EXCED_RANGE = 206).
# This runner pipes the prompt body to copilot.exe via stdin instead — copilot
# accepts the prompt from stdin when -p is omitted, runs non-interactively
# under --yolo --autopilot, and exits when stdin closes.

# ---------------------------------------------------------------------------
# Discover prompts (walk all p*-* subdirs in numeric order, recursive)
# ---------------------------------------------------------------------------
$promptsRoot = Join-Path $RepoRoot ".github\prompts\monorepo"

if (-not (Test-Path $promptsRoot)) {
    Write-Host "ERROR: monorepo prompts root not found: $promptsRoot" -ForegroundColor Red
    exit 1
}

# Filter to a single program if requested
$programDirs = if ($Program) {
    $candidate = Join-Path $promptsRoot $Program
    if (-not (Test-Path $candidate -PathType Container)) {
        Write-Host "ERROR: Program directory not found: $candidate" -ForegroundColor Red
        Write-Host "Available programs:" -ForegroundColor Yellow
        Get-ChildItem -Path $promptsRoot -Directory -Filter "p*-*" |
            Sort-Object Name | ForEach-Object { Write-Host "  $($_.Name)" }
        exit 1
    }
    @(Get-Item $candidate)
} else {
    Get-ChildItem -Path $promptsRoot -Directory -Filter "p*-*" |
        Sort-Object @{ Expression = {
            if ($_.Name -match '^p(\d+)-') { [int]$Matches[1] } else { 9999 }
        }}, Name
}

if ($programDirs.Count -eq 0) {
    Write-Host "ERROR: No p*-* program directories found under $promptsRoot" -ForegroundColor Red
    exit 1
}

# Build ordered prompt list across all program dirs (recursive within each)
# IMPORTANT: skip the top-level 0000-methodology.prompt.md — it is the meta
# document, not an executable prompt. Also skip any README.md files.
#
# Sort order within a program directory uses NATURAL NUMERIC SORT on the
# filename's leading phase/sequence tokens, NOT plain lexical FullName sort.
# Lexical sort produces the bug S0 < S1 < S10 < S11 < S2 < S3 ... which
# silently runs phase-10 prompts before phase-2 and breaks predecessor
# dependencies (S11 needs S3 but ran after S10 in the broken order).
#
# Patterns handled (in priority order):
#   1. <Letter><PhaseDigit>-<SeqDigit>-<slug>   — infra prompts: S0-0001,
#      W7-0001, A12-0001, H99-0001. Sort by (letter, phase, seq).
#   2. <Digit>-<slug>                            — pure-numeric p0 prompts:
#      0001-, 0099-. Treated as ('', 0, seq) so they sort first.
#   3. <Letter>-<SeqDigit>-<slug>                — surface prompts with no
#      phase digit: W-0001-AlertFeed. Treated as (letter, 999, seq) so they
#      run AFTER all infra prompts in the same program.
#   4. anything else (e.g. pages/admin/APIKeysPage.prompt.md with no leading
#      digit or known prefix) — bucketed as ('zzz-unprefixed', 9999, 0) so
#      they sort dead last within their subdir, tiebroken on name.
# Subdir name is the 4th key so files in `S8/` (which match pattern 1 with
# phase=8) interleave naturally between top-level `S7-` and `S9-` files,
# but subdir surface buckets (dashboard-widgets/, pages/admin/, ...) sort
# after their parent's top-level infra because their phase is 999/9999.
function Get-PromptSortKey {
    param($file, [string]$programRoot)
    $name = ($file.BaseName -replace '\.prompt$', '')
    $relDir = $file.DirectoryName.Substring($programRoot.Length).TrimStart('\')

    if ($name -match '^([A-Za-z]+)(\d+)-(\d+)') {
        return [PSCustomObject]@{ Letter=$Matches[1]; Phase=[int]$Matches[2]; Seq=[int]$Matches[3]; Dir=$relDir; Name=$name }
    }
    if ($name -match '^(\d+)-') {
        return [PSCustomObject]@{ Letter=''; Phase=0; Seq=[int]$Matches[1]; Dir=$relDir; Name=$name }
    }
    if ($name -match '^([A-Za-z]+)-(\d+)') {
        return [PSCustomObject]@{ Letter=$Matches[1]; Phase=999; Seq=[int]$Matches[2]; Dir=$relDir; Name=$name }
    }
    return [PSCustomObject]@{ Letter='zzz-unprefixed'; Phase=9999; Seq=0; Dir=$relDir; Name=$name }
}

$prompts = @()
$index = 0
foreach ($pd in $programDirs) {
    $files = Get-ChildItem -Path $pd.FullName -Recurse -Filter "*.prompt.md" -File
    $sorted = $files |
        Select-Object @{Name='File';Expression={$_}}, @{Name='Key';Expression={ Get-PromptSortKey $_ $pd.FullName }} |
        Sort-Object @{Expression={$_.Key.Letter}}, @{Expression={$_.Key.Phase}}, @{Expression={$_.Key.Dir}}, @{Expression={$_.Key.Seq}}, @{Expression={$_.Key.Name}} |
        Select-Object -ExpandProperty File

    foreach ($file in $sorted) {
        $index++
        $relPath = $file.FullName.Substring($promptsRoot.Length + 1).Replace('\','/')
        $prompts += [PSCustomObject]@{
            Index    = $index
            Program  = $pd.Name
            Label    = $file.BaseName -replace '\.prompt$', ''
            RelPath  = $relPath
            FullPath = $file.FullName
        }
    }
}

# If -Single, narrow to that one prompt
if ($Single) {
    $match = $prompts | Where-Object { (Split-Path $_.RelPath -Leaf) -eq $Single }
    if (-not $match) {
        Write-Host "ERROR: No prompt named '$Single' under any program directory." -ForegroundColor Red
        exit 1
    }
    $prompts = @($match)
}

$total = $prompts.Count
if ($total -eq 0) {
    Write-Host "ERROR: No .prompt.md files discovered." -ForegroundColor Red
    exit 1
}

# ---------------------------------------------------------------------------
# Setup logging + done tracking
# ---------------------------------------------------------------------------
$logDir = Join-Path $promptsRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

$doneFile = Join-Path $logDir "done.txt"
if ($Reset) {
    if (Test-Path $doneFile) { Remove-Item $doneFile -Force }
    Write-Host "Reset: cleared done.txt" -ForegroundColor Yellow
}
if (-not (Test-Path $doneFile)) { Set-Content -Path $doneFile -Value "" -Encoding UTF8 }
$doneSet = New-Object 'System.Collections.Generic.HashSet[string]'
Get-Content $doneFile | Where-Object { $_.Trim() -ne "" } | ForEach-Object { $doneSet.Add($_) | Out-Null }

$runLog = Join-Path $logDir "run-$(Get-Date -Format 'yyyy-MM-dd_HH-mm-ss').log"

function Log([string]$msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "[$timestamp] $msg"
    Write-Host $entry
    Add-Content -Path $runLog -Value $entry
}

# ---------------------------------------------------------------------------
# Log-gate: detect red markers in child logs even when CLI exits 0
# ---------------------------------------------------------------------------
# Honors the canonical "final marker wins" rule: gates are allowed to retry
# (write multiple === GATE === blocks) so long as the LAST EXIT=/STATUS= lines
# in the log are EXIT=0 STATUS=DONE. This matches how the prompt runner agent
# legitimately retries after fixing predecessor drift mid-prompt.
# Absence of EXIT=/STATUS= markers is NOT a failure (the transcript log is the
# agent's verbatim CLI output and rarely contains these markers — only the
# artifact log written by the prompt's gate script does). The artifact log's
# own gate script enforces marker presence via predecessor checks.
# [FAIL] markers and non-zero UNEXPECTED_COUNT remain hard fails anywhere
# in the log because they signal real environment problems (test failure,
# unexpected git drift) that retry cannot legitimately resolve to clean.
function Test-LogSaysRed {
    param([string]$LogPath)
    if (-not (Test-Path $LogPath)) { return @($true, 'log file missing') }
    $content = Get-Content $LogPath -Raw
    $reasons = @()

    # Final-marker-wins for EXIT=. Only fail if markers exist AND the last one is non-zero.
    $exitMatches = [regex]::Matches($content, '(?m)^EXIT=(\d+)\s*$')
    if ($exitMatches.Count -gt 0 -and $exitMatches[$exitMatches.Count - 1].Groups[1].Value -ne '0') {
        $reasons += "final EXIT=$($exitMatches[$exitMatches.Count - 1].Groups[1].Value)"
    }

    # Final-marker-wins for STATUS=. Only fail if markers exist AND the last one isn't DONE.
    $statusMatches = [regex]::Matches($content, '(?m)^STATUS=(\w+)\s*$')
    if ($statusMatches.Count -gt 0 -and $statusMatches[$statusMatches.Count - 1].Groups[1].Value -ne 'DONE') {
        $reasons += "final STATUS=$($statusMatches[$statusMatches.Count - 1].Groups[1].Value)"
    }

    # Anchor [FAIL] to line-start so it doesn't false-positive on self-test
    # echo lines like "[PASS] fail-marker -> reason='[FAIL] marker'" or on
    # the runner's own progress messages that quote the literal token.
    # Real failure markers are conventionally written at column 0.
    if ($content -match '(?m)^\s*\[FAIL\]')                    { $reasons += '[FAIL] marker' }
    if ($content -match '(?m)^UNEXPECTED_COUNT=(?!0\s*$)\d+')  { $reasons += 'UNEXPECTED_COUNT' }

    # Final-marker-wins for COMMIT_EXIT=. A non-zero last commit exit is RED.
    $commitMatches = [regex]::Matches($content, '(?m)^COMMIT_EXIT=(\d+)\s*$')
    if ($commitMatches.Count -gt 0 -and $commitMatches[$commitMatches.Count - 1].Groups[1].Value -ne '0') {
        $reasons += "commit failed (COMMIT_EXIT=$($commitMatches[$commitMatches.Count - 1].Groups[1].Value))"
    }

    # Parity gate: PARITY_COVERED < PARITY_REQUIRED is RED.
    if ($content -match '(?m)^PARITY_COVERED=(\d+)') {
        $cov = [int]$Matches[1]
        if ($content -match '(?m)^PARITY_REQUIRED=(\d+)') {
            if ($cov -lt [int]$Matches[1]) { $reasons += "parity gap (COVERED=$cov < REQUIRED=$($Matches[1]))" }
        }
    }

    if ($reasons.Count -gt 0) { return @($true, ($reasons -join ', ')) }
    return @($false, '')
}

# ---------------------------------------------------------------------------
# Self-test (-SelfTest): prove Test-LogSaysRed flags red logs and passes green.
# This is the gate required by P0/0005 — a runner that records a BLOCKED prompt
# as DONE is the exact failure mode we must never reproduce.
# ---------------------------------------------------------------------------
if ($SelfTest) {
    $stFails = 0
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("runner-selftest-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null

    function Assert-Red([string]$name, [string]$body, [bool]$expectRed) {
        $f = Join-Path $tmp ($name + '.log')
        Set-Content -Path $f -Value $body -Encoding UTF8
        $res = Test-LogSaysRed $f
        $ok = ($res[0] -eq $expectRed)
        $verdict = if ($ok) { 'PASS' } else { 'FAIL' }
        Write-Host ("  [{0}] {1} -> isRed={2} (expected {3}) reason='{4}'" -f $verdict, $name, $res[0], $expectRed, $res[1])
        if (-not $ok) { $script:stFails++ }
    }

    Write-Host "Test-LogSaysRed self-test:" -ForegroundColor Cyan
    Assert-Red 'blocked'     "STATUS=BLOCKED"                                  $true
    Assert-Red 'exit-nonzero' "EXIT=1`nSTATUS=DONE"                            $true
    Assert-Red 'fail-marker' "[FAIL] something broke`nEXIT=0"                  $true
    Assert-Red 'commit-fail' "COMMIT_EXIT=1`nEXIT=0`nSTATUS=DONE"             $true
    Assert-Red 'parity-gap'  "PARITY_REQUIRED=10`nPARITY_COVERED=7`nEXIT=0`nSTATUS=DONE" $true
    Assert-Red 'green'       "PARITY_REQUIRED=10`nPARITY_COVERED=10`nCOMMIT_EXIT=0`nEXIT=0`nSTATUS=DONE" $false

    # log-missing case (path that does not exist) must be red
    $missingRes = Test-LogSaysRed (Join-Path $tmp 'does-not-exist.log')
    $mOk = ($missingRes[0] -eq $true)
    Write-Host ("  [{0}] log-missing -> isRed={1} (expected True)" -f $(if ($mOk) {'PASS'} else {'FAIL'}), $missingRes[0])
    if (-not $mOk) { $stFails++ }

    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host ""
    Write-Host "SELFTEST_EXIT=$stFails"
    if ($stFails -eq 0) {
        Write-Host "STATUS=DONE" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "STATUS=BLOCKED" -ForegroundColor Red
        exit 1
    }
}

# table using a field labeled either `Log` (most common) or `Output log`
# (db-refactor legacy). Both backtick-quoted relative paths are accepted.
function Get-PromptArtifactLogPath {
    param([string]$PromptContent)

    $match = [regex]::Match($PromptContent, '\|\s*(?:Output\s+log|Log)\s*\|\s*`([^`]+)`\s*\|')
    if (-not $match.Success) { return $null }

    $path = $match.Groups[1].Value.Replace('/', '\')

    # Monorepo prompts commonly use a relative log path like
    # `../logs/p0-0001-apps-skeleton.log` which is relative to the prompt's
    # own directory. Anchor those to the prompt's containing program dir
    # (we don't know the source prompt here, but the canonical convention
    # is `../logs/...` from a program dir, which resolves to monorepo/logs).
    if ($path.StartsWith('..\logs\') -or $path.StartsWith('..\..\logs\')) {
        $leaf = Split-Path $path -Leaf
        return (Join-Path $logDir $leaf)
    }
    if ([System.IO.Path]::IsPathRooted($path)) { return $path }
    return (Join-Path $RepoRoot $path)
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
$doneCount    = ($prompts | Where-Object { $doneSet.Contains($_.RelPath) }).Count
$pendingCount = $total - $doneCount

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  TeslaSync — monorepo Native Apps Master Runner" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Prompts root  : $promptsRoot"
Write-Host "  Programs      : $($programDirs.Count) ($(($programDirs | ForEach-Object Name) -join ', '))"
Write-Host "  Total prompts : $total"
Write-Host "  Already done  : $doneCount" -ForegroundColor DarkGray
Write-Host "  Pending       : $pendingCount" -ForegroundColor Green
Write-Host "  Starting from : #$StartFrom"
Write-Host "  Single        : $(if ($Single) { $Single } else { '(all)' })"
Write-Host "  Model         : $(if ($Model) { $Model } else { '(default)' })"
Write-Host "  Timeout       : $TimeoutMinutes min per prompt"
Write-Host "  Dry run       : $DryRun"
Write-Host "  Log-gate      : EXIT!=0 / STATUS=BLOCKED / [FAIL] / UNEXPECTED_COUNT → RED" -ForegroundColor Yellow
Write-Host "  Run log       : $runLog"
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

if ($DryRun) {
    Write-Host "DRY RUN — listing planned execution order:" -ForegroundColor Yellow
    $currentProgram = ""
    foreach ($p in $prompts) {
        if ($p.Program -ne $currentProgram) {
            $currentProgram = $p.Program
            Write-Host ""
            Write-Host "── $currentProgram ──" -ForegroundColor Cyan
        }
        $marker = if ($doneSet.Contains($p.RelPath)) { "DONE" } elseif ($p.Index -lt $StartFrom) { "SKIP" } else { "    " }
        Write-Host ("  {0} [{1,4}/{2}] {3}" -f $marker, $p.Index, $total, $p.RelPath)
    }
    Write-Host ""
    exit 0
}

# ---------------------------------------------------------------------------
# Execute prompts sequentially
# ---------------------------------------------------------------------------
$successCount = 0
$failCount    = 0
$skipCount    = 0
$currentProgram = ""
$results = @()   # per-prompt outcome table: id, RED?, reason

foreach ($p in $prompts) {

    # Program banner
    if ($p.Program -ne $currentProgram) {
        $currentProgram = $p.Program
        Write-Host ""
        Write-Host ">>> Entering program: $currentProgram <<<" -ForegroundColor Magenta
        Write-Host ""
    }

    $tag = "[$($p.Index)/$total]"

    if ($doneSet.Contains($p.RelPath)) {
        Write-Host "$tag DONE  $($p.Label)" -ForegroundColor DarkGray
        $skipCount++
        continue
    }

    if ($p.Index -lt $StartFrom) {
        Write-Host "$tag SKIP  $($p.Label) (before StartFrom)" -ForegroundColor DarkGray
        $skipCount++
        continue
    }

    if (-not (Test-Path $p.FullPath)) {
        Log "$tag MISSING  $($p.FullPath)"
        Write-Host "  File not found! Skipping." -ForegroundColor Red
        $failCount++
        continue
    }

    $promptContent = (Get-Content $p.FullPath -Raw).Trim()
    $logFile       = Join-Path $logDir "prompt-$($p.Index.ToString('D4'))-$($p.Label).log"
    $artifactLog   = Get-PromptArtifactLogPath $promptContent

    Write-Host ""
    Write-Host "----------------------------------------------------------" -ForegroundColor Cyan
    Write-Host "$tag $($p.Program)/$($p.Label)" -ForegroundColor Green
    Write-Host "  Prompt    : $($p.RelPath)" -ForegroundColor DarkYellow
    Write-Host "  Log       : $logFile"
    if ($artifactLog) {
        Write-Host "  Artifact  : $artifactLog"
    }

    $overallPct = [math]::Round((($successCount + $failCount + $skipCount) / $total) * 100)
    Write-Progress -Activity "TeslaSync monorepo Runner" `
        -Status "$($p.Label) [$($successCount + $skipCount + $failCount + 1)/$total]" `
        -PercentComplete $overallPct
    Write-Host "----------------------------------------------------------" -ForegroundColor Cyan

    # Args do NOT include `-p <prompt>` — the prompt is piped via stdin to
    # avoid the 32768-wchar Windows command-line limit. See note at the top
    # of the script.
    $copilotArgs = @(
        "--yolo",
        "--autopilot",
        "-s"
    )
    if ($Model) {
        $copilotArgs += @("--model", $Model)
    }

    $startTime = Get-Date
    Log "$tag START  $($p.RelPath)"

    if ($artifactLog -and (Test-Path $artifactLog)) {
        Remove-Item $artifactLog -Force
        Log "$tag Cleared stale artifact log $artifactLog"
    }

    $tempArgsFile   = Join-Path $env:TEMP "teslasync-monorepo-args-$($p.Index).json"
    $tempPromptFile = Join-Path $env:TEMP "teslasync-monorepo-prompt-$($p.Index).txt"
    $copilotArgs | ConvertTo-Json | Set-Content -Path $tempArgsFile -Encoding UTF8
    Set-Content -Path $tempPromptFile -Value $promptContent -Encoding UTF8 -NoNewline

    $job = Start-Job -ScriptBlock {
        param($wd, $argsFile, $promptFile)
        Set-Location $wd
        $cArgs = Get-Content $argsFile -Raw | ConvertFrom-Json
        # Pipe prompt body to copilot via stdin. The pipeline element also
        # forces PS to set RedirectStandardOutput=true on the child process,
        # which sidesteps the misleading "StandardOutputEncoding..." error
        # PS would otherwise throw under PS 7.6 + .NET 9.
        Get-Content $promptFile -Raw | & copilot @cArgs 2>&1
    } -ArgumentList $RepoRoot, $tempArgsFile, $tempPromptFile

    $timeoutSec = $TimeoutMinutes * 60
    $spinChars  = @('|','/','-','\')
    $spinIdx    = 0
    $elapsed    = 0

    while ($job.State -eq "Running" -and $elapsed -lt $timeoutSec) {
        $mins = [math]::Floor($elapsed / 60)
        $secs = $elapsed % 60
        $pct  = [math]::Min(99, [math]::Round(($elapsed / $timeoutSec) * 100))
        $bar  = ('#' * [math]::Floor($pct / 5)) + ('.' * (20 - [math]::Floor($pct / 5)))
        $spin = $spinChars[$spinIdx % $spinChars.Length]

        Write-Host -NoNewline ("`r  $spin [$bar] ${mins}m ${secs}s elapsed - Copilot is working...   ") -ForegroundColor Yellow

        Start-Sleep -Seconds 3
        $elapsed += 3
        $spinIdx++
    }
    Write-Host ""

    $finished = if ($job.State -ne "Running") { $job } else { $null }

    if ($null -eq $finished) {
        Log "$tag TIMEOUT after $TimeoutMinutes min - force stopping"
        Write-Host "  TIMEOUT - killing session" -ForegroundColor Red

        $childProcs = Get-Process -Name "copilot*" -ErrorAction SilentlyContinue |
                      Where-Object { $_.StartTime -ge $startTime }
        foreach ($cp in $childProcs) {
            Log "$tag Killing copilot PID $($cp.Id)"
            try { Stop-Process -Id $cp.Id -Force -ErrorAction SilentlyContinue } catch {}
        }

        Stop-Job $job -ErrorAction SilentlyContinue
        $output   = Receive-Job $job -ErrorAction SilentlyContinue
        $exitCode = -1
    }
    else {
        $output   = Receive-Job $job
        $exitCode = if ($job.State -eq "Completed") { 0 } else { 1 }
    }

    Remove-Job $job -Force -ErrorAction SilentlyContinue
    Remove-Item $tempArgsFile -Force -ErrorAction SilentlyContinue
    Remove-Item $tempPromptFile -Force -ErrorAction SilentlyContinue

    if ($output) {
        $output | Out-String | Set-Content -Path $logFile -Encoding UTF8
        $output | Out-String | Write-Host
    }

    Start-Sleep -Seconds 3
    $stale = Get-Process -Name "copilot*" -ErrorAction SilentlyContinue |
             Where-Object { $_.StartTime -ge $startTime }
    foreach ($sp in $stale) {
        Log "$tag Cleaning up stale copilot PID $($sp.Id)"
        try { Stop-Process -Id $sp.Id -Force -ErrorAction SilentlyContinue } catch {}
    }

    $elapsedTime = (Get-Date) - $startTime
    $mins = [math]::Round($elapsedTime.TotalMinutes, 1)

    if ($exitCode -ne 0) {
        $failCount++
        $results += [PSCustomObject]@{ Id = $p.RelPath; Red = $true; Reason = "exit $exitCode" }
        Log "$tag FAILED (exit $exitCode) after $mins min"
        Write-Host ""
        Write-Host "  FAILED after $mins min (exit code $exitCode)" -ForegroundColor Red
        Write-Host "  Log: $logFile" -ForegroundColor Red
        Write-Host ""
        if ($ContinueOnRed) {
            Log "$tag CONTINUE-ON-RED set; advancing past red prompt"
            Write-Host "  -ContinueOnRed set; advancing past red prompt." -ForegroundColor Yellow
        } else {
            Log "STOPPED at red prompt $($p.Index) (exit). Resume with: -StartFrom $($p.Index)"
            Write-Host "  STOP: red prompt. Pass -ContinueOnRed to override. Resume with: -StartFrom $($p.Index)" -ForegroundColor Yellow
            break
        }
    }
    else {
        # Log-gate: even if CLI exited 0, check the transcript and declared artifact log for red markers.
        $gateFailures = @()
        $logGate = Test-LogSaysRed $logFile
        if ($logGate[0]) {
            $gateFailures += "transcript log: $($logGate[1])"
        }
        if ($artifactLog) {
            $artifactGate = Test-LogSaysRed $artifactLog
            if ($artifactGate[0]) {
                $artifactRel = $artifactLog
                if ($artifactLog.StartsWith($RepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $artifactRel = $artifactLog.Substring($RepoRoot.Length).TrimStart('\')
                }
                $gateFailures += "artifact log $artifactRel`: $($artifactGate[1])"
            }
        }

        if ($gateFailures.Count -gt 0) {
            $failCount++
            $results += [PSCustomObject]@{ Id = $p.RelPath; Red = $true; Reason = ($gateFailures -join '; ') }
            Log "$tag LOG-GATE FAILED ($($gateFailures -join '; ')) after $mins min"
            Write-Host ""
            Write-Host "  LOG-GATE FAILED after $mins min" -ForegroundColor Red
            Write-Host "  Reason: $($gateFailures -join '; ')" -ForegroundColor Red
            Write-Host "  CLI exited 0 but child log contains red markers." -ForegroundColor Red
            Write-Host "  Log: $logFile" -ForegroundColor Red
            Write-Host ""
            # NEVER append a red prompt to done.txt — STOP unless -ContinueOnRed.
            if ($ContinueOnRed) {
                Log "$tag CONTINUE-ON-RED set; advancing past red prompt (log-gate)"
                Write-Host "  -ContinueOnRed set; advancing past red prompt." -ForegroundColor Yellow
            } else {
                Log "STOPPED at red prompt $($p.Index) (log-gate). Resume with: -StartFrom $($p.Index)"
                Write-Host "  STOP: red prompt. Pass -ContinueOnRed to override. Resume with: -StartFrom $($p.Index)" -ForegroundColor Yellow
                break
            }
        }
        else {
            $successCount++
            $results += [PSCustomObject]@{ Id = $p.RelPath; Red = $false; Reason = '' }
            Log "$tag DONE in $mins min"
            Write-Host "  Completed in $mins min" -ForegroundColor Green

            Add-Content -Path $doneFile -Value $p.RelPath
            $doneSet.Add($p.RelPath) | Out-Null
        }
    }

    if ($DelaySeconds -gt 0) {
        Write-Host "  Waiting $DelaySeconds seconds before next prompt..." -ForegroundColor DarkGray
        Start-Sleep -Seconds $DelaySeconds
    }
}

Write-Progress -Activity "TeslaSync monorepo Runner" -Completed

# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  FINISHED" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Succeeded : $successCount" -ForegroundColor Green
Write-Host "  Failed    : $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })
Write-Host "  Skipped   : $skipCount" -ForegroundColor DarkGray
Write-Host "  Run log   : $runLog"
Write-Host "  Done file : $doneFile"
Write-Host "================================================================" -ForegroundColor Cyan

# Per-prompt outcome table (id, RED?, reason)
if ($results.Count -gt 0) {
    Write-Host ""
    Write-Host "  Prompt outcomes:" -ForegroundColor Cyan
    Write-Host ("  {0,-55} {1,-5} {2}" -f 'id', 'RED?', 'reason')
    Write-Host ("  {0,-55} {1,-5} {2}" -f ('-' * 55), '-----', ('-' * 20))
    foreach ($r in $results) {
        $redStr = if ($r.Red) { 'YES' } else { 'no' }
        $color  = if ($r.Red) { 'Red' } else { 'Green' }
        Write-Host ("  {0,-55} {1,-5} {2}" -f $r.Id, $redStr, $r.Reason) -ForegroundColor $color
    }
}

if ($failCount -gt 0) { exit 1 }
