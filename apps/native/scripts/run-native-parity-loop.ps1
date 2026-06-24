#!/usr/bin/env pwsh
<#
.SYNOPSIS
  TeslaSync React Native parity autonomous loop.

.DESCRIPTION
  Runs prompts in apps/native/prompts until each records EXIT=0 and
  STATUS=DONE, or until MaxAttempts is reached. The runner parses prompt
  transcripts, not just process exit codes, so red-as-green cannot pass.
#>

param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path,
    [string]$PromptRoot = (Join-Path $PSScriptRoot "..\prompts"),
    [string]$StateRoot = (Join-Path $PSScriptRoot "..\.loop-state"),
    [string]$LogRoot = (Join-Path $PSScriptRoot "..\loop-logs"),
    [int]$MaxAttempts = 6,
    [int]$TimeoutMinutes = 240,
    [int]$IdleTimeoutMinutes = 75,
    [int]$PollSeconds = 10,
    [switch]$DryRun = $false,
    [switch]$Once = $false,
    [switch]$NoDiscord = $false
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $StateRoot, $LogRoot | Out-Null
$donePath = Join-Path $StateRoot "done.txt"
$attemptPath = Join-Path $StateRoot "attempts.json"
$eventPath = Join-Path $StateRoot "events.jsonl"

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

function Test-TranscriptResult {
    param([string]$Path, [bool]$TimedOut)
    if ($TimedOut) { return [pscustomobject]@{ Done = $false; Reason = "timeout-or-idle" } }
    if (-not (Test-Path $Path)) { return [pscustomobject]@{ Done = $false; Reason = "missing transcript" } }
    $text = Get-Content $Path -Raw
    $hasDone = $text -match '(?m)^STATUS=DONE\s*$'
    $hasExitZero = $text -match '(?m)^EXIT=0\s*$'
    $hasBlocked = $text -match '(?m)^STATUS=BLOCKED\s*$'
    $hasNonZeroExit = $text -match '(?m)^EXIT=(?!0\s*$)\d+\s*$'
    if ($hasDone -and $hasExitZero -and -not $hasBlocked -and -not $hasNonZeroExit) {
        return [pscustomobject]@{ Done = $true; Reason = "done" }
    }
    if ($hasBlocked -or $hasNonZeroExit) {
        return [pscustomobject]@{ Done = $false; Reason = "blocked marker" }
    }
    return [pscustomobject]@{ Done = $false; Reason = "missing final markers" }
}

function New-RunPrompt {
    param([string]$PromptPath, [string]$TranscriptPath, [int]$Attempt)
    $promptText = Get-Content $PromptPath -Raw
    $rel = Resolve-Path -Path $PromptPath -Relative
    $header = @"
You are running inside the TeslaSync React Native parity loop.

Repository root: $RepoRoot
Native app root: $RepoRoot\apps\native
Prompt file: $rel
Attempt: $Attempt / $MaxAttempts

Loop contract:
- Do not wait for user approval between phases.
- Do not use Electron, WebView, or browser embedding.
- Keep working until this prompt is STATUS=DONE or honestly STATUS=BLOCKED.
- If STATUS=DONE, commit completed code changes with the Copilot co-author trailer.
- If STATUS=BLOCKED, explain the blocker and do not claim completion.
- End your final response with EXIT=<int> and STATUS=<DONE|BLOCKED> on their own lines.
- Do not modify unrelated pre-existing web EOL-only dirty files.

"@
    $inputPath = [IO.Path]::ChangeExtension($TranscriptPath, ".prompt.txt")
    ($header + "`n" + $promptText) | Set-Content -Path $inputPath -Encoding UTF8
    return $inputPath
}

function Invoke-OnePrompt {
    param($Prompt, [int]$Attempt)
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $safeName = [IO.Path]::GetFileNameWithoutExtension($Prompt.Name)
    $transcript = Join-Path $LogRoot "$stamp-$safeName-attempt-$Attempt.log"
    $input = New-RunPrompt -PromptPath $Prompt.FullName -TranscriptPath $transcript -Attempt $Attempt
    $runner = Join-Path $LogRoot "$stamp-$safeName-runner.ps1"
    @"
Set-Location '$RepoRoot'
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
            return [pscustomobject]@{ Transcript = $transcript; TimedOut = $true }
        }
    }
    return [pscustomobject]@{ Transcript = $transcript; TimedOut = $false }
}

$prompts = @(Get-ChildItem $PromptRoot -Filter "*.prompt.md" -File | Sort-Object Name)
if ($prompts.Count -eq 0) { throw "No prompts found under $PromptRoot" }

$doneSet = Read-DoneSet
$attempts = Read-Attempts
$loopPass = 0

Send-Discord "**TeslaSync React Native parity loop started**`nPrompts: $($prompts.Count)`nDone: $($doneSet.Count)/$($prompts.Count)`nRepo: $RepoRoot"

do {
    $loopPass++
    $progressThisPass = $false
    foreach ($prompt in $prompts) {
        $id = $prompt.Name
        if ($doneSet.Contains($id)) { continue }
        $attempt = 1 + [int]($attempts[$id] ?? 0)
        if ($attempt -gt $MaxAttempts) {
            Write-LoopEvent @{ event = "max-attempts"; prompt = $id; attempts = $attempt - 1 }
            continue
        }
        if ($DryRun) {
            Write-Host "START $id attempt $attempt/$MaxAttempts"
            continue
        }
        $attempts[$id] = $attempt
        Write-Attempts $attempts
        Write-Host "START $id attempt $attempt/$MaxAttempts"
        Write-LoopEvent @{ event = "start"; prompt = $id; attempt = $attempt; pass = $loopPass }

        $run = Invoke-OnePrompt -Prompt $prompt -Attempt $attempt
        $result = Test-TranscriptResult -Path $run.Transcript -TimedOut:$run.TimedOut
        if ($result.Done) {
            [void]$doneSet.Add($id)
            Write-DoneSet $doneSet
            $progressThisPass = $true
            Write-Host "DONE $id"
            Write-LoopEvent @{ event = "done"; prompt = $id; attempt = $attempt; transcript = $run.Transcript }
            Send-Discord "**RN parity prompt DONE**`n$id`nDone: $($doneSet.Count)/$($prompts.Count)"
        } else {
            Write-Host "BLOCKED $id - $($result.Reason)"
            Write-LoopEvent @{ event = "blocked"; prompt = $id; attempt = $attempt; reason = $result.Reason; transcript = $run.Transcript }
            Send-Discord "**RN parity prompt blocked; loop continues**`n$id`nReason: $($result.Reason)`nAttempt: $attempt/$MaxAttempts`nDone: $($doneSet.Count)/$($prompts.Count)"
        }
    }
    if ($Once -or $DryRun) { break }
} while ($doneSet.Count -lt $prompts.Count -and ($progressThisPass -or ($attempts.Values | Where-Object { [int]$_ -lt $MaxAttempts }).Count -gt 0))

$summary = "DONE=$($doneSet.Count)/$($prompts.Count)"
Write-Host $summary
Write-LoopEvent @{ event = "summary"; done = $doneSet.Count; total = $prompts.Count }
Send-Discord "**TeslaSync React Native parity loop stopped**`n$summary"

if ($DryRun) { exit 0 }
if ($doneSet.Count -eq $prompts.Count) { exit 0 }
exit 1
