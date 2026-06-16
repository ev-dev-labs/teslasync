#requires -Version 7.0
<#
.SYNOPSIS
  Electron loops orchestrator — runs the four phases in dependency order:
  E0 Foundation → E1 Integration → E2 Desktop Parity → E5 Hardening.

  Each phase is driven to 100% (its ledger fully done/blocked) by electron-loop.ps1 before the
  next begins (Honesty Covenant rule 7 — no predecessor bypass). A phase that finishes with any
  blocked rows halts the chain unless -ContinueOnBlocked is set, so a broken foundation never
  silently cascades into later phases.

.EXAMPLE
  pwsh run-electron-loops.ps1                       # full run E0→E1→E2→E5
  pwsh run-electron-loops.ps1 -Phases e0,e1         # only the first two phases
  pwsh run-electron-loops.ps1 -CountOnly            # print every phase's unit count and exit
  pwsh run-electron-loops.ps1 -MaxUnitsPerPhase 3   # smoke test across phases
#>
param(
  [string[]]$Phases = @('e0', 'e1', 'e2', 'e5'),
  [int]$MaxUnitsPerPhase = 0,
  [string]$Model = '',
  [switch]$ContinueOnBlocked,
  [switch]$CountOnly,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$driver = Join-Path $PSScriptRoot 'electron-loop.ps1'
$ledgerDir = Join-Path $PSScriptRoot 'ledgers'

$ledgerName = @{ e0 = 'e0-foundation-ledger.json'; e1 = 'e1-integration-ledger.json';
  e2 = 'e2-desktop-parity-ledger.json'; e5 = 'e5-hardening-ledger.json' }

if ($CountOnly) {
  $grand = 0
  foreach ($p in $Phases) {
    & $driver -Phase $p -CountOnly
    $lp = Join-Path $ledgerDir $ledgerName[$p]  # no-op; CountOnly doesn't write
  }
  return
}

function Get-PhaseSummary([string]$phase) {
  $lp = Join-Path $ledgerDir $ledgerName[$phase]
  if (-not (Test-Path $lp)) { return @{ done = 0; blocked = 0; todo = 0; total = 0 } }
  $rows = @(Get-Content $lp -Raw | ConvertFrom-Json)
  @{
    done    = @($rows | Where-Object status -EQ 'done').Count
    blocked = @($rows | Where-Object status -EQ 'blocked').Count
    todo    = @($rows | Where-Object { $_.status -in @('todo', 'in_progress') }).Count
    total   = $rows.Count
  }
}

$overallStart = Get-Date
foreach ($phase in $Phases) {
  Write-Host "`n========== PHASE $($phase.ToUpper()) ==========" -ForegroundColor Magenta

  $args = @('-Phase', $phase)
  if ($MaxUnitsPerPhase -gt 0) { $args += @('-MaxUnits', $MaxUnitsPerPhase) }
  if ($Model) { $args += @('-Model', $Model) }
  if ($DryRun) { $args += '-DryRun' }

  & $driver @args

  $s = Get-PhaseSummary $phase
  Write-Host "[$phase] done=$($s.done) blocked=$($s.blocked) todo=$($s.todo) total=$($s.total)" -ForegroundColor Cyan

  if ($s.todo -gt 0 -and $MaxUnitsPerPhase -le 0) {
    Write-Host "[orchestrator] $phase still has $($s.todo) unfinished units — stopping the chain." -ForegroundColor Yellow
    break
  }
  if ($s.blocked -gt 0 -and -not $ContinueOnBlocked) {
    Write-Host "[orchestrator] $phase finished with $($s.blocked) blocked units — stopping (use -ContinueOnBlocked to override)." -ForegroundColor Red
    break
  }
}

Write-Host "`n========== SUMMARY ==========" -ForegroundColor Magenta
foreach ($phase in $Phases) {
  $s = Get-PhaseSummary $phase
  Write-Host ("  {0,-3} done={1,-4} blocked={2,-3} todo={3,-4} total={4}" -f $phase, $s.done, $s.blocked, $s.todo, $s.total)
}
Write-Host ("elapsed {0:n1} min" -f ((Get-Date) - $overallStart).TotalMinutes) -ForegroundColor DarkGray
