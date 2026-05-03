#requires -Version 7
<#
.SYNOPSIS
  Post-phase audit of fixer invocations performed by run-prompts.ps1.

.DESCRIPTION
  Reads the per-invocation fixer logs, the phase-wide audit log, and the run
  log to produce a human-readable rollup of every fixer Copilot session that
  was spawned during a phase. Verifies the source tree was not mutated by
  any fixer run, lists all fixer commits with rollback commands, and reports
  cumulative byte budget consumed.

  The script does NOT modify the repo; it is a read-only audit.

.PARAMETER Phase
  Phase name to audit (e.g. "phase-42"). Required.

.PARAMETER LogsRoot
  Override location of the prompts logs directory. Defaults to the canonical
  path at .github/prompts/db-refactor/logs.

.EXAMPLE
  pwsh ./scripts/audit-fixer-runs.ps1 -Phase phase-42

.EXAMPLE
  pwsh ./scripts/audit-fixer-runs.ps1 -Phase phase-42 | Tee-Object audit.txt
#>
param(
    [Parameter(Mandatory)]
    [string]$Phase,
    [string]$LogsRoot = (Join-Path $PSScriptRoot '..\.github\prompts\db-refactor\logs')
)

$ErrorActionPreference = 'Stop'

# Resolve repo root from the script location (scripts/ is one level under root)
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not (Test-Path $LogsRoot)) {
    Write-Host "Logs directory not found: $LogsRoot" -ForegroundColor Red
    exit 1
}

$logsRootResolved = (Resolve-Path $LogsRoot).Path

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Fixer-Run Audit — $Phase" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Repo root : $RepoRoot"
Write-Host "  Logs root : $logsRootResolved"
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Gather per-invocation fixer logs
# ---------------------------------------------------------------------------
$pattern = "fixer-$Phase-*.log"
$invocationLogs = Get-ChildItem -Path $logsRootResolved -Filter $pattern -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne "fixer-audit-$Phase.log" } |
    Sort-Object Name

if (-not $invocationLogs -or $invocationLogs.Count -eq 0) {
    Write-Host "No fixer invocations found for phase $Phase." -ForegroundColor Yellow
    Write-Host "(This is normal when -OnBlocked auto was not used or no prompts BLOCKED.)"
    Write-Host ""
    exit 0
}

Write-Host "Found $($invocationLogs.Count) fixer invocation log(s)." -ForegroundColor Green
Write-Host ""

# ---------------------------------------------------------------------------
# 2. Parse each invocation
# ---------------------------------------------------------------------------
$invocations = @()
$totalBytes = 0
$gateFailureCounts = @{}
$resultCounts = @{}

foreach ($logFile in $invocationLogs) {
    $body = Get-Content $logFile.FullName -Raw
    $lines = Get-Content $logFile.FullName

    # Tail terminal markers
    $exitMarker = ($lines | Where-Object { $_ -match '^EXIT=\d+\s*$' } | Select-Object -Last 1)
    $statusMarker = ($lines | Where-Object { $_ -match '^STATUS=[A-Z_]+\s*$' } | Select-Object -Last 1)
    $exitVal = if ($exitMarker -match '^EXIT=(\d+)') { [int]$Matches[1] } else { $null }
    $statusVal = if ($statusMarker -match '^STATUS=([A-Z_]+)') { $Matches[1] } else { 'UNKNOWN' }

    # Result line in audit-style format (RESULT=...)
    $resultLine = ($lines | Where-Object { $_ -match '^RESULT=' } | Select-Object -Last 1)
    $resultVal = if ($resultLine -match '^RESULT=([A-Z_]+)') { $Matches[1] } else { $statusVal }

    # Gate failure tags (GATE_FAIL=Gxx or GATE=Gxx FAIL)
    $gateFails = @($lines | Where-Object { $_ -match '(GATE_FAIL|GATE=G\d+\s+FAIL|G\d+\s+FAIL)' })
    foreach ($gf in $gateFails) {
        if ($gf -match '(G\d+)') {
            $g = $Matches[1]
            if (-not $gateFailureCounts.ContainsKey($g)) { $gateFailureCounts[$g] = 0 }
            $gateFailureCounts[$g]++
        }
    }

    # Bytes added (BYTES_ADDED=N or shortstat-derived)
    $bytesLine = ($lines | Where-Object { $_ -match '^BYTES_ADDED=\d+' } | Select-Object -Last 1)
    $bytes = if ($bytesLine -match '^BYTES_ADDED=(\d+)') { [int]$Matches[1] } else { 0 }
    $totalBytes += $bytes

    # Fixer commit SHA
    $commitLine = ($lines | Where-Object { $_ -match '^FIXER_COMMIT=' } | Select-Object -Last 1)
    $commitSha = if ($commitLine -match '^FIXER_COMMIT=([0-9a-f]{7,40})') { $Matches[1] } else { '' }

    # Prompt id from filename: fixer-phase-42-0013-generate-enum-parsers-attempt1.log
    $promptId = $logFile.BaseName -replace "^fixer-$Phase-",'' -replace '-attempt\d+$',''
    $attempt = if ($logFile.BaseName -match '-attempt(\d+)$') { [int]$Matches[1] } else { 1 }

    if (-not $resultCounts.ContainsKey($resultVal)) { $resultCounts[$resultVal] = 0 }
    $resultCounts[$resultVal]++

    $invocations += [PSCustomObject]@{
        PromptId   = $promptId
        Attempt    = $attempt
        Exit       = $exitVal
        Status     = $statusVal
        Result     = $resultVal
        GateFails  = $gateFails.Count
        BytesAdded = $bytes
        Commit     = $commitSha
        LogFile    = $logFile.FullName
    }
}

# ---------------------------------------------------------------------------
# 3. Print summary table
# ---------------------------------------------------------------------------
Write-Host "── Per-invocation summary ──" -ForegroundColor Cyan
$invocations | Format-Table -AutoSize PromptId, Attempt, Exit, Status, Result, GateFails, BytesAdded, @{N='Commit';E={if($_.Commit){$_.Commit.Substring(0,[Math]::Min(8,$_.Commit.Length))}else{'-'}}} | Out-String | Write-Host

# ---------------------------------------------------------------------------
# 4. Aggregates
# ---------------------------------------------------------------------------
Write-Host "── Aggregate ──" -ForegroundColor Cyan
Write-Host "  Total invocations : $($invocations.Count)"
Write-Host "  Cumulative bytes  : $totalBytes / 51200 ($(if($totalBytes -gt 51200){'OVER BUDGET — investigate'}else{'OK'}))"
Write-Host "  Result breakdown  :"
foreach ($k in ($resultCounts.Keys | Sort-Object)) {
    Write-Host "    $k = $($resultCounts[$k])"
}
if ($gateFailureCounts.Count -gt 0) {
    Write-Host "  Gate failures     :"
    foreach ($k in ($gateFailureCounts.Keys | Sort-Object)) {
        Write-Host "    $k = $($gateFailureCounts[$k])"
    }
}
Write-Host ""

# ---------------------------------------------------------------------------
# 5. Source-tree mutation re-check (verifies G18 still holds at audit time)
# ---------------------------------------------------------------------------
Write-Host "── Source-tree integrity re-check ──" -ForegroundColor Cyan

$forbidden = @(
    'internal/', 'cmd/', 'web/', 'migrations/', 'helm/',
    'Dockerfile', 'docker-compose.yml', 'go.mod', 'go.sum',
    'web/package.json', 'web/package-lock.json',
    '.github/instructions/', '.github/workflows/',
    '.github/prompts/db-refactor/run-prompts.ps1',
    '.github/prompts/db-refactor/fixer-charter.md'
)

$fixerCommits = $invocations | Where-Object { $_.Commit } | Select-Object -ExpandProperty Commit -Unique
if ($fixerCommits.Count -eq 0) {
    Write-Host "  No fixer commits to verify." -ForegroundColor Yellow
} else {
    $allClean = $true
    foreach ($sha in $fixerCommits) {
        Push-Location $RepoRoot
        try {
            $changed = & git show --name-only --format= $sha 2>$null
        } finally {
            Pop-Location
        }
        $touched = @()
        foreach ($file in $changed) {
            if (-not $file) { continue }
            foreach ($f in $forbidden) {
                if ($file -like "$f*") { $touched += $file; break }
            }
        }
        if ($touched.Count -gt 0) {
            $allClean = $false
            Write-Host "  ✗ $sha touched forbidden paths:" -ForegroundColor Red
            $touched | ForEach-Object { Write-Host "      $_" -ForegroundColor Red }
        } else {
            Write-Host "  ✓ $sha — only prompt files / fixer logs" -ForegroundColor Green
        }
    }
    if ($allClean) {
        Write-Host "  All fixer commits are scope-clean." -ForegroundColor Green
    } else {
        Write-Host "  AUDIT FAIL — fixer touched protected paths. Investigate immediately." -ForegroundColor Red
    }
}
Write-Host ""

# ---------------------------------------------------------------------------
# 6. Rollback commands (read-only print)
# ---------------------------------------------------------------------------
if ($fixerCommits.Count -gt 0) {
    Write-Host "── Rollback (preview only — does NOT execute) ──" -ForegroundColor Cyan
    Write-Host "  To inspect a specific fixer commit:"
    foreach ($sha in $fixerCommits) { Write-Host "    git show $sha" }
    Write-Host ""
    Write-Host "  To revert ALL fixer commits in this phase (newest-first):"
    $reverseShas = $fixerCommits | ForEach-Object { $_ } | Sort-Object -Descending
    foreach ($sha in $reverseShas) { Write-Host "    git revert --no-edit $sha" }
    Write-Host ""
}

# ---------------------------------------------------------------------------
# 7. Phase-wide rollup file (if exists)
# ---------------------------------------------------------------------------
$phaseAudit = Join-Path $logsRootResolved "fixer-audit-$Phase.log"
if (Test-Path $phaseAudit) {
    Write-Host "── Phase-wide audit log ──" -ForegroundColor Cyan
    Write-Host "  File: $phaseAudit"
    Write-Host "  Tail (last 20 lines):"
    Get-Content $phaseAudit -Tail 20 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Write-Host ""
}

# ---------------------------------------------------------------------------
# 8. Copilot CLI session telemetry (sessions.jsonl)
# ---------------------------------------------------------------------------
$ledger = Join-Path $logsRootResolved "sessions.jsonl"
if (Test-Path $ledger) {
    Write-Host "── Copilot CLI session telemetry ──" -ForegroundColor Cyan
    $rows = Get-Content $ledger | ForEach-Object {
        try { $_ | ConvertFrom-Json } catch { $null }
    } | Where-Object { $_ }

    if ($rows.Count -gt 0) {
        $promptIds = $invocations | ForEach-Object { $_.PromptId } | Select-Object -Unique
        # Filter to rows whose prompt_id contains the phase name OR matches a fixer invocation
        $phaseRows = $rows | Where-Object { $_.prompt_id -like "*$Phase*" -or ($promptIds | Where-Object { $_.prompt_id -like "*$_*" }) }
        if (-not $phaseRows -or $phaseRows.Count -eq 0) { $phaseRows = $rows }

        $totalDur = [math]::Round((($phaseRows | Measure-Object -Property duration_min -Sum).Sum), 1)
        $promptCount = ($phaseRows | Where-Object { $_.source -eq 'prompt' }).Count
        $fixerCount = ($phaseRows | Where-Object { $_.source -eq 'fixer' }).Count
        $byCli = $phaseRows | Group-Object cli_version | ForEach-Object { "$($_.Name)=$($_.Count)" }
        $byModel = $phaseRows | Group-Object model | ForEach-Object { "$(if($_.Name){$_.Name}else{'(default)'})=$($_.Count)" }

        Write-Host "  Total invocations  : $($phaseRows.Count) (prompt=$promptCount, fixer=$fixerCount)"
        Write-Host "  Total duration     : $totalDur min"
        Write-Host "  CLI versions       : $($byCli -join ', ')"
        Write-Host "  Models used        : $($byModel -join ', ')"
        Write-Host ""
        Write-Host "  Per-invocation timing:" -ForegroundColor DarkCyan
        $phaseRows | Sort-Object started_at | ForEach-Object {
            $sid = if ($_.session_ids -and $_.session_ids.Count) { ($_.session_ids[0]).Substring(0, [Math]::Min(8, $_.session_ids[0].Length)) } else { '-' }
            "    {0,-25} src={1,-6} dur={2,5} min  exit={3}  sid={4}" -f `
                $_.prompt_id, $_.source, $_.duration_min, $_.exit_code, $sid
        }
    } else {
        Write-Host "  (ledger empty)" -ForegroundColor DarkGray
    }
    Write-Host ""
}

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Audit complete." -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
