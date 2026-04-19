#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync — Runs smart home integration prompts.

.DESCRIPTION
  Smart home integration prompts (execute in order):
    01  HA MQTT Auto-Discovery    — Auto-create HA entities from MQTT discovery configs
    02  MQTT Command Subscription — Bidirectional MQTT: receive + execute commands from HA
    03  REST Webhooks             — Outbound HTTP event notifications to external systems

.USAGE
  .\.github\prompts\features\smart-home\run.ps1                    # Run all pending
  .\.github\prompts\features\smart-home\run.ps1 -DryRun            # Preview only
  .\.github\prompts\features\smart-home\run.ps1 -Single 02         # Run only prompt 02
  .\.github\prompts\features\smart-home\run.ps1 -Model claude-sonnet-4
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
    $promptDir = Join-Path $RepoRoot ".github\prompts\features\smart-home"
    $match = Get-ChildItem -Path $promptDir -Filter "$Single-*.prompt.md" | Select-Object -First 1
    if (-not $match) {
        Write-Host "ERROR: No prompt found matching '$Single-*' in smart-home/" -ForegroundColor Red
        Write-Host "Available prompts:" -ForegroundColor Yellow
        Get-ChildItem -Path $promptDir -Filter "*.prompt.md" | ForEach-Object { Write-Host "  $($_.Name)" }
        exit 1
    }
    $singleRelPath = "smart-home/$($match.Name)"
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
    $splatArgs["Category"] = "smart-home"
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
Write-Host "  Smart Home Integrations — Prompt Runner" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

& $runScript @splatArgs
