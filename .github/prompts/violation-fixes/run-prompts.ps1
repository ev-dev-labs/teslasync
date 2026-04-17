#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync — Runs violation-fix prompts sequentially via Copilot.

.DESCRIPTION
  Auto-discovers .prompt.md files under .github/prompts/violation-fixes/
  and runs them via `copilot -p "..." --yolo --autopilot`.
  Tracks which prompts are done. Logs every session output.

.USAGE
  .\run-prompts.ps1                                 # Run all pending prompts
  .\run-prompts.ps1 -StartFrom 2                    # Resume from prompt #2
  .\run-prompts.ps1 -DryRun                         # Preview without executing
  .\run-prompts.ps1 -Model "claude-sonnet-4"        # Use a specific model
  .\run-prompts.ps1 -Single "fix-inline-styles.prompt.md"  # Run one prompt
#>

param(
    [string]$RepoRoot     = "D:\repos\teslasync",
    [string]$Single       = "",              # Run a single prompt by filename
    [string]$Model        = "",              # claude-sonnet-4, claude-opus-4.6-1m, gpt-5.2, etc.
    [switch]$DryRun       = $false,
    [int]$StartFrom       = 1,
    [int]$DelaySeconds    = 10,
    [int]$TimeoutMinutes  = 30
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Discover prompts
# ---------------------------------------------------------------------------
$promptsRoot = Join-Path $RepoRoot ".github\prompts\violation-fixes"

if ($Single) {
    $singlePath = Join-Path $promptsRoot $Single
    if (-not (Test-Path $singlePath)) {
        Write-Host "ERROR: Prompt not found: $singlePath" -ForegroundColor Red
        exit 1
    }
    $files = @(Get-Item $singlePath)
}
else {
    $files = @(Get-ChildItem -Path $promptsRoot -Filter "*.prompt.md" | Sort-Object Name)
}

if ($files.Count -eq 0) {
    Write-Host "ERROR: No prompts found." -ForegroundColor Red
    exit 1
}

# Build ordered prompt list
$prompts = @()
$index = 0
foreach ($file in $files) {
    $index++
    $relPath = $file.Name
    $label   = $file.BaseName -replace "\.prompt$", ""

    $prompts += [PSCustomObject]@{
        Index    = $index
        Label    = $label
        RelPath  = $relPath
        FullPath = $file.FullName
    }
}

$total = $prompts.Count

# ---------------------------------------------------------------------------
# Setup logging
# ---------------------------------------------------------------------------
$logDir = Join-Path $promptsRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

# Done-tracking file
$doneFile = Join-Path $logDir "done.txt"
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
# Summary
# ---------------------------------------------------------------------------
$doneCount    = ($prompts | Where-Object { $doneSet.Contains($_.RelPath) }).Count
$pendingCount = $total - $doneCount

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  TeslaSync — Violation Fix Prompt Runner" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Prompt root   : $promptsRoot"
Write-Host "  Total prompts : $total"
Write-Host "  Already done  : $doneCount" -ForegroundColor DarkGray
Write-Host "  Pending       : $pendingCount" -ForegroundColor Green
Write-Host "  Starting from : #$StartFrom"
Write-Host "  Model         : $(if ($Model) { $Model } else { '(default)' })"
Write-Host "  Timeout       : $TimeoutMinutes min per prompt"
Write-Host "  Dry run       : $DryRun"
Write-Host "  Run log       : $runLog"
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if ($DryRun) {
    Write-Host "DRY RUN — showing what would execute:" -ForegroundColor Yellow
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Execute prompts sequentially
# ---------------------------------------------------------------------------
$successCount = 0
$failCount    = 0
$skipCount    = 0

foreach ($p in $prompts) {

    $tag = "[$($p.Index)/$total]"

    # Skip done prompts
    if ($doneSet.Contains($p.RelPath)) {
        Write-Host "$tag DONE  $($p.Label)" -ForegroundColor DarkGray
        $skipCount++
        continue
    }

    # Skip until StartFrom
    if ($p.Index -lt $StartFrom) {
        Write-Host "$tag SKIP  $($p.Label) (before StartFrom)" -ForegroundColor DarkGray
        $skipCount++
        continue
    }

    # Verify prompt file exists
    if (-not (Test-Path $p.FullPath)) {
        Log "$tag MISSING  $($p.FullPath)"
        Write-Host "  File not found! Skipping." -ForegroundColor Red
        $failCount++
        continue
    }

    # Read prompt content
    $promptContent = (Get-Content $p.FullPath -Raw).Trim()
    $logFile       = Join-Path $logDir "prompt-$($p.Index.ToString('D3'))-$($p.Label -replace '[^a-zA-Z0-9]', '-').log"

    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "$tag $($p.Label)" -ForegroundColor Green
    Write-Host "  File   : $($p.RelPath)" -ForegroundColor DarkYellow
    Write-Host "  Log    : $logFile"

    # Overall progress bar
    $overallPct = [math]::Round((($successCount + $failCount + $skipCount) / $total) * 100)
    Write-Progress -Activity "TeslaSync Violation Fix Runner" `
        -Status "$($p.Label) [$($successCount + $skipCount + $failCount + 1)/$total]" `
        -PercentComplete $overallPct
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan

    if ($DryRun) {
        Write-Host "  (dry run — skipped)" -ForegroundColor Yellow
        continue
    }

    # Build copilot arguments
    $copilotArgs = @(
        "-p", $promptContent,
        "--yolo",
        "--autopilot",
        "-s"
    )
    if ($Model) {
        $copilotArgs += @("--model", $Model)
    }

    # Run copilot as a background job with timeout
    $startTime = Get-Date
    Log "$tag START  $($p.Label)"

    $tempArgsFile = Join-Path $env:TEMP "teslasync-vfix-$($p.Index).json"
    $copilotArgs | ConvertTo-Json | Set-Content -Path $tempArgsFile -Encoding UTF8

    $job = Start-Job -ScriptBlock {
        param($wd, $argsFile)
        Set-Location $wd
        $cArgs = Get-Content $argsFile -Raw | ConvertFrom-Json
        & copilot @cArgs 2>&1
    } -ArgumentList $RepoRoot, $tempArgsFile

    # Wait with spinner
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

    # Cleanup stale processes
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
        $successCount++
        Log "$tag DONE in $mins min"
        Write-Host "  ✓ Completed in $mins min" -ForegroundColor Green

        Add-Content -Path $doneFile -Value $p.RelPath
        $doneSet.Add($p.RelPath) | Out-Null
    }

    if ($DelaySeconds -gt 0) {
        Write-Host "  Waiting $DelaySeconds seconds before next prompt..." -ForegroundColor DarkGray
        Start-Sleep -Seconds $DelaySeconds
    }
}

Write-Progress -Activity "TeslaSync Violation Fix Runner" -Completed

# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  FINISHED" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Succeeded : $successCount" -ForegroundColor Green
Write-Host "  Failed    : $failCount" -ForegroundColor $(if ($failCount -gt 0) { "Red" } else { "Green" })
Write-Host "  Skipped   : $skipCount" -ForegroundColor DarkGray
Write-Host "  Run log   : $runLog"
Write-Host "============================================" -ForegroundColor Cyan
