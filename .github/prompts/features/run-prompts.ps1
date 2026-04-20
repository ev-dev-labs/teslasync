#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync — Runs feature prompts sequentially, each in a fresh Copilot session.

.DESCRIPTION
  Discovers .prompt.md files under .github/prompts/features/ sub-folders (commands,
  tesla-api, automations, etc.) and runs them via `copilot -p "..." --yolo --autopilot`.
  Tracks which prompts are done. Logs every session output.

.USAGE
  .\.github\prompts\features\run-prompts.ps1                              # Run ALL pending
  .\.github\prompts\features\run-prompts.ps1 -Category commands           # Only commands/
  .\.github\prompts\features\run-prompts.ps1 -Category tesla-api          # Only tesla-api/
  .\.github\prompts\features\run-prompts.ps1 -Category automations        # Only automations/
  .\.github\prompts\features\run-prompts.ps1 -DryRun                      # Preview without executing
  .\.github\prompts\features\run-prompts.ps1 -StartFrom 5                 # Resume from prompt #5
  .\.github\prompts\features\run-prompts.ps1 -Model "claude-sonnet-4"     # Use a specific model
  .\.github\prompts\features\run-prompts.ps1 -Single "commands/feat-cmd-media-controls.prompt.md"
#>

param(
    [string]$RepoRoot     = "D:\repos\teslasync",
    [string]$Category     = "",              # Filter: "commands", "tesla-api", "automations", or "" for all
    [string]$Single       = "",              # Run a single prompt by relative path (e.g. "commands/feat-cmd-boombox.prompt.md")
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
$featuresRoot = Join-Path $RepoRoot ".github\prompts\features"

if ($Single) {
    $singlePath = Join-Path $featuresRoot $Single
    if (-not (Test-Path $singlePath)) {
        Write-Host "ERROR: Prompt not found: $singlePath" -ForegroundColor Red
        exit 1
    }
    $files = @(Get-Item $singlePath)
}
else {
    if ($Category) {
        $catDir = Join-Path $featuresRoot $Category
        if (-not (Test-Path $catDir)) {
            Write-Host "ERROR: Category directory not found: $catDir" -ForegroundColor Red
            Write-Host "Available categories:" -ForegroundColor Yellow
            Get-ChildItem $featuresRoot -Directory | ForEach-Object { Write-Host "  - $($_.Name)" }
            exit 1
        }
        $files = Get-ChildItem -Path $catDir -Filter "*.prompt.md" -Recurse | Sort-Object FullName
    }
    else {
        # All categories
        $files = Get-ChildItem -Path $featuresRoot -Filter "*.prompt.md" -Recurse | Sort-Object FullName
    }
}

if ($files.Count -eq 0) {
    Write-Host "ERROR: No .prompt.md files found." -ForegroundColor Red
    exit 1
}

# Build ordered prompt list
$prompts = @()
$index = 0
foreach ($file in $files) {
    $index++
    $relPath  = $file.FullName.Substring($featuresRoot.Length + 1) -replace "\\", "/"
    $category = ($relPath -split "/")[0]
    $label    = $file.BaseName -replace "\.prompt$", ""

    $prompts += [PSCustomObject]@{
        Index    = $index
        Category = $category
        Label    = "$category/$label"
        RelPath  = $relPath
        FullPath = $file.FullName
    }
}

$total = $prompts.Count

# ---------------------------------------------------------------------------
# Setup logging
# ---------------------------------------------------------------------------
$logDir = Join-Path $featuresRoot "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

# Done-tracking file — persists across runs
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

# Discord webhook notification (optional — set TESLASYNC_DISCORD_WEBHOOK env var)
$discordWebhook = $env:TESLASYNC_DISCORD_WEBHOOK
function Discord([string]$msg, [string]$color = "3447003") {
    if (-not $discordWebhook) { return }
    try {
        $body = @{
            embeds = @(@{
                description = $msg
                color = [int]$color
                timestamp = (Get-Date).ToUniversalTime().ToString("o")
                footer = @{ text = "TeslaSync Prompt Runner" }
            })
        } | ConvertTo-Json -Depth 5
        Invoke-RestMethod -Uri $discordWebhook -Method Post -ContentType "application/json" -Body $body -ErrorAction SilentlyContinue | Out-Null
    } catch {
        # Silently ignore webhook failures — don't break the runner
    }
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
$doneCount    = ($prompts | Where-Object { $doneSet.Contains($_.RelPath) }).Count
$pendingCount = $total - $doneCount

# Category breakdown
$categories = $prompts | Group-Object Category | ForEach-Object {
    $catDone = ($_.Group | Where-Object { $doneSet.Contains($_.RelPath) }).Count
    "$($_.Name): $($_.Count) total, $catDone done"
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  TeslaSync — Feature Prompt Runner" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Features root : $featuresRoot"
Write-Host "  Category      : $(if ($Category) { $Category } else { 'all' })"
Write-Host "  Total prompts : $total"
Write-Host "  Already done  : $doneCount" -ForegroundColor DarkGray
Write-Host "  Pending       : $pendingCount" -ForegroundColor Green
Write-Host "  Starting from : #$StartFrom"
Write-Host "  Model         : $(if ($Model) { $Model } else { '(default)' })"
Write-Host "  Timeout       : $TimeoutMinutes min per prompt"
Write-Host "  Dry run       : $DryRun"
Write-Host "  Run log       : $runLog"
Write-Host "--------------------------------------------" -ForegroundColor DarkGray
$categories | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# List all prompts with status
foreach ($p in $prompts) {
    $status = if ($doneSet.Contains($p.RelPath)) { "DONE" } else { "PEND" }
    $color  = if ($status -eq "DONE") { "DarkGray" } else { "White" }
    Write-Host "  [$($p.Index.ToString('D2'))] $status  $($p.Label)" -ForegroundColor $color
}
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

    # Read prompt content
    $promptContent = (Get-Content $p.FullPath -Raw).Trim()
    $logFile       = Join-Path $logDir "$($p.Category)-$($p.Index.ToString('D2'))-$($p.Label -replace '[^a-zA-Z0-9\-]', '-').log"

    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "$tag $($p.Label)" -ForegroundColor Green
    Write-Host "  File   : $($p.RelPath)" -ForegroundColor DarkYellow
    Write-Host "  Log    : $logFile"

    # Progress bar
    $overallPct = [math]::Round((($successCount + $failCount + $skipCount) / $total) * 100)
    Write-Progress -Activity "Feature Prompt Runner" `
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
    Discord "▶️ **Starting** ``$($p.Label)`` [$($p.Index)/$total]" "3447003"

    $tempArgsFile = Join-Path $env:TEMP "teslasync-feat-$($p.Index).json"
    $copilotArgs | ConvertTo-Json | Set-Content -Path $tempArgsFile -Encoding UTF8

    $job = Start-Job -ScriptBlock {
        param($wd, $argsFile)
        Set-Location $wd
        $cArgs = Get-Content $argsFile -Raw | ConvertFrom-Json
        & copilot @cArgs 2>&1
    } -ArgumentList $RepoRoot, $tempArgsFile

    # Wait for completion with timeout
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

    # Write output to log file
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
        Discord "❌ **Failed** ``$($p.Label)`` after ${mins}m (exit $exitCode)" "15158332"
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
        Discord "✅ **Completed** ``$($p.Label)`` in ${mins}m [$successCount done]" "3066993"
        Write-Host "  ✓ Completed in $mins min" -ForegroundColor Green

        # Mark as done
        Add-Content -Path $doneFile -Value $p.RelPath
        $doneSet.Add($p.RelPath) | Out-Null
    }

    # Pause between prompts
    if ($DelaySeconds -gt 0) {
        Write-Host "  Waiting $DelaySeconds seconds before next prompt..." -ForegroundColor DarkGray
        Start-Sleep -Seconds $DelaySeconds
    }
}

# Close progress bar
Write-Progress -Activity "Feature Prompt Runner" -Completed

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

$summaryColor = if ($failCount -eq 0) { "3066993" } else { "15158332" }
Discord "🏁 **Run Complete** — ✅ $successCount succeeded, ❌ $failCount failed, ⏭️ $skipCount skipped" $summaryColor
