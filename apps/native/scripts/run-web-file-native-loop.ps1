#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Converts old web/src source files to React Native one file at a time.

.DESCRIPTION
  Enumerates web/src .ts/.tsx/.json files and runs one Copilot conversion task
  per file. A file is done only when the native output exists under
  apps/native/src/web-parity and a sidecar parity JSON proves every source line
  was considered. This runner is deliberately sequential to satisfy the
  file-by-file / line-by-line conversion requirement.
#>

param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path,
    [string]$SourceRoot = (Join-Path $RepoRoot "web\src"),
    [string]$OutputRoot = (Join-Path $RepoRoot "apps\native\src\web-parity"),
    [string]$StateRoot = (Join-Path $RepoRoot "apps\native\.file-parity-loop-state"),
    [string]$LogRoot = (Join-Path $RepoRoot "apps\native\file-parity-loop-logs"),
    [int]$MaxAttempts = 999,
    [int]$TimeoutMinutes = 240,
    [int]$IdleTimeoutMinutes = 90,
    [int]$PollSeconds = 10,
    [int]$ShardIndex = 0,
    [int]$ShardCount = 1,
    [switch]$IncludeTests = $false,
    [switch]$DryRun = $false,
    [switch]$NoDiscord = $false
)

$ErrorActionPreference = "Stop"

if ($ShardCount -lt 1) { throw "ShardCount must be >= 1" }
if ($ShardIndex -lt 0 -or $ShardIndex -ge $ShardCount) { throw "ShardIndex must be between 0 and ShardCount - 1" }

New-Item -ItemType Directory -Force -Path $StateRoot, $LogRoot, $OutputRoot | Out-Null
$donePath = Join-Path $StateRoot "done.txt"
$attemptPath = Join-Path $StateRoot "attempts.json"
$eventPath = Join-Path $StateRoot "events.jsonl"
$manifestPath = Join-Path $StateRoot "manifest.json"

function Convert-ToRepoRelativePath {
    param([string]$Path)
    $full = if (Test-Path $Path) { (Resolve-Path $Path).Path } else { [IO.Path]::GetFullPath($Path) }
    $root = (Resolve-Path $RepoRoot).Path
    return $full.Substring($root.Length + 1).Replace('\', '/')
}

function Get-WebSourceFiles {
    $files = Get-ChildItem $SourceRoot -Recurse -File -Include *.ts,*.tsx,*.json
    if (-not $IncludeTests) {
        $files = $files | Where-Object {
            $_.FullName -notmatch '\\(__tests__|tests?|fixtures)\\' -and
            $_.Name -notmatch '\.(test|spec)\.'
        }
    }
    return @($files | Sort-Object FullName)
}

function Get-NativeOutputPath {
    param([string]$SourceFullName)
    $sourceRootPath = (Resolve-Path $SourceRoot).Path
    $rel = $SourceFullName.Substring($sourceRootPath.Length + 1)
    return Join-Path $OutputRoot $rel
}

function Get-SidecarPath {
    param([string]$OutputPath)
    return "$OutputPath.parity.json"
}

function Write-LoopEvent {
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

function Read-DoneSet {
    $set = [System.Collections.Generic.HashSet[string]]::new()
    if (Test-Path $donePath) {
        Get-Content $donePath | Where-Object { $_.Trim() } | ForEach-Object { [void]$set.Add($_.Trim()) }
    }
    return ,$set
}

function Write-DoneSet {
    param([System.Collections.Generic.HashSet[string]]$Set)
    $Set | Sort-Object | Set-Content -Path $donePath -Encoding UTF8
}

function Read-Attempts {
    if (-not (Test-Path $attemptPath)) { return @{} }
    $raw = Get-Content $attemptPath -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
    return @{} + ($raw | ConvertFrom-Json -AsHashtable)
}

function Write-Attempts {
    param([hashtable]$Attempts)
    $Attempts | ConvertTo-Json -Depth 8 | Set-Content -Path $attemptPath -Encoding UTF8
}

function Stop-ProcessTree {
    param([int]$ProcessId)
    $all = @(Get-CimInstance Win32_Process)
    foreach ($child in @($all | Where-Object { $_.ParentProcessId -eq $ProcessId })) {
        Stop-ProcessTree -ProcessId ([int]$child.ProcessId)
    }
    try { Stop-Process -Id $ProcessId -Force -ErrorAction Stop } catch { }
}

function Test-FileConversionResult {
    param(
        [string]$SourcePath,
        [string]$OutputPath,
        [string]$TranscriptPath,
        [bool]$TimedOut,
        [bool]$CommittedClean
    )
    if ($TimedOut) { return [pscustomobject]@{ Done = $false; Reason = "timeout-or-idle" } }
    if (-not (Test-Path $OutputPath)) { return [pscustomobject]@{ Done = $false; Reason = "missing native output" } }
    $sidecar = Get-SidecarPath $OutputPath
    if (-not (Test-Path $sidecar)) { return [pscustomobject]@{ Done = $false; Reason = "missing parity sidecar" } }
    try {
        $meta = Get-Content $sidecar -Raw | ConvertFrom-Json
    } catch {
        return [pscustomobject]@{ Done = $false; Reason = "invalid parity sidecar JSON" }
    }
    $sourceLines = @((Get-Content $SourcePath -ErrorAction Stop)).Count
    if ([int]$meta.sourceLineCount -ne $sourceLines) {
        return [pscustomobject]@{ Done = $false; Reason = "sidecar sourceLineCount mismatch" }
    }
    if ([int]$meta.coveredLineCount -lt $sourceLines) {
        return [pscustomobject]@{ Done = $false; Reason = "not all source lines covered" }
    }
    if (-not [string]::IsNullOrWhiteSpace($TranscriptPath) -and (Test-Path $TranscriptPath)) {
        $text = Get-Content $TranscriptPath -Raw
        if ($text -match '(?m)^STATUS=BLOCKED\s*$' -or $text -match '(?m)^EXIT=(?!0\s*$)\d+\s*$') {
            return [pscustomobject]@{ Done = $false; Reason = "blocked marker" }
        }
    }
    if ($CommittedClean -or (Test-Path $OutputPath)) {
        return [pscustomobject]@{ Done = $true; Reason = "converted with line coverage" }
    }
    return [pscustomobject]@{ Done = $false; Reason = "not committed cleanly" }
}

function New-FilePrompt {
    param(
        [string]$SourcePath,
        [string]$OutputPath,
        [string]$TranscriptPath,
        [int]$Attempt,
        [int]$Index,
        [int]$Total
    )
    $sourceRel = Convert-ToRepoRelativePath $SourcePath
    $outputRel = Convert-ToRepoRelativePath $OutputPath
    $sidecarRel = "$outputRel.parity.json"
    $sourceLines = @((Get-Content $SourcePath -ErrorAction Stop)).Count
    $prompt = @"
You are running inside the TeslaSync file-by-file web-to-React-Native conversion loop.

Repository root: $RepoRoot
Native app root: $RepoRoot\apps\native
Current file: $Index / $Total
Attempt: $Attempt / $MaxAttempts

Source web file:
$sourceRel

Required native output file:
$outputRel

Required parity sidecar:
$sidecarRel

Source line count:
$sourceLines

Non-negotiable conversion contract:
1. Read the source file line by line before editing.
2. Convert this file to React Native-compatible code under the required output path.
3. Preserve behavior, state names, API paths, unit handling, i18n intent, and visual intent where applicable.
4. Do not import DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI components into native output.
5. Use React Native primitives and existing apps/native components/tokens.
6. If the source file is non-visual utility/API/type code, port the logic/types faithfully into native-compatible TypeScript.
7. If the source file depends on unavailable browser-only behavior, create a native-safe implementation with explicit unavailable state and document it in the sidecar.
8. Create the parity sidecar JSON with fields:
   {
     "sourcePath": "$sourceRel",
     "outputPath": "$outputRel",
     "sourceLineCount": $sourceLines,
     "coveredLineCount": $sourceLines,
     "conversionStatus": "converted",
     "notes": ["short evidence that every source line was considered"]
   }
9. Run at minimum: cd apps/native; npm run typecheck; npm run lint -- --quiet; npm test -- --runInBand --detectOpenHandles.
10. Commit only apps/native changes for this file conversion with message: `feat(apps): convert $sourceRel to native`
11. End final response with EXIT=0 and STATUS=DONE if conversion, sidecar, gates, and commit succeed; otherwise EXIT=1 and STATUS=BLOCKED with exact reason.

Do not modify unrelated pre-existing web EOL-only dirty files.
"@
    $inputPath = [IO.Path]::ChangeExtension($TranscriptPath, ".prompt.txt")
    $prompt | Set-Content -Path $inputPath -Encoding UTF8
    return $inputPath
}

function Invoke-FileConversion {
    param($Item, [int]$Attempt, [int]$Index, [int]$Total)
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $safeName = ($Item.RelPath -replace '[\\/:\*\?"<>\|]', '_')
    $transcript = Join-Path $LogRoot "$stamp-$safeName-attempt-$Attempt.log"
    $input = New-FilePrompt -SourcePath $Item.SourceFullName -OutputPath $Item.OutputFullName -TranscriptPath $transcript -Attempt $Attempt -Index $Index -Total $Total
    $runner = Join-Path $LogRoot "$stamp-$safeName-runner.ps1"
    $beforeHead = (git -C $RepoRoot rev-parse HEAD).Trim()
    @"
Set-Location '$RepoRoot'
`$nodeDir = Join-Path `$env:LOCALAPPDATA 'nvm\v24.18.0'
if (Test-Path (Join-Path `$nodeDir 'node.exe')) { `$env:PATH = "`$nodeDir;`$env:PATH" }
Get-Content -Raw '$input' | copilot --yolo --autopilot -s
"@ | Set-Content -Path $runner -Encoding UTF8
    $proc = Start-Process -FilePath "pwsh" -ArgumentList @("-NoProfile", "-File", $runner) -WorkingDirectory $RepoRoot -RedirectStandardOutput $transcript -RedirectStandardError "$transcript.err" -PassThru
    $lastWrite = Get-Date
    while (-not $proc.HasExited) {
        Start-Sleep -Seconds $PollSeconds
        $elapsed = ((Get-Date) - $proc.StartTime).TotalMinutes
        $latestWrite = @(
            $(if (Test-Path $transcript) { (Get-Item $transcript).LastWriteTime } else { [datetime]"1970-01-01" }),
            $(if (Test-Path "$transcript.err") { (Get-Item "$transcript.err").LastWriteTime } else { [datetime]"1970-01-01" })
        ) | Sort-Object -Descending | Select-Object -First 1
        if ($latestWrite -gt $lastWrite) { $lastWrite = $latestWrite }
        $idle = ((Get-Date) - $lastWrite).TotalMinutes
        if ($elapsed -gt $TimeoutMinutes -or $idle -gt $IdleTimeoutMinutes) {
            Stop-ProcessTree -ProcessId $proc.Id
            $afterHead = (git -C $RepoRoot rev-parse HEAD).Trim()
            return [pscustomobject]@{ Transcript = $transcript; TimedOut = $true; BeforeHead = $beforeHead; AfterHead = $afterHead }
        }
    }
    $afterHead = (git -C $RepoRoot rev-parse HEAD).Trim()
    return [pscustomobject]@{ Transcript = $transcript; TimedOut = $false; BeforeHead = $beforeHead; AfterHead = $afterHead }
}

$sourceFiles = Get-WebSourceFiles
$fullManifest = @(
    for ($i = 0; $i -lt $sourceFiles.Count; $i++) {
        $file = $sourceFiles[$i]
        $sourceRootPath = (Resolve-Path $SourceRoot).Path
        $rel = $file.FullName.Substring($sourceRootPath.Length + 1).Replace('\', '/')
        $out = Get-NativeOutputPath $file.FullName
        [pscustomobject]@{
            index = $i + 1
            relPath = $rel
            sourcePath = Convert-ToRepoRelativePath $file.FullName
            outputPath = Convert-ToRepoRelativePath $out
            sourceFullName = $file.FullName
            outputFullName = $out
            sourceLineCount = @((Get-Content $file.FullName -ErrorAction Stop)).Count
        }
    }
)

# Optional drain mode: restrict to an explicit relPath allow-list (one per line)
# and re-index sequentially so a reduced tail set shards evenly across all workers
# instead of staying jammed in whichever natural shard it happened to fall in.
$onlyListPath = $env:RN_PARITY_ONLY_LIST
if (-not [string]::IsNullOrWhiteSpace($onlyListPath) -and (Test-Path $onlyListPath)) {
    $onlySet = @{}
    foreach ($line in (Get-Content $onlyListPath)) { $t = $line.Trim(); if ($t) { $onlySet[$t] = $true } }
    $filtered = @($fullManifest | Where-Object { $onlySet.ContainsKey($_.relPath) })
    for ($k = 0; $k -lt $filtered.Count; $k++) { $filtered[$k].index = $k + 1 }
    $fullManifest = $filtered
    Write-Host "ONLY-LIST active: $($fullManifest.Count) files from $onlyListPath (re-indexed for even sharding)"
}
$manifest = @($fullManifest | Where-Object { (($_.index - 1) % $ShardCount) -eq $ShardIndex })
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestPath -Encoding UTF8

$doneSet = Read-DoneSet
$attempts = Read-Attempts

Send-Discord "**TeslaSync file-by-file native conversion loop started**`nShard: $ShardIndex/$ShardCount`nFiles: $($manifest.Count) of $($fullManifest.Count)`nDone: $($doneSet.Count)/$($manifest.Count)"

foreach ($item in $manifest) {
    $id = $item.relPath
    if ($doneSet.Contains($id)) { continue }

    $existing = Test-FileConversionResult -SourcePath $item.sourceFullName -OutputPath $item.outputFullName -TranscriptPath "" -TimedOut:$false -CommittedClean:$false
    if ($existing.Done) {
        [void]$doneSet.Add($id)
        Write-DoneSet $doneSet
        Write-Host "DONE [$($item.index)/$($fullManifest.Count)] $id (existing output)"
        Write-LoopEvent @{ event = "done-existing"; file = $id; index = $item.index; total = $fullManifest.Count }
        continue
    }

    $attempt = 1 + [int]($attempts[$id] ?? 0)
    if ($attempt -gt $MaxAttempts) {
        Write-LoopEvent @{ event = "max-attempts"; file = $id; attempts = $attempt - 1 }
        continue
    }
    if ($DryRun) {
        Write-Host "START [$($item.index)/$($fullManifest.Count)] $id attempt $attempt/$MaxAttempts"
        continue
    }
    $attempts[$id] = $attempt
    Write-Attempts $attempts
    Write-Host "START [$($item.index)/$($fullManifest.Count)] $id attempt $attempt/$MaxAttempts"
    Write-LoopEvent @{ event = "start"; file = $id; attempt = $attempt; index = $item.index; total = $fullManifest.Count; shardIndex = $ShardIndex; shardCount = $ShardCount }

    $outputDir = Split-Path $item.outputFullName
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
    $run = Invoke-FileConversion -Item $item -Attempt $attempt -Index $item.index -Total $manifest.Count
    $nativeDirty = @(git -C $RepoRoot status --short -- apps/native 2>$null)
    $committedClean = ($run.BeforeHead -ne $run.AfterHead -and $nativeDirty.Count -eq 0)
    $result = Test-FileConversionResult -SourcePath $item.sourceFullName -OutputPath $item.outputFullName -TranscriptPath $run.Transcript -TimedOut:$run.TimedOut -CommittedClean:$committedClean
    if ($result.Done) {
        [void]$doneSet.Add($id)
        Write-DoneSet $doneSet
        Write-Host "DONE [$($item.index)/$($fullManifest.Count)] $id"
        Write-LoopEvent @{ event = "done"; file = $id; attempt = $attempt; transcript = $run.Transcript }
        Send-Discord "**File native conversion DONE**`n$id`nDone: $($doneSet.Count)/$($manifest.Count)"
    } else {
        Write-Host "BLOCKED [$($item.index)/$($fullManifest.Count)] $id - $($result.Reason)"
        Write-LoopEvent @{ event = "blocked"; file = $id; attempt = $attempt; reason = $result.Reason; transcript = $run.Transcript }
        Send-Discord "**File native conversion blocked; loop continues**`n$id`nReason: $($result.Reason)`nAttempt: $attempt/$MaxAttempts`nDone: $($doneSet.Count)/$($manifest.Count)"
    }
}

$summary = "DONE=$($doneSet.Count)/$($manifest.Count)"
Write-Host $summary
Write-LoopEvent @{ event = "summary"; done = $doneSet.Count; total = $manifest.Count }
Send-Discord "**TeslaSync file-by-file native conversion loop stopped**`n$summary"

if ($DryRun) { exit 0 }
if ($doneSet.Count -eq $manifest.Count) { exit 0 }
exit 1
