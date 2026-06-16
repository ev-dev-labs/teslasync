#requires -Version 7.0
<#
.SYNOPSIS
  Electron app loop driver (loop-engineering pattern) — one parametric driver for all phases.

  The LEDGER ON DISK is the only source of truth. Each iteration spawns a FRESH `copilot -p`
  agent that implements exactly ONE unit, runs the phase gates, (E2) captures a screenshot and
  scores it against the live web app, and records the result. The driver refuses to accept a
  claimed "done" unless the evidence on disk backs it up — so completion cannot be faked.

  Phases:
    e0  Foundation   — scaffold apps/electron, main/preload/IPC, security, build, CI
    e1  Integration  — embed web SPA, OIDC auth, token storage, SSE, deep links, window state
    e2  DesktopParity— every web route/surface renders in the desktop shell + desktop chrome
    e5  Hardening    — packaging, signing, auto-update, e2e, perf, a11y, security, GA

  Memory  = .github/prompts/electron/ledgers/<phase>-ledger.json
  Spec    = units/<phase>-*.json  (+ shared page/surface/chrome specs for e2)
  Worker  = copilot -p ... --allow-all-tools   (one unit per run)

.EXAMPLE
  pwsh electron-loop.ps1 -Phase e0                 # run E0 until its ledger is 100% done
  pwsh electron-loop.ps1 -Phase e2 -CountOnly      # print the combined E2 unit count (coverage proof)
  pwsh electron-loop.ps1 -Phase e2 -MaxUnits 5     # smoke test
  pwsh electron-loop.ps1 -Phase e2 -Audit          # reopen unverifiable 'done' rows
  New-Item .github/prompts/electron/ledgers/STOP-electron-loop   # graceful stop
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('e0', 'e1', 'e2', 'e5')][string]$Phase,
  [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
  [int]$MaxUnits = 0,
  [int]$MaxAttempts = 3,
  [int]$VisualThreshold = 95,
  [int]$MaxConsecutiveBlocked = 5,
  [string]$WebUrl = 'http://localhost:3000',
  [string]$Model = '',
  [switch]$CountOnly,
  [switch]$Audit,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
$here = $PSScriptRoot
$unitsDir = Join-Path $here 'units'
$ledgerDir = Join-Path $here 'ledgers'
$logDir = Join-Path $here 'logs'
$shotDir = Join-Path $logDir 'shots'
$stopFile = Join-Path $ledgerDir 'STOP-electron-loop'
$captureScript = Join-Path $here 'capture-window.ps1'

# Shared (read-only) parity specs from the native effort — we READ but never WRITE them.
$sharedPageUnits = Join-Path $Repo '.github\prompts\monorepo\parity\page-units.json'
$sharedSurfaceUnits = Join-Path $Repo '.github\prompts\monorepo\parity\surface-units.json'
$sharedChromeUnits = Join-Path $Repo 'apps\parity\parity-chrome-units.json'

New-Item -ItemType Directory -Force -Path $ledgerDir, $logDir, $shotDir | Out-Null

# ---------------------------------------------------------------------------
# Phase configuration
# ---------------------------------------------------------------------------
$phaseCfg = @{
  e0 = @{ Name = 'E0 Foundation'; Visual = $false; PromptId = 'electron-e0-loop'
    Specs = @(@{ Type = 'units'; Path = (Join-Path $unitsDir 'e0-foundation-units.json') })
  }
  e1 = @{ Name = 'E1 Integration'; Visual = $false; PromptId = 'electron-e1-loop'
    Specs = @(@{ Type = 'units'; Path = (Join-Path $unitsDir 'e1-integration-units.json') })
  }
  e2 = @{ Name = 'E2 Desktop Parity'; Visual = $true; PromptId = 'electron-e2-loop'
    Specs = @(
      @{ Type = 'chrome'; Path = $sharedChromeUnits },
      @{ Type = 'chrome'; Path = (Join-Path $unitsDir 'e2-desktop-chrome-units.json') },
      @{ Type = 'page'; Path = $sharedPageUnits },
      @{ Type = 'surface'; Path = $sharedSurfaceUnits }
    )
  }
  e5 = @{ Name = 'E5 Hardening'; Visual = $false; PromptId = 'electron-e5-loop'
    Specs = @(@{ Type = 'units'; Path = (Join-Path $unitsDir 'e5-hardening-units.json') })
  }
}
$cfg = $phaseCfg[$Phase]
$ledgerPath = Join-Path $ledgerDir "$Phase-$(if($Phase -eq 'e2'){'desktop-parity'}elseif($Phase -eq 'e0'){'foundation'}elseif($Phase -eq 'e1'){'integration'}else{'hardening'})-ledger.json"

# ---------------------------------------------------------------------------
# Spec normalization — every source maps to a common unit shape.
#   { Id; Kind; Title; Route; Checklist[]; RequiredCount; SourceWeb }
# ---------------------------------------------------------------------------
function ConvertTo-Units([hashtable]$spec) {
  if (-not (Test-Path $spec.Path)) { Write-Warning "spec not found: $($spec.Path)"; return @() }
  $raw = Get-Content $spec.Path -Raw | ConvertFrom-Json
  $out = @()
  foreach ($r in @($raw)) {
    switch ($spec.Type) {
      'units' {
        $out += [pscustomobject]@{ Id = $r.id; Kind = $r.kind; Title = $r.title; Route = '(app)';
          Checklist = @($r.checklist); RequiredCount = [int]$r.requiredCount; SourceWeb = ($r.sourceRefs -join ', ') }
      }
      'chrome' {
        $out += [pscustomobject]@{ Id = $r.id; Kind = 'desktop-chrome'; Title = $r.title; Route = $r.route;
          Checklist = @($r.parityChecklist); RequiredCount = [int]$r.requiredCount; SourceWeb = ($r.sourceFiles -join ', ') }
      }
      'page' {
        $req = if ($r.parity_required) { [int]$r.parity_required } else { 1 }
        $out += [pscustomobject]@{ Id = $r.unit; Kind = 'page'; Title = $r.unit; Route = $r.route;
          Checklist = @($r.panel_titles); RequiredCount = $req; SourceWeb = $r.web }
      }
      'surface' {
        $id = "surface:$($r.tier)/$($r.slug)"
        $out += [pscustomobject]@{ Id = $id; Kind = "surface/$($r.tier)"; Title = $id; Route = '(surface)';
          Checklist = @("renders correctly in the desktop window"); RequiredCount = 1; SourceWeb = $r.web }
      }
    }
  }
  $out
}

# Ordering: app-shell chrome first, then dashboard/widgets, then pages, then the rest.
function Get-Rank($u) {
  if ($u.Kind -eq 'desktop-chrome' -or $u.Id -match '^component:(shell|theme)/') { 0 }
  elseif ("$($u.Id) $($u.SourceWeb)" -match '(?i)dashboard|widget') { 1 }
  elseif ($u.Kind -eq 'page') { 2 }
  else { 3 }
}

$all = @()
foreach ($s in $cfg.Specs) { $all += ConvertTo-Units $s }
# de-dupe by Id (keep first), then stable-rank
$seen = @{}; $dedup = @()
foreach ($u in $all) { if (-not $seen.ContainsKey($u.Id)) { $seen[$u.Id] = $true; $dedup += $u } }
$i = 0
$ordered = $dedup | ForEach-Object { [pscustomobject]@{ U = $_; R = (Get-Rank $_); I = $i++ } } |
  Sort-Object R, I | ForEach-Object { $_.U }
$total = $ordered.Count

if ($CountOnly) {
  Write-Host "[$Phase] $($cfg.Name): $total units" -ForegroundColor Green
  $ordered | Group-Object Kind | Sort-Object Count -Descending |
    ForEach-Object { "  {0,-26} {1}" -f $_.Name, $_.Count }
  return
}

# ---------------------------------------------------------------------------
# Ledger helpers
# ---------------------------------------------------------------------------
if (-not (Test-Path $ledgerPath)) { '[]' | Set-Content -Encoding UTF8 $ledgerPath }
function Read-Ledger { $j = Get-Content $ledgerPath -Raw | ConvertFrom-Json; if ($null -eq $j) { @() } else { @($j) } }
function Save-Ledger($rows) { @($rows) | ConvertTo-Json -Depth 8 -AsArray | Set-Content -Encoding UTF8 $ledgerPath }
function Get-Row($rows, $id) { $rows | Where-Object unitId -EQ $id | Select-Object -First 1 }
function Set-Row($id, [hashtable]$fields) {
  $rows = @(Read-Ledger)
  $row = Get-Row $rows $id
  if (-not $row) {
    $row = [pscustomobject]@{ unitId = $id; phase = $Phase; status = 'todo'; coveredCount = 0;
      requiredCount = 0; visualScore = 0; shotPath = ''; deltas = @(); attempts = 0;
      promptId = $cfg.PromptId; evidenceLog = '' }
    $rows = @($rows) + $row
  }
  foreach ($k in $fields.Keys) {
    if ($row.PSObject.Properties.Name -contains $k) { $row.$k = $fields[$k] }
    else { $row | Add-Member -NotePropertyName $k -NotePropertyValue $fields[$k] -Force }
  }
  Save-Ledger $rows
  $row
}

# ---------------------------------------------------------------------------
# Audit: reopen 'done' rows that can't prove their evidence (E2 only checks screenshots).
# ---------------------------------------------------------------------------
if ($Audit) {
  $rows = @(Read-Ledger); $n = 0
  foreach ($r in $rows) {
    if ($r.status -eq 'done' -and $cfg.Visual -and
      ($r.visualScore -lt $VisualThreshold -or -not $r.shotPath -or -not (Test-Path (Join-Path $Repo $r.shotPath)))) {
      $r.status = 'todo'; $n++
    }
  }
  Save-Ledger $rows
  Write-Host "[audit] reopened $n unverifiable 'done' rows." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# Per-unit prompt
# ---------------------------------------------------------------------------
function Build-UnitPrompt($u, $log, $shot) {
  $checklist = ($u.Checklist | ForEach-Object { "    - [ ] $_" }) -join "`n"
  $visualBlock = ''
  $finalLine = "PARITY_RESULT unitId=$($u.Id) status=<done|blocked|todo> covered=<n> required=$($u.RequiredCount) visual=0 shot=-"
  if ($cfg.Visual) {
    $visualBlock = @"

VISUAL EVIDENCE (mandatory for this phase):
  1. Ensure the packaged Electron app is running and navigate to route '$($u.Route)'.
  2. Capture: pwsh "$captureScript" -Title TeslaSync -Out "$shot"
  3. Open $WebUrl$($u.Route) and compare to the screenshot. Score visualScore 0-100 and list
     concrete deltas (missing/extra components, color/spacing/typography mismatches).
  Mark done ONLY if visualScore >= $VisualThreshold AND no missing/extra component. Set shotPath="$shot".
"@
    $finalLine = "PARITY_RESULT unitId=$($u.Id) status=<done|blocked|todo> covered=<n> required=$($u.RequiredCount) visual=<0-100> shot=$shot"
  }
  @"
Implement EXACTLY ONE TeslaSync Electron unit to full completion, then stop. Do NOT touch any other unit.

Repo: $Repo
Target: apps/electron (Electron desktop app embedding the existing web/ React SPA as its renderer)
Reference web app (should be running): $WebUrl  — open route '$($u.Route)' and match it.
Governance: read .github/prompts/electron/0000-methodology.prompt.md and DIVERGENCE.md first.

HONESTY COVENANT (binding):
  1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs/skeletons/"coming soon"
  5 No parity shortcuts  6 No delegation (no sub-agents/parallel/background)  7 No predecessor bypass
  8 No commit on red  9 No silent drift (stay within allowedFiles)  10 Record honestly; log ends with EXIT= + PARITY_RESULT

UNIT ($Phase):
  id    : $($u.Id)
  kind  : $($u.Kind)
  title : $($u.Title)
  route : $($u.Route)
  web   : $($u.SourceWeb)
  requiredCount : $($u.RequiredCount)
  checklist:
$checklist

DONE means: every checklist item implemented with REAL behavior + data + loading/empty/error states,
no stubs, coveredCount == requiredCount ($($u.RequiredCount)). For chrome/UI units, every interaction and
all visible strings are localized.

GATES (run from $Repo; capture EXIT= for each; any nonzero → this unit is NOT done):
  npm --prefix apps/electron run build
  npm --prefix apps/electron run lint
  npm --prefix apps/electron run typecheck
  npm --prefix apps/electron test
  pwsh apps/tools/check-placeholders.ps1 -Path apps/electron -Language typescript
  (phase-appropriate extras: package --dir for e0/e5; e2e for e1/e5; security scan for e0/e5)
$visualBlock
RECORD your result in the ledger $ledgerPath as a row matching the schema in 0000-methodology.prompt.md
(unitId, phase=$Phase, status, coveredCount, requiredCount, visualScore, shotPath, deltas, attempts, evidenceLog="$log").
Mark "done" ONLY if all gates are green AND coveredCount==requiredCount$(if($cfg.Visual){" AND visualScore>=$VisualThreshold AND no missing/extra component"}). Else "todo" (improve next iteration) or "blocked" (real env gap).

Write a structured log to "$log" with === PREFLIGHT/SURVEY/REASONING/CHANGES/PARITY/GATE/$(if($cfg.Visual){'VISUAL/'})COMMIT === sections.
FINAL LINE, exactly:
  $finalLine

Do not ask questions. Do not pause. Implement, gate, record, commit.
"@
}

# ---------------------------------------------------------------------------
# The loop
# ---------------------------------------------------------------------------
Write-Host "[$Phase] $($cfg.Name) — $total units, ledger=$([IO.Path]::GetFileName($ledgerPath))" -ForegroundColor Cyan
$processed = 0; $consecBlocked = 0
while ($true) {
  if (Test-Path $stopFile) { Write-Host "[loop] STOP sentinel present — halting." -ForegroundColor Yellow; break }

  $rows = @(Read-Ledger)
  $byId = @{}; foreach ($r in $rows) { $byId[$r.unitId] = $r }

  $next = $null
  foreach ($u in $ordered) {
    $r = $byId[$u.Id]
    if (-not $r -or ($r.status -ne 'done' -and $r.status -ne 'blocked')) { $next = $u; break }
  }
  if (-not $next) {
    $done = @($rows | Where-Object status -EQ 'done').Count
    $blk = @($rows | Where-Object status -EQ 'blocked').Count
    Write-Host "=== $($cfg.Name.ToUpper()) COMPLETE === done=$done blocked=$blk total=$total" -ForegroundColor Green
    break
  }
  if ($MaxUnits -gt 0 -and $processed -ge $MaxUnits) {
    Write-Host "[loop] MaxUnits=$MaxUnits reached — stopping." -ForegroundColor Yellow; break
  }

  $doneCount = @($rows | Where-Object status -EQ 'done').Count
  $safe = ($next.Id -replace '[^\w\.-]', '_')
  $log = Join-Path $logDir "$Phase-$safe.log"
  $shot = Join-Path $shotDir "$Phase-$safe.png"
  $prev = $byId[$next.Id]
  $attempts = if ($prev) { [int]$prev.attempts } else { 0 }
  Write-Host "[loop $doneCount/$total] -> $($next.Id) kind=$($next.Kind) req=$($next.RequiredCount) attempt=$($attempts+1)" -ForegroundColor Cyan

  if ($DryRun) { $processed++; continue }

  Set-Row $next.Id @{ status = 'in_progress'; requiredCount = $next.RequiredCount; attempts = ($attempts + 1) } | Out-Null

  $prompt = Build-UnitPrompt $next $log $shot
  $cargs = @('-p', $prompt, '--allow-all-tools', '--allow-all-urls', '--add-dir', $Repo, '-C', $Repo)
  if ($Model) { $cargs += @('--model', $Model) }
  & copilot @cargs 2>&1 | Tee-Object -FilePath $log | Out-Host

  # ---- Reality check: a claimed 'done' must be backed by evidence on disk.
  $after = Get-Row @(Read-Ledger) $next.Id
  $claimedDone = $after -and $after.status -eq 'done'
  $coverOk = $after -and ([int]$after.coveredCount) -ge ([int]$after.requiredCount) -and ([int]$after.requiredCount) -gt 0
  $logRed = (Test-Path $log) -and ((Get-Content $log -Raw) -match '(?m)^[A-Z_]*EXIT=(?!0\s*$)\d+')
  $visualOk = (-not $cfg.Visual) -or ($after -and (Test-Path $shot) -and ([int]$after.visualScore) -ge $VisualThreshold)

  if ($claimedDone -and -not ($coverOk -and -not $logRed -and $visualOk)) {
    $reason = if ($logRed) { 'gate EXIT!=0 in log' }
    elseif (-not $coverOk) { "covered $($after.coveredCount)/$($after.requiredCount)" }
    elseif ($cfg.Visual -and -not (Test-Path $shot)) { 'no screenshot evidence' }
    else { "visualScore $($after.visualScore)<$VisualThreshold" }
    if (($attempts + 1) -ge $MaxAttempts) {
      Set-Row $next.Id @{ status = 'blocked'; deltas = @("rejected done: $reason (max attempts)") } | Out-Null
    }
    else {
      Set-Row $next.Id @{ status = 'todo'; deltas = @("rejected done: $reason") } | Out-Null
    }
    Write-Host "[loop] REJECTED fake done for $($next.Id): $reason" -ForegroundColor Red
    $after = Get-Row @(Read-Ledger) $next.Id
  }

  if (-not $after -or ($after.status -notin @('done', 'blocked', 'todo'))) {
    Set-Row $next.Id @{ status = 'blocked'; deltas = @('agent did not record a result') } | Out-Null
    $after = Get-Row @(Read-Ledger) $next.Id
  }
  # Forward-progress guard: still-todo at max attempts → blocked.
  if ($after.status -eq 'todo' -and ($attempts + 1) -ge $MaxAttempts) {
    Set-Row $next.Id @{ status = 'blocked'; deltas = @(@($after.deltas) + 'max attempts without completion') } | Out-Null
    $after = Get-Row @(Read-Ledger) $next.Id
  }

  if ($after.status -eq 'blocked') { $consecBlocked++ } else { $consecBlocked = 0 }
  Write-Host "[loop done $($next.Id)] status=$($after.status) covered=$($after.coveredCount)/$($after.requiredCount) visual=$($after.visualScore)" -ForegroundColor DarkGray
  if ($consecBlocked -ge $MaxConsecutiveBlocked) {
    Write-Host "[loop] $consecBlocked consecutive blocked — circuit breaker tripped." -ForegroundColor Red; break
  }
  $processed++
}
