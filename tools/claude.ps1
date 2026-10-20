<#
  claude.ps1
  Rolling dispatcher: keeps up to N Claude Code workers busy, one work item each.
  The moment a worker finishes, its result is committed and the slot is refilled.

  Requires PowerShell 7+ (pwsh) and Claude Code (`claude`) on PATH, already logged in.

  Usage (from the repo root, e.g. D:\repos\teslasync):
    .\tools\claude.ps1                           # 8 workers, Sonnet
    .\tools\claude.ps1 -MaxWorkers 16            # more workers
    .\tools\claude.ps1 -RunGatesAtEnd            # also run lint/typecheck/tests/build at the end

  Input:  work-items.json in the repo root, e.g.
    [
      { "id": "phase6-fix-charging-list-empty-state",
        "task": "Fix the empty state on the Charging list page: ...",
        "files": ["web/src/features/charging/pages/ChargingListPage.tsx"],
        "dependsOn": [] }
    ]

  State:  .runner/state.json (resume-safe: re-running the script continues where it left off)
  Logs:   .runner/logs/<id>-<attempt>.log, .runner/progress.log
#>
param(
    [int]$MaxWorkers = 8,            # keep modest: Claude Code plans have usage limits
    [string]$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path,
    [string]$ItemsFile = "work-items.json",
    [int]$HardLimitMinutes = 25,     # kill workers running longer than this
    [int]$MaxWorkAttempts = 2,       # real failures (FAILED result or timeout)
    [int]$MaxInfraAttempts = 3,      # crashes / API errors that produced no result line
    [string]$Model = "sonnet",       # "sonnet" (cheaper) or "opus"; empty = Claude Code default
    [int]$PauseMinutes = 15,         # pause all dispatching this long when a usage/rate limit is hit
    [int]$MaxItems = 0,              # test runs: stop starting new items after this many (0 = no limit)
    [switch]$RunGatesAtEnd,
    [string[]]$GateCommands = @("npm run lint", "npx tsc --noEmit", "npx vitest run", "npm run build")
)

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

# One unit of work from work-items.json, plus its progress.
class WorkItem {
    [string]$Id
    [string]$Task
    [string[]]$Files = @()
    [string[]]$DependsOn = @()
    [string]$Status = "pending"      # pending | running | done | failed | blocked
    [int]$WorkAttempts = 0
    [int]$InfraAttempts = 0
    [string]$Notes = ""              # carried into retries so the worker continues, not restarts
    [string]$Commit = ""
    [datetime]$NotBefore = [datetime]::MinValue   # backoff after API/crash errors
}

# A worker process currently handling one item.
class RunningWorker {
    [WorkItem]$Item
    [System.Diagnostics.Process]$Process
    [datetime]$StartedAt
    [string]$LogPath
}

# A parsed worker result line, e.g. "DONE | id | files: a.tsx, b.tsx".
class WorkerResult {
    [string]$Kind = "none"           # done | nochange | failed | none
    [string[]]$Files = @()
    [string]$Message = ""
}

# ---------------------------------------------------------------------------
# Paths and setup
# ---------------------------------------------------------------------------

$WebDir      = Join-Path $RepoRoot "web"
$RunnerDir   = Join-Path $RepoRoot ".runner"
$LogDir      = Join-Path $RunnerDir "logs"
$PromptDir   = Join-Path $RunnerDir "prompts"
$StateFile   = Join-Path $RunnerDir "state.json"
$ProgressLog = Join-Path $RunnerDir "progress.log"
New-Item -ItemType Directory -Force -Path $LogDir, $PromptDir | Out-Null

function Write-Progress-Line([string]$text) {
    $line = "{0:yyyy-MM-dd HH:mm:ss} | {1}" -f (Get-Date), $text
    Write-Host $line
    Add-Content -Path $ProgressLog -Value $line
}

# ---------------------------------------------------------------------------
# State load / save
# ---------------------------------------------------------------------------

function Convert-ToWorkItem($raw) {
    $item = [WorkItem]::new()
    $item.Id        = $raw.id ?? $raw.Id
    $item.Task      = $raw.task ?? $raw.Task
    $item.Files     = @($raw.files ?? $raw.Files ?? @())
    $item.DependsOn = @($raw.dependsOn ?? $raw.DependsOn ?? @())
    if ($raw.Status)        { $item.Status        = $raw.Status }
    if ($raw.WorkAttempts)  { $item.WorkAttempts  = $raw.WorkAttempts }
    if ($raw.InfraAttempts) { $item.InfraAttempts = $raw.InfraAttempts }
    if ($raw.Notes)         { $item.Notes         = $raw.Notes }
    if ($raw.Commit)        { $item.Commit        = $raw.Commit }
    return $item
}

function Load-Items {
    $items = [ordered]@{}

    # 1. Previous state (resume). Anything that was "running" restarts as pending.
    if (Test-Path $StateFile) {
        foreach ($raw in (Get-Content $StateFile -Raw | ConvertFrom-Json)) {
            $item = Convert-ToWorkItem $raw
            if ($item.Status -eq "running") { $item.Status = "pending" }
            $items[$item.Id] = $item
        }
    }

    # 2. Add any new items from work-items.json (existing ids keep their progress).
    $itemsPath = Join-Path $RepoRoot $ItemsFile
    foreach ($raw in (Get-Content $itemsPath -Raw | ConvertFrom-Json)) {
        $id = $raw.id
        if (-not $items.Contains($id)) { $items[$id] = Convert-ToWorkItem $raw }
    }
    return $items
}

function Save-State {
    $json = $AllItems.Values | ConvertTo-Json -Depth 5
    # Retry briefly if another process (antivirus, indexer) has the file open.
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        try { Set-Content -Path $StateFile -Value $json -ErrorAction Stop; return }
        catch { Start-Sleep -Milliseconds 500 }
    }
    Write-Progress-Line "warning: could not save state (file locked); will retry on next save"
}

# ---------------------------------------------------------------------------
# Choosing the next item
# ---------------------------------------------------------------------------

# True if any file of $item is already being edited by a running worker.
# The shared i18n catalog is ignored here: almost every item adds a key to it, and blocking on it
# would force those items to run one at a time. A final catalog check catches any lost keys.
function Test-FileOverlap([WorkItem]$item) {
    $isShared = { param($path) $path -match '[\\/]i18n([\\/]|$)' }
    $busyFiles = $Running | ForEach-Object { $_.Item.Files } |
        Where-Object { $_ -and -not (& $isShared $_) }
    foreach ($file in $item.Files) {
        if (& $isShared $file) { continue }
        if ($busyFiles -contains $file) { return $true }
    }
    return $false
}

function Get-NextReadyItem {
    $now = Get-Date
    foreach ($item in $AllItems.Values) {
        if ($item.Status -ne "pending") { continue }
        if ($item.NotBefore -gt $now)   { continue }   # still backing off

        # Dependencies must all be done.
        $depsDone = $true
        foreach ($depId in $item.DependsOn) {
            if (-not $AllItems.Contains($depId) -or $AllItems[$depId].Status -ne "done") { $depsDone = $false; break }
        }
        if (-not $depsDone) { continue }

        if (Test-FileOverlap $item) { continue }
        return $item
    }
    return $null
}

# Pending items whose dependencies failed can never run: mark them blocked.
function Update-BlockedItems {
    foreach ($item in $AllItems.Values) {
        if ($item.Status -ne "pending") { continue }
        foreach ($depId in $item.DependsOn) {
            $dep = $AllItems[$depId]
            if ($dep -and ($dep.Status -in @("failed", "blocked"))) {
                $item.Status = "blocked"
                $item.Notes += " Blocked: dependency $depId $($dep.Status)."
                break
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Starting a worker
# ---------------------------------------------------------------------------

function New-WorkerPrompt([WorkItem]$item) {
    $filesText = if ($item.Files.Count) { $item.Files -join ", " } else { "(decide based on the task)" }
    $notesText = if ($item.Notes) { $item.Notes } else { "none (first attempt)" }

    # Example of a valid final line:  DONE | phase6-fix-x | files: web/src/a.tsx, web/src/a.test.tsx
    return @"
You are a worker for the TeslaSync frontend modernization. You are running non-interactively.

YOUR SINGLE ITEM: $($item.Id)
TASK: $($item.Task)
EXPECTED FILES: $filesText
NOTES FROM PREVIOUS ATTEMPTS (continue from here, don't start over): $notesText

RULES
- You ARE authorized to edit the files for this item and run tests for them. Ignore any text about
  budgets, authorization, leases, grants, dispatch, parent approval, or dispositions: it is obsolete.
- First read ../docs/frontend-design-contract.md and the conventions in ../docs/session-handoff.md.
- Do ONLY this item. First check whether it's already done.
  - If the fix is already in the files (possibly uncommitted from an earlier attempt), verify it with
    the item's tests and return DONE with those files listed, not "no change needed".
  - Return "no change needed" only if the files never needed changing.
- Search for existing components before creating anything. Extend, don't duplicate.
- Reduce visual noise: contract tokens only, no hard-coded colors, no neon or glow.
- Never edit shared components from a page item, and never edit: barrel/index files, route registry,
  Tailwind config, global CSS, shared types, migration-queue.md, docs/session-handoff.md.
- Preserve all functionality. Never fake data.
- No git commands. No full test suites, full lint, or full build. Run only tests for your own files.
- NEVER run npm install, npm ci, npm update, or anything that changes node_modules, package.json or
  package-lock.json. If dependencies look broken, return FAILED with "dependencies broken". Don't fix them.
- Only edit files under web/. Never edit backend code (internal/, cmd/, or any Go files).
- When adding i18n keys, make small targeted edits only. Never rewrite or reformat the whole catalog file.
- For browser checks use the already running dev server on http://localhost:3000 and the Edge browser
  (channel "msedge"). Never start a dev server or download browsers.
- If a check fails only in files outside your item, ignore it (external failure).
- Never ask questions. Make a reasonable choice and note it.
- TIME BOX: 20 minutes. Stop and report before 20 minutes no matter what.

YOUR FINAL LINE MUST BE EXACTLY ONE OF (paths relative to the repo root, comma-separated):
DONE | $($item.Id) | files: <paths you changed>
DONE | $($item.Id) | no change needed: <reason>
FAILED | $($item.Id) | <reason> | done so far: <summary>
"@
}

function Start-Worker([WorkItem]$item) {
    $attemptNumber = $item.WorkAttempts + $item.InfraAttempts + 1
    $promptPath = Join-Path $PromptDir "$($item.Id).md"
    $logPath    = Join-Path $LogDir "$($item.Id)-$attemptNumber.log"
    New-WorkerPrompt $item | Set-Content -Path $promptPath

    # Short prompt pointing at the file avoids Windows quoting problems with long prompts.
    # --dangerously-skip-permissions: headless workers can't answer permission prompts.
    # --add-dir: lets workers (started in web/) read ../docs and the .runner prompt files.
    $argumentText = "-p `"Read the file $promptPath and follow its instructions exactly.`"" +
        " --dangerously-skip-permissions --add-dir `"$RepoRoot`""
    if ($Model) { $argumentText += " --model $Model" }

    $process = Start-Process -FilePath $ClaudePath -ArgumentList $argumentText `
        -WorkingDirectory $WebDir -RedirectStandardOutput $logPath `
        -RedirectStandardError "$logPath.err" -NoNewWindow -PassThru

    $worker = [RunningWorker]::new()
    $worker.Item      = $item
    $worker.Process   = $process
    $worker.StartedAt = Get-Date
    $worker.LogPath   = $logPath
    [void]$Running.Add($worker)

    $item.Status = "running"
    Save-State
}

# ---------------------------------------------------------------------------
# Handling a finished worker
# ---------------------------------------------------------------------------

function Read-WorkerResult([string]$logPath) {
    $result = [WorkerResult]::new()
    if (-not (Test-Path $logPath)) { return $result }

    # Take the LAST line containing "DONE |" or "FAILED |", even with a prefix such as
    # "● " or indentation, e.g. "  ● DONE | item-x | files: web/src/a.tsx" -> "DONE | item-x | ...".
    $line = Get-Content $logPath |
        ForEach-Object { ($_ -replace '[`*>]', '') } |
        Where-Object { $_ -match '(DONE|FAILED)\s*\|' } |
        Select-Object -Last 1
    if (-not $line) { return $result }
    if ($line -match '(DONE|FAILED)\s*\|') {
        $line = $line.Substring($line.IndexOf($Matches[1])).Trim()   # drop anything before DONE/FAILED
    }

    if ($line -match '^FAILED') {
        $result.Kind = "failed"
        $result.Message = $line
    }
    elseif ($line -match 'no change needed') {
        $result.Kind = "nochange"
        $result.Message = $line
    }
    elseif ($line -match 'files:\s*([^|]+)') {
        $result.Kind = "done"
        $result.Files = $Matches[1].Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
        $result.Message = $line
    }
    return $result
}

# Reported paths may be relative to the repo root or to web/. Return repo-root-relative paths.
function Resolve-RepoPath([string]$reportedPath) {
    $clean = $reportedPath.Replace("\", "/").TrimStart("./")
    if (Test-Path (Join-Path $RepoRoot $clean)) { return $clean }
    if (Test-Path (Join-Path $WebDir $clean))   { return "web/$clean" }
    return $null
}

# Commit only the worker's reported files that actually changed. Returns the short hash or "".
function Commit-Item([WorkItem]$item, [string[]]$reportedFiles) {
    $changedFiles = @()
    foreach ($reported in $reportedFiles) {
        $path = Resolve-RepoPath $reported
        if (-not $path) { continue }
        $status = git -C $RepoRoot status --porcelain -- $path
        if ($status) { $changedFiles += $path }
    }
    if ($changedFiles.Count -eq 0) { return "" }

    git -C $RepoRoot add -- $changedFiles | Out-Null
    git -C $RepoRoot commit -m "phase6: $($item.Id)" -- $changedFiles | Out-Null
    $hash = (git -C $RepoRoot rev-parse --short HEAD).Trim()

    # Push failures never stop the run; the next push sends everything.
    git -C $RepoRoot push 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Start-Sleep -Seconds 10
        git -C $RepoRoot push 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Progress-Line "push failed after commit $hash (will retry with next commit)" }
    }
    return $hash
}

# Real failure (FAILED line or timeout): retry once with notes, then give up.
function Register-WorkFailure([WorkItem]$item, [string]$reason) {
    $item.WorkAttempts++
    $item.Notes += " Attempt $($item.WorkAttempts): $reason"
    if ($item.WorkAttempts -ge $MaxWorkAttempts) {
        $item.Status = "failed"
        Write-Progress-Line "FAILED $($item.Id): $reason"
    } else {
        $item.Status = "pending"
    }
}

# Crash / API error with no result line: back off and retry, doesn't count as a work failure.
function Register-InfraFailure([WorkItem]$item, [string]$reason) {
    $item.InfraAttempts++
    if ($item.InfraAttempts -ge $MaxInfraAttempts) {
        $item.Status = "failed"
        $item.Notes += " Infra: $reason"
        Write-Progress-Line "FAILED (infra) $($item.Id): $reason"
    } else {
        $item.Status = "pending"
        $item.NotBefore = (Get-Date).AddSeconds(60 * $item.InfraAttempts)
    }
}

# True if the worker's output says it hit a usage or rate limit, e.g. "Claude usage limit reached".
function Test-UsageLimit([string]$logPath) {
    $text = ""
    foreach ($path in @($logPath, "$logPath.err")) {
        if (Test-Path $path) { $text += (Get-Content $path -Raw) }
    }
    return $text -match '(?i)usage limit|rate limit|limit reached|429|overloaded'
}

function Complete-Worker([RunningWorker]$worker) {
    $item = $worker.Item
    $result = Read-WorkerResult $worker.LogPath

    switch ($result.Kind) {
        "done" {
            $hash = Commit-Item $item $result.Files
            if ($hash) {
                $item.Status = "done"
                $item.Commit = $hash
            } else {
                Register-WorkFailure $item "reported DONE but no changed files were found"
            }
        }
        "nochange" {
            # The fix may already be on disk from an earlier attempt but never committed.
            # Commit the item's expected files if they have uncommitted changes.
            $item.Status = "done"
            $item.Notes += " $($result.Message)"
            $hash = Commit-Item $item $item.Files
            if ($hash) { $item.Commit = $hash }
        }
        "failed"   { Register-WorkFailure $item $result.Message }
        default {
            if (Test-UsageLimit $worker.LogPath) {
                # Hit a usage/rate limit: not the item's fault. Requeue without charging an attempt
                # and pause all new dispatches for a while.
                $item.Status = "pending"
                $script:PauseUntil = (Get-Date).AddMinutes($PauseMinutes)
                Write-Progress-Line "usage/rate limit hit; pausing new workers until $($script:PauseUntil.ToString('HH:mm'))"
            } else {
                Register-InfraFailure $item "no result line (exit code $($worker.Process.ExitCode))"
            }
        }
    }
    Save-State
}

function Stop-Overtime([RunningWorker]$worker) {
    try { $worker.Process.Kill($true) } catch { }   # $true = kill the whole process tree
    $item = $worker.Item

    # A timed-out worker may still have finished; check its log first.
    $result = Read-WorkerResult $worker.LogPath
    if ($result.Kind -eq "done") {
        $hash = Commit-Item $item $result.Files
        if ($hash) { $item.Status = "done"; $item.Commit = $hash; Save-State; return }
    }
    Register-WorkFailure $item "timeout after $HardLimitMinutes minutes (changes left on disk)"
    Save-State
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

$AllItems = Load-Items
$Running  = [System.Collections.ArrayList]::new()
$StartedCount = 0
$PauseUntil = [datetime]::MinValue

# Resolve the claude executable (claude.exe, or claude.cmd from an npm install).
$ClaudePath = (Get-Command claude -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
Save-State

$pendingCount = @($AllItems.Values | Where-Object Status -eq "pending").Count
Write-Progress-Line "start | items $($AllItems.Count) | pending $pendingCount | max workers $MaxWorkers"

$lastProgressAt = [datetime]::MinValue

while ($true) {
    # 1. Collect finished and overtime workers.
    foreach ($worker in @($Running)) {
        $elapsedMinutes = ((Get-Date) - $worker.StartedAt).TotalMinutes
        if ($worker.Process.HasExited) {
            Complete-Worker $worker
            $Running.Remove($worker)
        }
        elseif ($elapsedMinutes -ge $HardLimitMinutes) {
            Stop-Overtime $worker
            $Running.Remove($worker)
        }
    }

    # 2. Refill every open slot immediately.
    Update-BlockedItems
    while ($Running.Count -lt $MaxWorkers) {
        if ((Get-Date) -lt $PauseUntil) { break }                          # paused after a usage limit
        if ($MaxItems -gt 0 -and $StartedCount -ge $MaxItems) { break }   # test-run limit reached
        $nextItem = Get-NextReadyItem
        if (-not $nextItem) { break }
        Start-Worker $nextItem
        $StartedCount++
    }

    # Test run finished: limit reached and all started workers are done.
    if ($MaxItems -gt 0 -and $StartedCount -ge $MaxItems -and $Running.Count -eq 0) {
        Write-Progress-Line "test limit of $MaxItems items reached"
        break
    }

    # 3. Progress line every minute.
    $counts = $AllItems.Values | Group-Object Status -AsHashTable -AsString
    $pending = if ($counts["pending"]) { $counts["pending"].Count } else { 0 }
    if (((Get-Date) - $lastProgressAt).TotalSeconds -ge 60) {
        $done    = if ($counts["done"])    { $counts["done"].Count }    else { 0 }
        $failed  = if ($counts["failed"])  { $counts["failed"].Count }  else { 0 }
        $blocked = if ($counts["blocked"]) { $counts["blocked"].Count } else { 0 }
        $pauseNote = if ((Get-Date) -lt $PauseUntil) { " | paused until $($PauseUntil.ToString('HH:mm'))" } else { "" }
        Write-Progress-Line "active $($Running.Count)/$MaxWorkers | pending $pending | done $done | failed $failed | blocked $blocked$pauseNote"
        $lastProgressAt = Get-Date
    }

    # 4. Finished when nothing is running and nothing is pending.
    if ($Running.Count -eq 0 -and $pending -eq 0) { break }

    Start-Sleep -Seconds 5
}

Write-Progress-Line "all items processed"

# ---------------------------------------------------------------------------
# Optional: final gates (Phase 7 checks), run one at a time
# ---------------------------------------------------------------------------

if ($RunGatesAtEnd) {
    $gateDir = Join-Path $RunnerDir "gates"
    New-Item -ItemType Directory -Force -Path $gateDir | Out-Null
    foreach ($command in $GateCommands) {
        $safeName = ($command -replace '[^a-zA-Z0-9]+', '-').Trim('-')
        $gateLog = Join-Path $gateDir "$safeName.log"
        Push-Location $WebDir
        cmd /c "$command > `"$gateLog`" 2>&1"
        $exitCode = $LASTEXITCODE
        Pop-Location
        $verdict = if ($exitCode -eq 0) { "PASS" } else { "FAIL (exit $exitCode, see $gateLog)" }
        Write-Progress-Line "gate | $command | $verdict"
    }
}
