#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Runs the web-to-native conversion loop as a fleet of isolated worker worktrees.

.DESCRIPTION
  Each worker owns a deterministic shard of web/src files and commits to its own
  branch. The coordinator cherry-picks worker commits back into the main
  feature branch one at a time, pushes after every successful merge batch, and
  keeps restarting unfinished shards until parity is complete.
#>

param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path,
    [string]$FleetRoot = "D:\repos\teslasync-react-native-fleet",
    [string]$Branch = "feature/react-native-platforms",
    [string]$Remote = "origin",
    [int]$Workers = 4,
    [int]$MaxAttempts = 999,
    [int]$TimeoutMinutes = 240,
    [int]$IdleTimeoutMinutes = 90,
    [int]$PollSeconds = 10,
    [int]$MergePollSeconds = 60,
    [switch]$NoDiscord = $false
)

$ErrorActionPreference = "Stop"

if ($Workers -lt 1) { throw "Workers must be >= 1" }

$stateRoot = Join-Path $RepoRoot "apps\native\.file-parity-fleet-state"
$logRoot = Join-Path $RepoRoot "apps\native\file-parity-fleet-logs"
$eventPath = Join-Path $stateRoot "events.jsonl"
$mergedPath = Join-Path $stateRoot "merged.json"
$donePath = Join-Path $RepoRoot "apps\native\.file-parity-loop-state\done.txt"
$manifestPath = Join-Path $RepoRoot "apps\native\.file-parity-loop-state\manifest.json"

New-Item -ItemType Directory -Force -Path $FleetRoot, $stateRoot, $logRoot, (Split-Path $donePath) | Out-Null

function Write-FleetEvent {
    param([hashtable]$Event)
    $Event.timestamp = (Get-Date).ToString("o")
    ($Event | ConvertTo-Json -Compress -Depth 8) | Add-Content -Path $eventPath
}

function Send-Discord {
    param([string]$Message)
    if ($NoDiscord) { return }
    $webhook = $env:RN_PARITY_DISCORD_WEBHOOK
    if ([string]::IsNullOrWhiteSpace($webhook)) { return }
    $content = if ($Message.Length -gt 1900) { $Message.Substring(0, 1900) } else { $Message }
    try {
        Invoke-RestMethod -Uri $webhook -Method Post -ContentType "application/json" -Body (@{ content = $content } | ConvertTo-Json -Depth 4) | Out-Null
    } catch {
        Write-Warning "Discord post failed: $($_.Exception.Message)"
    }
}

function Read-JsonHashtable {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return @{} }
    $raw = Get-Content $Path -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
    return @{} + ($raw | ConvertFrom-Json -AsHashtable)
}

function Write-JsonHashtable {
    param([string]$Path, [hashtable]$Value)
    $Value | ConvertTo-Json -Depth 8 | Set-Content -Path $Path -Encoding UTF8
}

function Get-SourceFiles {
    $sourceRoot = Join-Path $RepoRoot "web\src"
    $files = Get-ChildItem $sourceRoot -Recurse -File -Include *.ts,*.tsx,*.json | Where-Object {
        $_.FullName -notmatch '\\(__tests__|tests?|fixtures)\\' -and
        $_.Name -notmatch '\.(test|spec)\.'
    }
    return @($files | Sort-Object FullName)
}

function Convert-ToRepoRelativePath {
    param([string]$Path)
    $full = if (Test-Path $Path) { (Resolve-Path $Path).Path } else { [IO.Path]::GetFullPath($Path) }
    $root = (Resolve-Path $RepoRoot).Path
    return $full.Substring($root.Length + 1).Replace('\', '/')
}

function Get-OutputPath {
    param([string]$SourcePath)
    $sourceRoot = (Resolve-Path (Join-Path $RepoRoot "web\src")).Path
    $rel = $SourcePath.Substring($sourceRoot.Length + 1)
    return Join-Path $RepoRoot (Join-Path "apps\native\src\web-parity" $rel)
}

function Test-Conversion {
    param($Item)
    $sourcePath = $Item.sourceFullName
    $outputPath = $Item.outputFullName
    $sidecarPath = "$outputPath.parity.json"
    if (-not (Test-Path $sourcePath)) { return $false }
    if (-not (Test-Path $outputPath)) { return $false }
    if (-not (Test-Path $sidecarPath)) { return $false }
    try {
        $meta = Get-Content $sidecarPath -Raw | ConvertFrom-Json
        $sourceLines = @((Get-Content $sourcePath -ErrorAction Stop)).Count
        if ([int]$meta.sourceLineCount -ne $sourceLines) { return $false }
        if ([int]$meta.coveredLineCount -lt $sourceLines) { return $false }
        if (([string]$meta.conversionStatus) -notin @("converted", "blocked-with-evidence")) { return $false }
        return $true
    } catch {
        return $false
    }
}

function Update-MainDone {
    $files = Get-SourceFiles
    $manifest = @(
        for ($i = 0; $i -lt $files.Count; $i++) {
            $file = $files[$i]
            $out = Get-OutputPath $file.FullName
            [pscustomobject]@{
                index = $i + 1
                relPath = $file.FullName.Substring((Resolve-Path (Join-Path $RepoRoot "web\src")).Path.Length + 1).Replace('\', '/')
                sourcePath = Convert-ToRepoRelativePath $file.FullName
                outputPath = Convert-ToRepoRelativePath $out
                sourceFullName = $file.FullName
                outputFullName = $out
                sourceLineCount = @((Get-Content $file.FullName -ErrorAction Stop)).Count
            }
        }
    )
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8
    $done = [System.Collections.Generic.List[string]]::new()
    foreach ($item in $manifest) {
        if (Test-Conversion $item) { $done.Add([string]$item.relPath) }
    }
    $done | Sort-Object | Set-Content -Path $donePath -Encoding UTF8
    return [pscustomobject]@{ Done = $done.Count; Total = $manifest.Count }
}

function Ensure-Worker {
    param([int]$Index)
    $name = "native-parity-worker-{0:D2}" -f $Index
    $branchName = "auto/$name"
    $path = Join-Path $FleetRoot ("wt-{0:D2}" -f $Index)
    if (-not (Test-Path (Join-Path $path ".git"))) {
        git -C $RepoRoot worktree add -B $branchName $path $Branch | Out-Null
        Write-FleetEvent @{ event = "worktree-created"; worker = $Index; branch = $branchName; path = $path }
    }
    return [pscustomobject]@{ Index = $Index; Name = $name; Branch = $branchName; Path = $path }
}

function Get-WorkerProcess {
    param($Worker)
    $needle = "run-web-file-native-loop.ps1"
    $escapedPath = $Worker.Path
    return @(Get-CimInstance Win32_Process | Where-Object {
        $_.CommandLine -like "*$needle*" -and $_.CommandLine -like "*$escapedPath*"
    })
}

function Start-Worker {
    param($Worker)
    $running = Get-WorkerProcess $Worker
    if ($running.Count -gt 0) { return $running[0].ProcessId }

    $nodeDir = Join-Path $env:LOCALAPPDATA "nvm\v24.18.0"
    if (Test-Path (Join-Path $nodeDir "node.exe")) { $env:PATH = "$nodeDir;$env:PATH" }

    $stdout = Join-Path $logRoot ("worker-{0:D2}.out.log" -f $Worker.Index)
    $stderr = Join-Path $logRoot ("worker-{0:D2}.err.log" -f $Worker.Index)
    $args = @(
        "-NoProfile",
        "-File", "apps\native\scripts\run-web-file-native-loop.ps1",
        "-RepoRoot", $Worker.Path,
        "-MaxAttempts", $MaxAttempts,
        "-IdleTimeoutMinutes", $IdleTimeoutMinutes,
        "-TimeoutMinutes", $TimeoutMinutes,
        "-PollSeconds", $PollSeconds,
        "-ShardIndex", $Worker.Index,
        "-ShardCount", $Workers
    )
    if ($NoDiscord) { $args += "-NoDiscord" }
    $proc = Start-Process -FilePath "pwsh" -ArgumentList $args -WorkingDirectory $Worker.Path -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    Write-FleetEvent @{ event = "worker-started"; worker = $Worker.Index; pid = $proc.Id; path = $Worker.Path }
    return $proc.Id
}

function Merge-WorkerCommits {
    param($Worker, [hashtable]$Merged)
    $key = [string]$Worker.Index
    $last = if ($Merged.ContainsKey($key)) { [string]$Merged[$key] } else { "" }
    if ([string]::IsNullOrWhiteSpace($last)) {
        $last = (git -C $RepoRoot merge-base $Branch $Worker.Branch).Trim()
        $Merged[$key] = $last
    }
    $commits = @((git -C $RepoRoot rev-list --reverse "$last..$($Worker.Branch)" -- apps/native 2>$null) | Where-Object { $_ })
    $mergedAny = $false
    foreach ($commit in $commits) {
        Write-Host "MERGE worker $($Worker.Index): $commit"
        $pick = & git -C $RepoRoot cherry-pick $commit 2>&1
        if ($LASTEXITCODE -ne 0) {
            # Distinguish a real content conflict from an empty/redundant cherry-pick
            # (a commit whose changes are already present in $Branch). Empty picks must
            # be skipped and the pointer advanced, otherwise the coordinator retries the
            # same commit forever and starves the worker's later commits.
            $unmerged = @(& git -C $RepoRoot diff --name-only --diff-filter=U 2>$null | Where-Object { $_ })
            if ($unmerged.Count -eq 0) {
                & git -C $RepoRoot cherry-pick --skip 2>$null | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    & git -C $RepoRoot cherry-pick --quit 2>$null | Out-Null
                }
                $Merged[$key] = $commit
                Write-FleetEvent @{ event = "merge-empty-skipped"; worker = $Worker.Index; commit = $commit }
                continue
            }
            # Real content conflict. These are almost always duplicate conversions of a
            # file already converted in main, or concurrent edits to a shared barrel
            # (index.ts / registry). If EVERY conflicted path is under apps/native, auto
            # resolve by keeping main's version (--ours): this preserves accumulated
            # barrels, never regresses main, still lands all genuinely-new files in the
            # commit (non-conflicting adds merge cleanly), and advances the pointer so a
            # single shared-file conflict can no longer starve a worker's entire backlog.
            $outside = @($unmerged | Where-Object { $_ -notlike 'apps/native/*' })
            if ($outside.Count -eq 0) {
                foreach ($f in $unmerged) {
                    & git -C $RepoRoot checkout --ours -- $f 2>$null | Out-Null
                    & git -C $RepoRoot add -- $f 2>$null | Out-Null
                }
                & git -C $RepoRoot -c core.editor=true cherry-pick --continue 2>$null | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    & git -C $RepoRoot cherry-pick --skip 2>$null | Out-Null
                    if ($LASTEXITCODE -ne 0) { & git -C $RepoRoot cherry-pick --quit 2>$null | Out-Null }
                }
                $Merged[$key] = $commit
                $mergedAny = $true
                Write-FleetEvent @{ event = "merge-conflict-autoresolved"; worker = $Worker.Index; commit = $commit; conflictedPaths = $unmerged.Count }
                continue
            }
            # Conflict touches paths outside apps/native — leave for manual inspection.
            & git -C $RepoRoot cherry-pick --abort 2>$null | Out-Null
            Write-FleetEvent @{ event = "merge-conflict"; worker = $Worker.Index; commit = $commit; output = ($pick -join "`n") }
            Send-Discord "**Native parity fleet merge conflict (outside apps/native)**`nWorker: $($Worker.Index)`nCommit: $commit`nCoordinator left it unmerged for manual inspection."
            break
        }
        $Merged[$key] = $commit
        $mergedAny = $true
        Write-FleetEvent @{ event = "merged"; worker = $Worker.Index; commit = $commit }
    }
    return $mergedAny
}

git -C $RepoRoot checkout $Branch | Out-Null
$workersList = @(for ($i = 0; $i -lt $Workers; $i++) { Ensure-Worker $i })
$merged = Read-JsonHashtable $mergedPath
$progress = Update-MainDone
Send-Discord "**TeslaSync native parity fleet started**`nWorkers: $Workers`nDone: $($progress.Done)/$($progress.Total)"
Write-FleetEvent @{ event = "fleet-started"; workers = $Workers; done = $progress.Done; total = $progress.Total }

while ($true) {
    foreach ($worker in $workersList) {
        [void](Start-Worker $worker)
    }

    $mergedAny = $false
    foreach ($worker in $workersList) {
        if (Merge-WorkerCommits $worker $merged) { $mergedAny = $true }
    }
    Write-JsonHashtable -Path $mergedPath -Value $merged

    if ($mergedAny) {
        $progress = Update-MainDone
        git -C $RepoRoot push $Remote $Branch | Out-Null
        Write-FleetEvent @{ event = "pushed"; branch = $Branch; remote = $Remote; done = $progress.Done; total = $progress.Total }
        Send-Discord "**Native parity fleet merged + pushed**`nDone: $($progress.Done)/$($progress.Total)`nBranch: $Branch"
    } else {
        $progress = Update-MainDone
    }

    Write-Host "DONE=$($progress.Done)/$($progress.Total) workers=$Workers"
    if ($progress.Done -ge $progress.Total) {
        git -C $RepoRoot push $Remote $Branch | Out-Null
        Write-FleetEvent @{ event = "fleet-complete"; done = $progress.Done; total = $progress.Total }
        Send-Discord "**TeslaSync native parity fleet complete**`nDone: $($progress.Done)/$($progress.Total)`nBranch pushed: $Branch"
        exit 0
    }

    Start-Sleep -Seconds $MergePollSeconds
}
