#requires -Version 7.0
<#
.SYNOPSIS
  Windows parity LOOP driver v2 (loop-engineering pattern, with a real parity gate).

  Why v2: builds/tests cannot see pixels, so the previous loop could go "green" on a
  divergent UI. v2 adds a visual + structural + component-inventory gate. Each unit gets
  a FRESH `copilot -p` agent (no context-limit), which implements the unit, captures a
  screenshot, compares it to the LIVE web app (http://localhost:3000), scores it, and
  records the result. The driver refuses to accept "done" unless a real screenshot exists
  and the visual score clears the threshold — so completion cannot be faked.

  Memory  = apps/parity/windows-ledger.json
  Spec    = apps/parity/parity-manifest.json  +  apps/parity/parity-chrome-units.json
  Worker  = copilot -p ... --allow-all-tools  (one unit per run)
  Verify  = ADR-010 gates + screenshot vs live web (visualScore) + bidirectional inventory

.EXAMPLE
  pwsh windows-parity-loop.ps1                       # run until truly complete
  pwsh windows-parity-loop.ps1 -MaxUnits 5           # smoke test
  pwsh windows-parity-loop.ps1 -Audit                # reopen done rows for re-verification
  New-Item apps/parity/STOP-windows-loop             # graceful stop
#>
param(
  [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
  [int]$MaxUnits = 0,
  [int]$MaxAttempts = 3,
  [int]$VisualThreshold = 95,
  [int]$MaxConsecutiveBlocked = 5,
  [string]$WebUrl = 'http://localhost:3000',
  [string]$Model = '',
  [switch]$Audit,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

$manifestPath = Join-Path $Repo 'apps\parity\parity-manifest.json'
$chromePath   = Join-Path $Repo 'apps\parity\parity-chrome-units.json'
$ledgerPath   = Join-Path $Repo 'apps\parity\windows-ledger.json'
$stopFile     = Join-Path $Repo 'apps\parity\STOP-windows-loop'
$logDir       = Join-Path $Repo 'apps\windows\.loop-logs'
$shotDir      = Join-Path $logDir 'shots'
$captureScript= Join-Path $PSScriptRoot 'capture-window.ps1'

New-Item -ItemType Directory -Force -Path $shotDir | Out-Null
if (-not (Test-Path $ledgerPath)) { '[]' | Set-Content -Encoding UTF8 $ledgerPath }

# ---- Combined spec: chrome/theme/layout units FIRST, then the manifest.
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$chrome   = if (Test-Path $chromePath) { Get-Content $chromePath -Raw | ConvertFrom-Json } else { @() }
function Rank($u) {
  if ($u.id -match '^component:(shell|theme)/' -or $u.id -match 'LayoutSystem|DigitalTwin3D') { 0 }
  elseif (("$($u.id) $($u.sourceFiles -join ' ')") -match '(?i)dashboard|widget') { 1 }
  else { 2 }
}
$i = 0
$ordered = @($chrome) + @($manifest) | ForEach-Object {
  [pscustomobject]@{ Unit = $_; Rank = (Rank $_); Idx = $i++ }
} | Sort-Object Rank, Idx | ForEach-Object { $_.Unit }
$total = $ordered.Count

function Read-Ledger {
  $j = Get-Content $ledgerPath -Raw | ConvertFrom-Json
  if ($null -eq $j) { return }
  $j
}
function Save-Ledger($rows) { @($rows) | ConvertTo-Json -Depth 10 -AsArray | Set-Content -Encoding UTF8 $ledgerPath }

function Get-Row($rows, $id) { $rows | Where-Object unitId -eq $id | Select-Object -First 1 }

function Set-Row($id, [hashtable]$fields) {
  $rows = @(Read-Ledger)
  $row = Get-Row $rows $id
  if (-not $row) {
    $row = [pscustomobject]@{ unitId=$id; platform='windows'; status='todo'; coveredCount=0;
      requiredCount=0; visualScore=0; shotPath=''; deltas=@(); attempts=0;
      promptId='windows-parity-loop'; evidenceLog='' }
    $rows += $row
  }
  foreach ($k in $fields.Keys) {
    if ($row.PSObject.Properties.Name -contains $k) { $row.$k = $fields[$k] }
    else { $row | Add-Member -NotePropertyName $k -NotePropertyValue $fields[$k] -Force }
  }
  Save-Ledger $rows
  $row
}

# ---- Audit: reopen previously-"done" rows so they are re-verified against the v2 gate.
if ($Audit) {
  $rows = @(Read-Ledger)
  $n = 0
  foreach ($r in $rows) {
    if ($r.status -eq 'done' -and ($r.visualScore -lt $VisualThreshold -or -not $r.shotPath -or -not (Test-Path (Join-Path $Repo $r.shotPath)))) {
      $r.status = 'todo'; $n++
    }
  }
  Save-Ledger $rows
  Write-Host "[audit] reopened $n unverifiable 'done' rows." -Foreground Yellow
}

function Build-UnitPrompt($u, $log, $shot) {
  $unitJson = $u | ConvertTo-Json -Depth 10
  $route = if ($u.route) { $u.route } else { '(find the matching route in web/src)' }
@"
Implement EXACTLY ONE Windows-native parity unit to FULL parity, then stop.

Repo: $Repo   Native target: apps/windows/TeslaSync.App (WinUI 3 / .NET 10)
Reference (ALWAYS RUNNING): $WebUrl  — open route '$route' and match it exactly.
Canonical source: web/src. Design tokens: apps/design/generated/windows/Tokens.xaml.

UNIT:
$unitJson

DONE means ALL FOUR dimensions match the live web route:
 A. Visual  - light/card look, token colors (no hardcoded), typography scale, 8pt spacing,
              ~12px radius, soft shadow, same grid; no dark/clunky drift.
 B. Structure/IA - nav generated from the same route registry as web (exact Favorites+Pages
              tree, counts, search, logo); same toolbar/status bar/command palette/FAB.
 C. Inventory (bidirectional) - implement EVERY child component the web renders AND remove
              native-only extras the web lacks; Digital Twin = real 3D car, not a wireframe.
 D. Functional - all interactions, routing, data sources, states (loading/empty/error/success),
              i18n strings. No stubs / TODO / NotImplementedException.
 coveredCount must equal requiredCount.

GATES (run from $Repo):
  dotnet build apps/windows/TeslaSync.sln -c Release
  dotnet format apps/windows/TeslaSync.sln --verify-no-changes
  pwsh apps/tools/check-placeholders.ps1 -Path apps/windows -Language csharp
  dotnet test apps/windows/TeslaSync.App.Tests/TeslaSync.App.Tests.csproj
  (UITests need WinAppDriver, absent here -> deferred per apps/environment-pending-verifications.md.)

VISUAL EVIDENCE (mandatory):
  1. Ensure the app runs, navigate to '$route'.
  2. Capture: pwsh .github/prompts/monorepo/capture-window.ps1 -Title TeslaSync -Out $shot
  3. Open $WebUrl$route and compare to the screenshot. Score visualScore 0-100 and list
     concrete deltas (missing/extra components, color/spacing/typography mismatches).

RECORD in apps/parity/windows-ledger.json (schema ledger.schema.json + visualScore, shotPath,
deltas, attempts). Mark "done" ONLY if gates green AND coveredCount==requiredCount AND
visualScore>=$VisualThreshold AND no missing/extra component; else "todo" (or "blocked" for a
real env gap). Set shotPath="$shot".

FINAL LINE, exactly:
  PARITY_RESULT unitId=$($u.id) status=<done|blocked|todo> covered=<n> required=$($u.requiredCount) visual=<0-100> shot=$shot

Do not touch any other unit. Do not ask questions. Log: $log
"@
}

# ---- The loop
$processed = 0; $consecBlocked = 0
while ($true) {
  if (Test-Path $stopFile) { Write-Host "[loop] STOP sentinel present — halting." -Foreground Yellow; break }

  $rows = @(Read-Ledger)
  $byId = @{}; foreach ($r in $rows) { $byId[$r.unitId] = $r }

  $next = $null
  foreach ($u in $ordered) {
    $r = $byId[$u.id]
    if (-not $r -or ($r.status -ne 'done' -and $r.status -ne 'blocked')) { $next = $u; break }
  }
  if (-not $next) {
    $done = @($rows | Where-Object status -eq 'done').Count
    $blk  = @($rows | Where-Object status -eq 'blocked').Count
    Write-Host "=== LOOP COMPLETE === done=$done blocked=$blk total=$total" -Foreground Green; break
  }
  if ($MaxUnits -gt 0 -and $processed -ge $MaxUnits) {
    Write-Host "[loop] MaxUnits=$MaxUnits reached — stopping." -Foreground Yellow; break
  }

  $doneCount = @($rows | Where-Object status -eq 'done').Count
  $safe = ($next.id -replace '[^\w\.-]','_')
  $log  = Join-Path $logDir "$safe.log"
  $shot = Join-Path $shotDir "$safe.png"
  $prev = $byId[$next.id]
  $attempts = if ($prev) { [int]$prev.attempts } else { 0 }
  Write-Host "[loop $doneCount/$total] -> unit=$($next.id) kind=$($next.kind) req=$($next.requiredCount) attempt=$($attempts+1)" -Foreground Cyan

  if ($DryRun) { $processed++; continue }

  Set-Row $next.id @{ status='in_progress'; requiredCount=$next.requiredCount; attempts=($attempts+1) } | Out-Null

  $prompt = Build-UnitPrompt $next $log $shot
  $cargs = @('-p', $prompt, '--allow-all-tools', '--allow-all-urls', '--add-dir', $Repo, '-C', $Repo)
  if ($Model) { $cargs += @('--model', $Model) }
  & copilot @cargs 2>&1 | Tee-Object -FilePath $log | Out-Host

  # ---- Reality check: "done" requires a real screenshot + threshold score. Cannot be faked.
  $after = Get-Row @(Read-Ledger) $next.id
  $claimedDone = $after -and $after.status -eq 'done'
  $shotOk  = (Test-Path $shot)
  $scoreOk = $after -and ([int]$after.visualScore) -ge $VisualThreshold
  if ($claimedDone -and -not ($shotOk -and $scoreOk)) {
    $reason = if (-not $shotOk) { 'no screenshot evidence' } else { "visualScore $($after.visualScore)<$VisualThreshold" }
    if (($attempts+1) -ge $MaxAttempts) {
      Set-Row $next.id @{ status='blocked'; deltas=@("rejected done: $reason (max attempts)") } | Out-Null
    } else {
      Set-Row $next.id @{ status='todo'; deltas=@("rejected done: $reason") } | Out-Null
    }
    Write-Host "[loop] REJECTED fake done for $($next.id): $reason" -Foreground Red
    $after = Get-Row @(Read-Ledger) $next.id
  }
  if (-not $after -or ($after.status -ne 'done' -and $after.status -ne 'blocked' -and $after.status -ne 'todo')) {
    Set-Row $next.id @{ status='blocked'; deltas=@('agent did not record a result') } | Out-Null
    $after = Get-Row @(Read-Ledger) $next.id
  }
  # Forward-progress guard: a still-todo unit at max attempts becomes blocked.
  if ($after.status -eq 'todo' -and ($attempts+1) -ge $MaxAttempts) {
    Set-Row $next.id @{ status='blocked'; deltas=@($after.deltas + 'max attempts without parity') } | Out-Null
    $after = Get-Row @(Read-Ledger) $next.id
  }

  if ($after.status -eq 'blocked') { $consecBlocked++ } else { $consecBlocked = 0 }
  Write-Host "[loop done $($next.id)] status=$($after.status) covered=$($after.coveredCount)/$($after.requiredCount) visual=$($after.visualScore)" -Foreground DarkGray
  if ($consecBlocked -ge $MaxConsecutiveBlocked) {
    Write-Host "[loop] $consecBlocked consecutive blocked — circuit breaker tripped." -Foreground Red; break
  }
  $processed++
}
