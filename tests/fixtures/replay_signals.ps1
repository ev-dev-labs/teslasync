#!/usr/bin/env pwsh
# tests/fixtures/replay_signals.ps1
#
# Replays production signal data against local MQTT broker for integration testing.
# Reads a CSV exported from signal_history, publishes each signal to mosquitto
# on topic: telemetry/{VIN}/v/{SignalName}
#
# Usage:
#   .\tests\fixtures\replay_signals.ps1 -CsvPath "D:\copilot\teslasync\prod-signals\signal_history_last_7d.csv" -Vin "TEST00000000000VIN"
#   .\tests\fixtures\replay_signals.ps1 -CsvPath "..." -Vin "..." -SpeedMultiplier 10 -StartTime "2026-04-18 00:22:00" -EndTime "2026-04-18 00:46:30"
#
# Prerequisites:
#   - docker compose up (mosquitto on localhost:1883)
#   - mosquitto_pub available inside teslasync-mosquitto container
#   - Test vehicle seeded (run seed_test_vehicle.sql first)

param(
    [Parameter(Mandatory)][string]$CsvPath,
    [Parameter(Mandatory)][string]$Vin,
    [string]$StartTime,
    [string]$EndTime,
    [int]$SpeedMultiplier = 10,       # 10x = 24 min replays in 2.4 min
    [switch]$DryRun,                   # Print but don't publish
    [string]$MqttContainer = "teslasync-mosquitto",
    [string]$MqttHost = "localhost",
    [int]$MqttPort = 1883
)

$ErrorActionPreference = "Stop"

# Load CSV
Write-Host "Loading $CsvPath..." -ForegroundColor Cyan
$data = Import-Csv $CsvPath

# Filter by time window if specified
if ($StartTime) {
    $data = $data | Where-Object { $_.created_at -ge $StartTime }
}
if ($EndTime) {
    $data = $data | Where-Object { $_.created_at -le $EndTime }
}

$data = $data | Sort-Object created_at
$total = $data.Count
Write-Host "Signals to replay: $total" -ForegroundColor Green
if ($total -eq 0) { Write-Host "No signals in window. Exiting."; exit 1 }

$firstTs = [DateTimeOffset]::Parse($data[0].created_at)
$lastTs = [DateTimeOffset]::Parse($data[-1].created_at)
$duration = $lastTs - $firstTs
$replayDuration = $duration.TotalSeconds / $SpeedMultiplier
Write-Host "Time window: $($firstTs.ToString('HH:mm:ss')) -> $($lastTs.ToString('HH:mm:ss')) ($([math]::Round($duration.TotalMinutes, 1)) min)"
Write-Host "Replay speed: ${SpeedMultiplier}x (will take ~$([math]::Round($replayDuration / 60, 1)) min)" -ForegroundColor Yellow
Write-Host "VIN: $Vin" -ForegroundColor Yellow
Write-Host "MQTT: $MqttContainer ($MqttHost`:$MqttPort)" -ForegroundColor Yellow
if ($DryRun) { Write-Host "DRY RUN — no messages will be published" -ForegroundColor Red }
Write-Host ""

# Test MQTT connectivity
if (-not $DryRun) {
    $testResult = docker exec $MqttContainer mosquitto_pub -h $MqttHost -p $MqttPort -t "test/ping" -m "replay-test" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "MQTT connectivity test failed: $testResult" -ForegroundColor Red
        exit 1
    }
    Write-Host "MQTT connectivity OK" -ForegroundColor Green
}

# Stats
$published = 0
$skipped = 0
$errors = 0
$signalCounts = @{}
$startWall = Get-Date
$prevDataTs = $firstTs

Write-Host ""
Write-Host "=== REPLAY STARTED ===" -ForegroundColor Green
Write-Host ""

foreach ($row in $data) {
    $signal = $row.signal
    $dataTs = [DateTimeOffset]::Parse($row.created_at)

    # Compute delay (real time gap / speed multiplier)
    $gap = ($dataTs - $prevDataTs).TotalMilliseconds / $SpeedMultiplier
    if ($gap -gt 10 -and $gap -lt 30000) {  # 10ms min, 30s max
        Start-Sleep -Milliseconds ([math]::Max(1, [int]$gap))
    }
    $prevDataTs = $dataTs

    # Determine payload value
    $value = if ($row.value_num) { $row.value_num }
             elseif ($row.value_str) { $row.value_str }
             elseif ($row.value_bool -eq 't') { "true" }
             elseif ($row.value_bool -eq 'f') { "false" }
             else { "" }

    if ($value -eq "") { $skipped++; continue }

    $topic = "telemetry/$Vin/v/$signal"

    if ($DryRun) {
        if ($signal -eq 'Gear' -or $signal -eq 'VehicleSpeed' -or $published % 500 -eq 0) {
            Write-Host "  [DRY] $($dataTs.ToString('HH:mm:ss.fff')) $topic = $value"
        }
    } else {
        $result = docker exec $MqttContainer mosquitto_pub -h $MqttHost -p $MqttPort -t $topic -m "$value" 2>&1
        if ($LASTEXITCODE -ne 0) {
            $errors++
            if ($errors -le 5) { Write-Host "  ERROR: $topic = $value → $result" -ForegroundColor Red }
        }
    }

    $published++
    if (-not $signalCounts[$signal]) { $signalCounts[$signal] = 0 }
    $signalCounts[$signal]++

    # Progress every 500 signals or on key events
    if ($signal -eq 'Gear' -or $signal -eq 'VehicleSpeed') {
        $elapsed = ((Get-Date) - $startWall).TotalSeconds
        Write-Host "  $($dataTs.ToString('HH:mm:ss')) $signal = $value  ($published/$total, ${elapsed}s elapsed)" -ForegroundColor Cyan
    } elseif ($published % 500 -eq 0) {
        $elapsed = ((Get-Date) - $startWall).TotalSeconds
        $pct = [math]::Round($published / $total * 100, 1)
        Write-Host "  [$pct%] $published/$total signals published (${elapsed}s elapsed)" -ForegroundColor DarkGray
    }
}

$totalElapsed = ((Get-Date) - $startWall).TotalSeconds

Write-Host ""
Write-Host "=== REPLAY COMPLETE ===" -ForegroundColor Green
Write-Host "  Published: $published" -ForegroundColor Green
Write-Host "  Skipped:   $skipped (empty value)" -ForegroundColor Yellow
Write-Host "  Errors:    $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Green" })
Write-Host "  Duration:  $([math]::Round($totalElapsed, 1))s (${SpeedMultiplier}x speed)"
Write-Host "  Unique signals: $($signalCounts.Count)"
Write-Host ""
Write-Host "Top 10 signals by count:" -ForegroundColor Cyan
$signalCounts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 10 | ForEach-Object {
    Write-Host "  $($_.Value.ToString().PadLeft(6)) $($_.Key)"
}
Write-Host ""
Write-Host "Next: Run verification queries from EXPECTED_RESULTS.md" -ForegroundColor Yellow
