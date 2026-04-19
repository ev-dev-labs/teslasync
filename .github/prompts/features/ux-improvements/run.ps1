#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync — Runs UX improvement prompts in order (01–10).

.DESCRIPTION
  Convenience wrapper around run-prompts.ps1 for the ux-improvements category.

    01  Replace Browser Dialogs       — Modal components for PIN, temp, confirmations
    02  Command Palette Commands      — Add vehicle commands to Cmd+K palette
    03  Command History Page          — Timeline view of command audit log
    04  Mobile Bottom Tab Bar         — 5-tab nav for mobile screens
    05  Chart Export PNG              — Download button on ChartContainer
    06  Trip Cost Calculator          — Cost/kWh and gas savings on drive detail
    07  Signal Freshness              — "Last updated" indicators on dashboard values
    08  Quick Glance Widget           — Minimal /glance page for quick battery/lock check
    09  Web Push Notifications        — Browser notifications for charge/drive/alert events
    10  Vehicle Comparison            — Side-by-side fleet analytics dashboard

.USAGE
  .\.github\prompts\features\ux-improvements\run.ps1                    # Run all pending
  .\.github\prompts\features\ux-improvements\run.ps1 -DryRun            # Preview only
  .\.github\prompts\features\ux-improvements\run.ps1 -StartFrom 5       # Resume from prompt 05
  .\.github\prompts\features\ux-improvements\run.ps1 -Single 03         # Run only prompt 03
  .\.github\prompts\features\ux-improvements\run.ps1 -Model claude-sonnet-4
#>

param(
    [string]$RepoRoot      = "D:\repos\teslasync",
    [string]$Single        = "",
    [string]$Model         = "",
    [switch]$DryRun        = $false,
    [int]$StartFrom        = 1,
    [int]$DelaySeconds     = 10,
    [int]$TimeoutMinutes   = 30
)

$ErrorActionPreference = "Stop"

if ($Single) {
    $promptDir = Join-Path $RepoRoot ".github\prompts\features\ux-improvements"
    $match = Get-ChildItem -Path $promptDir -Filter "$Single-*.prompt.md" | Select-Object -First 1
    if (-not $match) {
        Write-Host "ERROR: No prompt found matching '$Single-*' in ux-improvements/" -ForegroundColor Red
        Write-Host "Available prompts:" -ForegroundColor Yellow
        Get-ChildItem -Path $promptDir -Filter "*.prompt.md" | ForEach-Object { Write-Host "  $($_.Name)" }
        exit 1
    }
    $singleRelPath = "ux-improvements/$($match.Name)"
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
    $splatArgs["Category"] = "ux-improvements"
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
Write-Host "  UX Improvements — Prompt Runner" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

& $runScript @splatArgs
