#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync — Master runner for the db-refactor prompt sequence (Phase 3 → end).

.DESCRIPTION
  Auto-discovers .prompt.md files under .github/prompts/db-refactor/phase-*/
  and runs them via `copilot -p "..." --yolo --autopilot`.

  Walks phase directories in lexical order (phase-2-spike, phase-3-schema,
  phase-5a-migration-baseline, phase-5b-go-models, ...) and within each phase
  runs prompts in numeric order. A single done.txt at the runner root tracks
  completion across all phases so reruns are safe and resumable.

  Each prompt is expected to commit its own changes (see "Commit When Done"
  section of every db-refactor prompt). The runner does not commit on the
  prompt's behalf.

.USAGE
  .\run-prompts.ps1                                  # Run all pending prompts across all phases
  .\run-prompts.ps1 -Phase phase-3-schema            # Run only one phase directory
  .\run-prompts.ps1 -StartFrom 5                     # Resume from global prompt #5
  .\run-prompts.ps1 -DryRun                          # Preview without executing
  .\run-prompts.ps1 -Model "claude-sonnet-4.6"       # Use a specific model
  .\run-prompts.ps1 -Single "08-create-signal-observations-hypertable.prompt.md"
                                                      # Run one prompt by filename
  .\run-prompts.ps1 -Reset                           # Wipe done.txt and start fresh
#>

param(
    [string]$RepoRoot     = "D:\repos\teslasync",
    [string]$Phase        = "",              # e.g. phase-3-schema — restrict to one phase dir
    [string]$Single       = "",              # Run a single prompt by filename (searches all phases)
    [string]$Model        = "",              # claude-sonnet-4.6, claude-opus-4.7, gpt-5.4, etc.
    [switch]$DryRun       = $false,
    [switch]$Reset        = $false,
    [int]$StartFrom       = 1,
    [int]$DelaySeconds    = 10,
    [int]$TimeoutMinutes  = 45               # Schema prompts are quick; Go/frontend phases need longer
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Discover prompts (walk all phase-* subdirs in lexical order)
# ---------------------------------------------------------------------------
$promptsRoot = Join-Path $RepoRoot ".github\prompts\db-refactor"

if (-not (Test-Path $promptsRoot)) {
    Write-Host "ERROR: db-refactor prompts root not found: $promptsRoot" -ForegroundColor Red
    exit 1
}

# Filter to a single phase if requested
$phaseDirs = if ($Phase) {
    $candidate = Join-Path $promptsRoot $Phase
    if (-not (Test-Path $candidate -PathType Container)) {
        Write-Host "ERROR: Phase directory not found: $candidate" -ForegroundColor Red
        Write-Host "Available phases:" -ForegroundColor Yellow
        Get-ChildItem -Path $promptsRoot -Directory -Filter "phase-*" |
            Sort-Object Name | ForEach-Object { Write-Host "  $($_.Name)" }
        exit 1
    }
    @(Get-Item $candidate)
} else {
    Get-ChildItem -Path $promptsRoot -Directory -Filter "phase-*" |
        Sort-Object @{ Expression = {
            if ($_.Name -match '^phase-(\d+)') { [int]$Matches[1] } else { 9999 }
        }}, Name
}

if ($phaseDirs.Count -eq 0) {
    Write-Host "ERROR: No phase-* directories found under $promptsRoot" -ForegroundColor Red
    exit 1
}

# Build ordered prompt list across all phase dirs
$prompts = @()
$index = 0
foreach ($pd in $phaseDirs) {
    $files = Get-ChildItem -Path $pd.FullName -Filter "*.prompt.md" | Sort-Object Name
    foreach ($file in $files) {
        $index++
        $relPath = $file.FullName.Substring($promptsRoot.Length + 1).Replace('\','/')
        $prompts += [PSCustomObject]@{
            Index    = $index
            Phase    = $pd.Name
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
        Write-Host "ERROR: No prompt named '$Single' under any phase directory." -ForegroundColor Red
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
function Test-LogSaysRed {
    param([string]$LogPath)
    if (-not (Test-Path $LogPath)) { return @($true, 'log file missing') }
    $content = Get-Content $LogPath -Raw
    $reasons = @()
    if ($content -match '(?m)^EXIT=(?!0\s*$)\d+')             { $reasons += 'EXIT non-zero' }
    if ($content -match '(?m)^STATUS=BLOCKED')                 { $reasons += 'STATUS=BLOCKED' }
    if ($content -match '\[FAIL\]')                            { $reasons += '[FAIL] marker' }
    if ($content -match '(?m)^UNEXPECTED_COUNT=(?!0\s*$)\d+')  { $reasons += 'UNEXPECTED_COUNT' }
    if ($reasons.Count -gt 0) { return @($true, ($reasons -join ', ')) }
    return @($false, '')
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
$doneCount    = ($prompts | Where-Object { $doneSet.Contains($_.RelPath) }).Count
$pendingCount = $total - $doneCount

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  TeslaSync — db-refactor Master Runner" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Prompts root  : $promptsRoot"
Write-Host "  Phases        : $($phaseDirs.Count) ($(($phaseDirs | ForEach-Object Name) -join ', '))"
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
    $currentPhase = ""
    foreach ($p in $prompts) {
        if ($p.Phase -ne $currentPhase) {
            $currentPhase = $p.Phase
            Write-Host ""
            Write-Host "── $currentPhase ──" -ForegroundColor Cyan
        }
        $marker = if ($doneSet.Contains($p.RelPath)) { "✓" } elseif ($p.Index -lt $StartFrom) { "·" } else { " " }
        Write-Host ("  {0} [{1,3}/{2}] {3}" -f $marker, $p.Index, $total, $p.Label)
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
$currentPhase = ""

foreach ($p in $prompts) {

    # Phase banner
    if ($p.Phase -ne $currentPhase) {
        $currentPhase = $p.Phase
        Write-Host ""
        Write-Host "▶▶▶ Entering phase: $currentPhase ◀◀◀" -ForegroundColor Magenta
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
    $logFile       = Join-Path $logDir "prompt-$($p.Index.ToString('D3'))-$($p.Label).log"

    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "$tag $($p.Phase)/$($p.Label)" -ForegroundColor Green
    Write-Host "  Prompt    : $($p.RelPath)" -ForegroundColor DarkYellow
    Write-Host "  Log       : $logFile"

    $overallPct = [math]::Round((($successCount + $failCount + $skipCount) / $total) * 100)
    Write-Progress -Activity "TeslaSync db-refactor Runner" `
        -Status "$($p.Label) [$($successCount + $skipCount + $failCount + 1)/$total]" `
        -PercentComplete $overallPct
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

    $copilotArgs = @(
        "-p", $promptContent,
        "--yolo",
        "--autopilot",
        "-s"
    )
    if ($Model) {
        $copilotArgs += @("--model", $Model)
    }

    $startTime = Get-Date
    Log "$tag START  $($p.RelPath)"

    $tempArgsFile = Join-Path $env:TEMP "teslasync-dbrefactor-$($p.Index).json"
    $copilotArgs | ConvertTo-Json | Set-Content -Path $tempArgsFile -Encoding UTF8

    $job = Start-Job -ScriptBlock {
        param($wd, $argsFile)
        Set-Location $wd
        $cArgs = Get-Content $argsFile -Raw | ConvertFrom-Json
        & copilot @cArgs 2>&1
    } -ArgumentList $RepoRoot, $tempArgsFile

    $timeoutSec = $TimeoutMinutes * 60
    $spinChars  = @('⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏')
    $spinIdx    = 0
    $elapsed    = 0

    while ($job.State -eq "Running" -and $elapsed -lt $timeoutSec) {
        $mins = [math]::Floor($elapsed / 60)
        $secs = $elapsed % 60
        $pct  = [math]::Min(99, [math]::Round(($elapsed / $timeoutSec) * 100))
        $bar  = ('█' * [math]::Floor($pct / 5)) + ('░' * (20 - [math]::Floor($pct / 5)))
        $spin = $spinChars[$spinIdx % $spinChars.Length]

        Write-Host -NoNewline ("`r  $spin [$bar] ${mins}m ${secs}s elapsed — Copilot is working...   ") -ForegroundColor Yellow

        Start-Sleep -Seconds 3
        $elapsed += 3
        $spinIdx++
    }
    Write-Host ""

    $finished = if ($job.State -ne "Running") { $job } else { $null }

    if ($null -eq $finished) {
        Log "$tag TIMEOUT after $TimeoutMinutes min — force stopping"
        Write-Host "  ⚠ TIMEOUT — killing session" -ForegroundColor Red

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
        Log "$tag FAILED (exit $exitCode) after $mins min"
        Write-Host ""
        Write-Host "  FAILED after $mins min (exit code $exitCode)" -ForegroundColor Red
        Write-Host "  Log: $logFile" -ForegroundColor Red
        Write-Host ""
        $answer = Read-Host "  Continue to next prompt? (y/n/q)"
        if ($answer -eq 'q' -or $answer -eq 'n') {
            Log "ABORTED by user at prompt $($p.Index)"
            Write-Host "Aborted. Resume later with: -StartFrom $($p.Index)" -ForegroundColor Yellow
            exit 1
        }
    }
    else {
        # Log-gate: even if CLI exited 0, check the child log for red markers
        $logGate = Test-LogSaysRed $logFile
        if ($logGate[0]) {
            $failCount++
            Log "$tag LOG-GATE FAILED ($($logGate[1])) after $mins min"
            Write-Host ""
            Write-Host "  LOG-GATE FAILED after $mins min" -ForegroundColor Red
            Write-Host "  Reason: $($logGate[1])" -ForegroundColor Red
            Write-Host "  CLI exited 0 but child log contains red markers." -ForegroundColor Red
            Write-Host "  Log: $logFile" -ForegroundColor Red
            Write-Host ""
            $answer = Read-Host "  Continue to next prompt? (y/n/q)"
            if ($answer -eq 'q' -or $answer -eq 'n') {
                Log "ABORTED by user at prompt $($p.Index) (log-gate)"
                Write-Host "Aborted. Resume later with: -StartFrom $($p.Index)" -ForegroundColor Yellow
                exit 1
            }
        }
        else {
            $successCount++
            Log "$tag DONE in $mins min"
            Write-Host "  ✓ Completed in $mins min" -ForegroundColor Green

            Add-Content -Path $doneFile -Value $p.RelPath
            $doneSet.Add($p.RelPath) | Out-Null
        }
    }

    if ($DelaySeconds -gt 0) {
        Write-Host "  Waiting $DelaySeconds seconds before next prompt..." -ForegroundColor DarkGray
        Start-Sleep -Seconds $DelaySeconds
    }
}

Write-Progress -Activity "TeslaSync db-refactor Runner" -Completed

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

if ($failCount -gt 0) { exit 1 }
