#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync — Runs signal audit prompts by category or individually.

.DESCRIPTION
  Audits Tesla Fleet Telemetry signal mappings end-to-end: ingestion → DB → API → UI.
  230 signals across 13 categories + 1 synthesis prompt.

  Categories:
    01-charging-numeric     41 signals   Charging floats & bools
    02-charging-enums       11 signals   Charging enum/time types
    03-powershare            5 signals   Powershare enums
    04-climate              29 signals   Climate floats, bools, enums
    05-driving              12 signals   Driving floats + Gear enum
    06-powertrain           36 signals   Motor/inverter/drivetrain
    07-location             13 signals   GPS, routes, compound types
    08-media                11 signals   Media playback signals
    09-safety               14 signals   Seatbelts, ADAS, locks
    10-tpms                 10 signals   Tire pressure signals
    11-vehicle-state        29 signals   Doors, windows, sentry, software
    12-vehicle-config       14 signals   Car type, trim, colors
    13-user-preferences      5 signals   Unit settings
    99-synthesis             1 prompt    Master traceability matrix

.USAGE
  # Run all signals in a specific category (recommended — do one category at a time)
  .\.github\prompts\features\signal-audit\run.ps1 -Category 09-safety

  # Run a single signal by name
  .\.github\prompts\features\signal-audit\run.ps1 -Signal DriverSeatBelt

  # Run all pending across all categories
  .\.github\prompts\features\signal-audit\run.ps1

  # Run only the synthesis (after all audits complete)
  .\.github\prompts\features\signal-audit\run.ps1 -Category 99-synthesis

  # Preview what will run
  .\.github\prompts\features\signal-audit\run.ps1 -Category 09-safety -DryRun

  # Use a specific model
  .\.github\prompts\features\signal-audit\run.ps1 -Category 09-safety -Model claude-sonnet-4
#>

param(
    [string]$RepoRoot      = "D:\repos\teslasync",
    [string]$Category      = "",              # Run a specific category folder (e.g. "09-safety")
    [string]$Signal        = "",              # Run a single signal by Tesla name (e.g. "DriverSeatBelt")
    [string]$Model         = "",
    [switch]$DryRun        = $false,
    [int]$StartFrom        = 1,
    [int]$DelaySeconds     = 5,
    [int]$TimeoutMinutes   = 15
)

$ErrorActionPreference = "Stop"

$auditRoot = Join-Path $RepoRoot ".github\prompts\features\signal-audit"

# If a signal name is given, find it across all category folders
if ($Signal) {
    $kebab = ($Signal -creplace '([A-Z])', '-$1').ToLower().TrimStart('-')
    $match = Get-ChildItem -Path $auditRoot -Filter "*$kebab*.prompt.md" -Recurse | Select-Object -First 1
    if (-not $match) {
        Write-Host "ERROR: No prompt found for signal '$Signal'" -ForegroundColor Red
        Write-Host "Searched for: *$kebab*.prompt.md" -ForegroundColor Yellow
        exit 1
    }
    $relPath = $match.FullName.Substring((Join-Path $RepoRoot ".github\prompts\features").Length + 1) -replace "\\", "/"
    Write-Host "Found: $relPath" -ForegroundColor Green
}

# Delegate to the parent run-prompts.ps1
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

if ($Signal) {
    $splatArgs["Single"] = $relPath
} elseif ($Category) {
    # Map short names to full category path
    $catPath = Join-Path $auditRoot $Category
    if (-not (Test-Path $catPath)) {
        Write-Host "ERROR: Category not found: $Category" -ForegroundColor Red
        Write-Host "Available categories:" -ForegroundColor Yellow
        Get-ChildItem $auditRoot -Directory | ForEach-Object {
            $count = (Get-ChildItem $_.FullName -Filter "*.prompt.md").Count
            Write-Host "  $($_.Name) ($count prompts)"
        }
        exit 1
    }
    $splatArgs["Category"] = "signal-audit\$Category"
    $splatArgs["StartFrom"] = $StartFrom
} else {
    $splatArgs["Category"] = "signal-audit"
    $splatArgs["StartFrom"] = $StartFrom
}

if ($Model) {
    $splatArgs["Model"] = $Model
}

if ($DryRun) {
    $splatArgs["DryRun"] = $true
}

# Summary
$totalPrompts = (Get-ChildItem -Path $auditRoot -Filter "*.prompt.md" -Recurse).Count
$catBreakdown = Get-ChildItem $auditRoot -Directory | ForEach-Object {
    $count = (Get-ChildItem $_.FullName -Filter "*.prompt.md").Count
    "$($_.Name): $count"
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Signal Audit — Tesla Fleet Telemetry Traceability" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  Total signals : $totalPrompts prompts"
Write-Host "  Category      : $(if ($Category) { $Category } elseif ($Signal) { $Signal } else { 'ALL' })"
Write-Host "----" -ForegroundColor DarkGray
$catBreakdown | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

& $runScript @splatArgs
