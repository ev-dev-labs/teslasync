#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync — Runs new feature prompts.

.DESCRIPTION
  New feature prompts:
    01  Vehicle Digital Twin       — 2D interactive car visual with real-time state
    02  Custom Dashboard Builder   — Drag-and-drop widget layout with presets
    03  API Playground             — In-app interactive API explorer with live testing

.USAGE
  .\.github\prompts\features\new-features\run.ps1                    # Run all pending
  .\.github\prompts\features\new-features\run.ps1 -DryRun            # Preview only
  .\.github\prompts\features\new-features\run.ps1 -Single 01         # Run only prompt 01
  .\.github\prompts\features\new-features\run.ps1 -Model claude-sonnet-4
#>

param(
    [string]$RepoRoot      = "D:\repos\teslasync",
    [string]$Single        = "",
    [string]$Model         = "",
    [switch]$DryRun        = $false,
    [int]$StartFrom        = 1,
    [int]$DelaySeconds     = 10,
    [int]$TimeoutMinutes   = 60
)

$ErrorActionPreference = "Stop"

if ($Single) {
    $promptDir = Join-Path $RepoRoot ".github\prompts\features\new-features"
    $match = Get-ChildItem -Path $promptDir -Filter "$Single-*.prompt.md" | Select-Object -First 1
    if (-not $match) {
        Write-Host "ERROR: No prompt found matching '$Single-*' in new-features/" -ForegroundColor Red
        Write-Host "Available prompts:" -ForegroundColor Yellow
        Get-ChildItem -Path $promptDir -Filter "*.prompt.md" | ForEach-Object { Write-Host "  $($_.Name)" }
        exit 1
    }
    $singleRelPath = "new-features/$($match.Name)"
}

$runScript = Join-Path $RepoRoot ".github\prompts\features\run-prompts.ps1"
if (-not (Test-Path $runScript)) {
    Write-Host "ERROR: run-prompts.ps1 not found at $runScript" -ForegroundColor Red
    exit 1
}

$splatArgs = @{
    RepoRoot       = $RepoRoot
    DelaySeconds   = $DelaySeconds
    TimeoutMinutes = $TimeoutMinutes
}

if ($Single) {
    $splatArgs["Single"] = $singleRelPath
} else {
    $splatArgs["Category"] = "new-features"
    $splatArgs["StartFrom"] = $StartFrom
}

if ($Model) {
    $splatArgs["Model"] = $Model
}

if ($DryRun) {
    $splatArgs["DryRun"] = $true
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  New Features — Prompt Runner" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

& $runScript @splatArgs
