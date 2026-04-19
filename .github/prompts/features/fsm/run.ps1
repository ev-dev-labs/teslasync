#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync — Runs FSM feature prompts.

.DESCRIPTION
  Convenience wrapper for FSM prompts:
    01  Software Update FSM      — OTA update lifecycle (available → installed/failed)
    02  Telemetry Connection FSM — Streaming health per vehicle (streaming → stale → disconnected)

.USAGE
  .\.github\prompts\features\fsm\run.ps1                    # Run all pending
  .\.github\prompts\features\fsm\run.ps1 -DryRun            # Preview only
  .\.github\prompts\features\fsm\run.ps1 -Single 01         # Run only prompt 01
  .\.github\prompts\features\fsm\run.ps1 -Model claude-sonnet-4
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
    $promptDir = Join-Path $RepoRoot ".github\prompts\features\fsm"
    $match = Get-ChildItem -Path $promptDir -Filter "$Single-*.prompt.md" | Select-Object -First 1
    if (-not $match) {
        Write-Host "ERROR: No prompt found matching '$Single-*' in fsm/" -ForegroundColor Red
        Write-Host "Available prompts:" -ForegroundColor Yellow
        Get-ChildItem -Path $promptDir -Filter "*.prompt.md" | ForEach-Object { Write-Host "  $($_.Name)" }
        exit 1
    }
    $singleRelPath = "fsm/$($match.Name)"
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
    $splatArgs["Category"] = "fsm"
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
Write-Host "  FSM Features — Prompt Runner" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

& $runScript @splatArgs
