#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync — Runs Postgres resilience prompts in order (01–06).

.DESCRIPTION
  Convenience wrapper around run-prompts.ps1 for the postgres-resilience category.
  Prompts must be executed in order as each builds on the previous:

    01  DSN & Pool Hardening          — connect_timeout, statement_timeout, health check period
    02  Retry on Flush                — exponential backoff for signal flushes, re-queue on failure
    03  Circuit Breaker               — gobreaker for DB writes, /readyz write-health
    04  Health-Aware Degradation      — debounced flush loop, adaptive interval
    05  Telemetry Write Buffer        — in-memory bounded buffer for drive/charge telemetry
    06  Nginx DNS Resolver            — resolver + set $backend for startup resilience

.USAGE
  .\.github\prompts\features\postgres-resilience\run.ps1                    # Run all pending
  .\.github\prompts\features\postgres-resilience\run.ps1 -DryRun            # Preview only
  .\.github\prompts\features\postgres-resilience\run.ps1 -StartFrom 3       # Resume from prompt 03
  .\.github\prompts\features\postgres-resilience\run.ps1 -Single 02         # Run only prompt 02
  .\.github\prompts\features\postgres-resilience\run.ps1 -Model claude-sonnet-4
#>

param(
    [string]$RepoRoot      = "D:\repos\teslasync",
    [string]$Single        = "",              # Run one prompt by number: "01", "02", etc.
    [string]$Model         = "",
    [switch]$DryRun        = $false,
    [int]$StartFrom        = 1,
    [int]$DelaySeconds     = 10,
    [int]$TimeoutMinutes   = 30
)

$ErrorActionPreference = "Stop"

# If a single prompt number is given (e.g. "02"), convert to relative path
if ($Single) {
    $promptDir = Join-Path $RepoRoot ".github\prompts\features\postgres-resilience"
    $match = Get-ChildItem -Path $promptDir -Filter "$Single-*.prompt.md" | Select-Object -First 1
    if (-not $match) {
        Write-Host "ERROR: No prompt found matching '$Single-*' in postgres-resilience/" -ForegroundColor Red
        Write-Host "Available prompts:" -ForegroundColor Yellow
        Get-ChildItem -Path $promptDir -Filter "*.prompt.md" | ForEach-Object { Write-Host "  $($_.Name)" }
        exit 1
    }
    $singleRelPath = "postgres-resilience/$($match.Name)"
}

# Build arguments for the parent run-prompts.ps1
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
    $splatArgs["Category"] = "postgres-resilience"
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
Write-Host "  Postgres Resilience — Prompt Runner" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

& $runScript @splatArgs
