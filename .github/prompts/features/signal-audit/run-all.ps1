#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync — Runs ALL 231 signal audit prompts in risk-priority order, unattended.

.DESCRIPTION
  Executes every signal audit prompt sequentially, highest risk first.
  Tracks progress via done.txt — safe to stop and resume at any time.
  Shows a live dashboard table with per-category progress.

.USAGE
  .\.github\prompts\features\signal-audit\run-all.ps1                     # Run all pending
  .\.github\prompts\features\signal-audit\run-all.ps1 -DryRun             # Preview order
  .\.github\prompts\features\signal-audit\run-all.ps1 -Model claude-sonnet-4
#>

param(
    [string]$RepoRoot      = "D:\repos\teslasync",
    [string]$Model         = "",
    [switch]$DryRun        = $false,
    [int]$DelaySeconds     = 5,
    [int]$TimeoutMinutes   = 15
)

$ErrorActionPreference = "Stop"

# Execution order: highest risk first
$categoryOrder = @(
    "09-safety",            # 14 — seatbelt bug category, enums + bools
    "02-charging-enums",    # 11 — ChargeState, BMSState, etc.
    "11-vehicle-state",     # 29 — DoorState compound, windows, SentryMode
    "07-location",          # 13 — compound Location, RouteLine
    "03-powershare",        #  5 — all enums
    "13-user-preferences",  #  5 — unit setting enums
    "04-climate",           # 29 — ClimateKeeperMode, temps
    "05-driving",           # 12 — Gear enum + floats
    "10-tpms",              # 10 — TireLocation compound + pressure
    "12-vehicle-config",    # 14 — CarType, strings, bools
    "08-media",             # 11 — MediaPlaybackStatus enum
    "06-powertrain",        # 36 — mostly floats + DiState enums
    "01-charging-numeric",  # 41 — floats + bools
    "99-synthesis"          #  1 — master traceability matrix
)

$runScript = Join-Path $RepoRoot ".github\prompts\features\run-prompts.ps1"
$auditRoot = Join-Path $RepoRoot ".github\prompts\features\signal-audit"
$logDir    = Join-Path $RepoRoot ".github\prompts\features\logs"
$doneFile  = Join-Path $logDir "done.txt"

if (-not (Test-Path $runScript)) {
    Write-Host "ERROR: run-prompts.ps1 not found" -ForegroundColor Red
    exit 1
}

# Load done set
$doneSet = New-Object 'System.Collections.Generic.HashSet[string]'
if (Test-Path $doneFile) {
    Get-Content $doneFile | Where-Object { $_.Trim() -ne "" } | ForEach-Object { $doneSet.Add($_) | Out-Null }
}

# Phase metadata
$phaseMap = @{
    "09-safety"           = @{ Phase = 1; Risk = "HIGH"      }
    "02-charging-enums"   = @{ Phase = 1; Risk = "HIGH"      }
    "11-vehicle-state"    = @{ Phase = 1; Risk = "HIGH"      }
    "07-location"         = @{ Phase = 1; Risk = "HIGH"      }
    "03-powershare"       = @{ Phase = 1; Risk = "HIGH"      }
    "13-user-preferences" = @{ Phase = 1; Risk = "HIGH"      }
    "04-climate"          = @{ Phase = 2; Risk = "MEDIUM"    }
    "05-driving"          = @{ Phase = 2; Risk = "MEDIUM"    }
    "10-tpms"             = @{ Phase = 2; Risk = "MEDIUM"    }
    "12-vehicle-config"   = @{ Phase = 2; Risk = "MEDIUM"    }
    "08-media"            = @{ Phase = 2; Risk = "MEDIUM"    }
    "06-powertrain"       = @{ Phase = 3; Risk = "LOW"       }
    "01-charging-numeric" = @{ Phase = 3; Risk = "LOW"       }
    "99-synthesis"        = @{ Phase = 4; Risk = "SYNTH"     }
}

# Category display names
$catNames = @{
    "09-safety"           = "Safety & Seatbelts"
    "02-charging-enums"   = "Charging Enums"
    "11-vehicle-state"    = "Vehicle State"
    "07-location"         = "Location & GPS"
    "03-powershare"       = "Powershare"
    "13-user-preferences" = "User Preferences"
    "04-climate"          = "Climate & HVAC"
    "05-driving"          = "Driving & Motion"
    "10-tpms"             = "Tire Pressure"
    "12-vehicle-config"   = "Vehicle Config"
    "08-media"            = "Media & Audio"
    "06-powertrain"       = "Powertrain & Motors"
    "01-charging-numeric" = "Charging Numeric"
    "99-synthesis"        = "Final Matrix"
}

# ---------------------------------------------------------------------------
# Build category stats
# ---------------------------------------------------------------------------
$catStats = [ordered]@{}
$totalPrompts = 0
$totalDone = 0

foreach ($cat in $categoryOrder) {
    $catDir = Join-Path $auditRoot $cat
    $prompts = if (Test-Path $catDir) { Get-ChildItem $catDir -Filter "*.prompt.md" } else { @() }
    $total = $prompts.Count
    $done = 0
    foreach ($p in $prompts) {
        $rel = "signal-audit/$cat/$($p.Name)" -replace "\\", "/"
        # Check both possible done-file formats
        $relAlt = $p.FullName.Substring((Join-Path $RepoRoot ".github\prompts\features").Length + 1) -replace "\\", "/"
        if ($doneSet.Contains($rel) -or $doneSet.Contains($relAlt)) { $done++ }
    }
    $catStats[$cat] = @{ Total = $total; Done = $done }
    $totalPrompts += $total
    $totalDone += $done
}

# ---------------------------------------------------------------------------
# Display dashboard table (in-place update using cursor positioning)
# ---------------------------------------------------------------------------

# Total lines the dashboard occupies (header:3 + progress:1 + table header:2 + rows:14 + footer:5 = 25)
$dashboardDrawn = $false
$dashboardTop = 0

function Show-Dashboard {
    param([string]$ActiveCat = "", [string]$ActivePrompt = "", [string]$ElapsedStr = "")

    # Move cursor to saved top position if already drawn
    if ($dashboardDrawn) {
        $newTop = [math]::Max(0, $dashboardTop)
        [Console]::SetCursorPosition(0, $newTop)
    } else {
        $script:dashboardTop = [Console]::CursorTop
    }

    $totalPending = $totalPrompts - $totalDone
    $pct = if ($totalPrompts -gt 0) { [math]::Round(($totalDone / $totalPrompts) * 100) } else { 0 }

    # Progress bar
    $barWidth = 40
    $filled = [math]::Floor($pct / 100 * $barWidth)
    $empty  = $barWidth - $filled
    $bar = ("█" * $filled) + ("░" * $empty)

    # Header
    Write-Host "  ╔════════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "  ║              Tesla Signal Audit — Traceability Dashboard              ║" -ForegroundColor Cyan
    Write-Host "  ╠════════════════════════════════════════════════════════════════════════╣" -ForegroundColor Cyan
    $progressLine = "  Progress: [$bar] $pct%  ($totalDone/$totalPrompts)"
    Write-Host "  ║  $($progressLine.PadRight(68))  ║" -ForegroundColor Cyan
    Write-Host "  ╠════╤══════════════════════╤════════╤═══════╤════════╤═════════════════╣" -ForegroundColor Cyan
    Write-Host "  ║  # │ Category             │ Risk   │ Total │  Done  │ Status          ║" -ForegroundColor Cyan

    # Rows
    $idx = 0
    foreach ($cat in $categoryOrder) {
        $idx++
        $s = $catStats[$cat]
        $meta = $phaseMap[$cat]
        $name = $catNames[$cat]
        $risk = $meta.Risk

        $isActive = ($cat -eq $ActiveCat)
        if ($s.Done -eq $s.Total -and $s.Total -gt 0) {
            $status = "Done"; $statusColor = "Green"; $statusIcon = "+"
        } elseif ($isActive) {
            $status = "Running..."; $statusColor = "Yellow"; $statusIcon = ">"
        } elseif ($s.Done -gt 0) {
            $status = "Partial"; $statusColor = "DarkYellow"; $statusIcon = "~"
        } else {
            $status = "Pending"; $statusColor = "DarkGray"; $statusIcon = "-"
        }

        $riskColor = switch ($risk) {
            "HIGH"   { "Red" }
            "MEDIUM" { "Yellow" }
            "LOW"    { "Green" }
            "SYNTH"  { "Magenta" }
        }

        $numStr   = $idx.ToString().PadLeft(2)
        $nameStr  = $name.PadRight(20)
        $riskStr  = $risk.PadRight(6)
        $totalStr = $s.Total.ToString().PadLeft(3)
        $doneStr  = "$($s.Done)/$($s.Total)".PadLeft(6)
        $statStr  = "$statusIcon $status".PadRight(15)

        Write-Host -NoNewline "  ║ " -ForegroundColor Cyan
        Write-Host -NoNewline "$numStr" -ForegroundColor $(if ($isActive) { "White" } else { "DarkGray" })
        Write-Host -NoNewline " │ " -ForegroundColor Cyan
        Write-Host -NoNewline "$nameStr" -ForegroundColor $(if ($isActive) { "White" } else { "Gray" })
        Write-Host -NoNewline " │ " -ForegroundColor Cyan
        Write-Host -NoNewline "$riskStr" -ForegroundColor $riskColor
        Write-Host -NoNewline " │ " -ForegroundColor Cyan
        Write-Host -NoNewline "$totalStr" -ForegroundColor Gray
        Write-Host -NoNewline "   │ " -ForegroundColor Cyan
        Write-Host -NoNewline "$doneStr" -ForegroundColor $(if ($s.Done -eq $s.Total -and $s.Total -gt 0) { "Green" } else { "Gray" })
        Write-Host -NoNewline " │ " -ForegroundColor Cyan
        Write-Host -NoNewline "$statStr" -ForegroundColor $statusColor
        Write-Host " ║" -ForegroundColor Cyan
    }

    # Footer
    Write-Host "  ╠════╧══════════════════════╧════════╧═══════╧════════╧═════════════════╣" -ForegroundColor Cyan
    $summaryLine = "  Done: $totalDone  |  Pending: $totalPending  |  Total: $totalPrompts"
    Write-Host "  ║  $($summaryLine.PadRight(68))  ║" -ForegroundColor Cyan

    # Current prompt line
    if ($ActivePrompt) {
        $activeLine = "  Now: $ActivePrompt"
    } else {
        $activeLine = "  Waiting..."
    }
    if ($activeLine.Length -gt 70) { $activeLine = $activeLine.Substring(0, 67) + "..." }
    Write-Host "  ║  $($activeLine.PadRight(68))  ║" -ForegroundColor $(if ($ActivePrompt) { "Yellow" } else { "DarkGray" })

    # Elapsed time line
    if ($ElapsedStr) {
        $elapsedLine = "  Elapsed: $ElapsedStr"
    } else {
        $elapsedLine = ""
    }
    Write-Host "  ║  $($elapsedLine.PadRight(68))  ║" -ForegroundColor DarkGray

    Write-Host "  ╚════════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

    $script:dashboardDrawn = $true
}

# ---------------------------------------------------------------------------
# Show initial dashboard
# ---------------------------------------------------------------------------
Write-Host ""
Show-Dashboard

if ($DryRun) {
    Write-Host ""
    Write-Host "  DRY RUN — no prompts will be executed. Remove -DryRun to start." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "  Starting in 5 seconds... (Ctrl+C to abort)" -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Clear screen and redraw for clean in-place updates
Clear-Host
$dashboardDrawn = $false
Show-Dashboard

# ---------------------------------------------------------------------------
# Execute categories in order
# ---------------------------------------------------------------------------
$catIndex = 0
$startTime = Get-Date
$failedCats = @()

# Helper: refresh done counts from done.txt
function Refresh-DoneCounts {
    $doneSet = New-Object 'System.Collections.Generic.HashSet[string]'
    if (Test-Path $doneFile) {
        Get-Content $doneFile | Where-Object { $_.Trim() -ne "" } | ForEach-Object { $doneSet.Add($_) | Out-Null }
    }
    $script:totalDone = 0
    foreach ($c in $categoryOrder) {
        $cDir = Join-Path $auditRoot $c
        $cPrompts = if (Test-Path $cDir) { Get-ChildItem $cDir -Filter "*.prompt.md" } else { @() }
        $d = 0
        foreach ($p in $cPrompts) {
            $rel = $p.FullName.Substring((Join-Path $RepoRoot ".github\prompts\features").Length + 1) -replace "\\", "/"
            if ($doneSet.Contains($rel)) { $d++ }
        }
        $catStats[$c].Done = $d
        $script:totalDone += $d
    }
}

# Helper: read current prompt from status file
$statusFile = Join-Path $logDir "current-prompt.txt"

function Get-CurrentPrompt {
    if (Test-Path $statusFile) {
        $raw = (Get-Content $statusFile -Raw -ErrorAction SilentlyContinue)
        if ($raw) {
            return ($raw.Trim() -split '/')[-1] -replace '\.prompt\.md$', ''
        }
    }
    return ""
}

foreach ($cat in $categoryOrder) {
    $catIndex++
    $s = $catStats[$cat]

    # Skip fully completed categories
    if ($s.Done -eq $s.Total -and $s.Total -gt 0) {
        continue
    }

    # Update dashboard: this category is now active
    $elapsed = (Get-Date) - $startTime
    $elStr = "{0}h {1}m" -f [math]::Floor($elapsed.TotalHours), ([math]::Floor($elapsed.TotalMinutes) % 60)
    Show-Dashboard -ActiveCat $cat -ActivePrompt "Starting $($catNames[$cat])..." -ElapsedStr $elStr

    $splatArgs = @{
        RepoRoot       = $RepoRoot
        Category       = "signal-audit\$cat"
        DelaySeconds   = $DelaySeconds
        TimeoutMinutes = $TimeoutMinutes
    }

    if ($Model) {
        $splatArgs["Model"] = $Model
    }

    # Run as a background job so we can update the dashboard in-place
    $catJob = Start-Job -ScriptBlock {
        param($wd, $script, $args_)
        Set-Location $wd
        & $script @args_
    } -ArgumentList $RepoRoot, $runScript, $splatArgs

    # Poll loop: refresh dashboard every 5 seconds with current prompt + done counts
    while ($catJob.State -eq "Running") {
        Start-Sleep -Seconds 5

        # Refresh done counts (picks up prompts completed by run-prompts.ps1)
        Refresh-DoneCounts

        # Get current prompt name
        $currentPrompt = Get-CurrentPrompt

        # Elapsed time
        $elapsed = (Get-Date) - $startTime
        $elStr = "{0}h {1}m {2}s" -f [math]::Floor($elapsed.TotalHours), ([math]::Floor($elapsed.TotalMinutes) % 60), ([math]::Floor($elapsed.TotalSeconds) % 60)

        # Redraw dashboard in-place
        Show-Dashboard -ActiveCat $cat -ActivePrompt $currentPrompt -ElapsedStr $elStr
    }

    # Collect job output (don't display — it would break the dashboard)
    $jobOutput = Receive-Job $catJob -ErrorAction SilentlyContinue
    $jobFailed = $catJob.State -ne "Completed"
    Remove-Job $catJob -Force -ErrorAction SilentlyContinue

    if ($jobFailed) {
        $failedCats += $cat
    }

    # Final refresh after category completes
    Refresh-DoneCounts

    $elapsed = (Get-Date) - $startTime
    $elStr = "{0}h {1}m {2}s" -f [math]::Floor($elapsed.TotalHours), ([math]::Floor($elapsed.TotalMinutes) % 60), ([math]::Floor($elapsed.TotalSeconds) % 60)
    Show-Dashboard -ActivePrompt "Completed $($catNames[$cat])" -ElapsedStr $elStr

    # Brief pause between categories
    if ($catIndex -lt $categoryOrder.Count) {
        Start-Sleep -Seconds 5
    }
}

# ---------------------------------------------------------------------------
# Final dashboard
# ---------------------------------------------------------------------------
Refresh-DoneCounts

$elapsed = (Get-Date) - $startTime
$hrs  = [math]::Floor($elapsed.TotalHours)
$mins = [math]::Floor($elapsed.TotalMinutes) % 60
$secs = [math]::Floor($elapsed.TotalSeconds) % 60
$elStr = "${hrs}h ${mins}m ${secs}s"

# Final in-place update
$completionMsg = if ($failedCats.Count -eq 0) { "ALL COMPLETE" } else { "COMPLETE (with failures)" }
Show-Dashboard -ActivePrompt $completionMsg -ElapsedStr $elStr

# Print summary below the dashboard
Write-Host ""
if ($failedCats.Count -gt 0) {
    Write-Host "  Failed categories: $($failedCats -join ', ')" -ForegroundColor Red
} else {
    Write-Host "  All $totalPrompts signals audited successfully!" -ForegroundColor Green
}
Write-Host "  Total time: $elStr" -ForegroundColor DarkGray
Write-Host ""
