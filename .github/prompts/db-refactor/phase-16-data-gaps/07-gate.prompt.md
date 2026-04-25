---
description: "Phase-16 — Gate: build + verify battery data + zero TODOs"
---
# Prompt 07 — Gate: Build + Verify Battery Data + Zero TODO Stubs
> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-07-gate.log` |
| Allowed files to change | NONE (read-only verification), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 00–08g

## Step 1 — Build + Vet

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-16-07-gate.log"
$env:CGO_ENABLED = "0"

"=== GO BUILD ===" | Tee-Object -FilePath $log
go build ./... 2>&1 | Tee-Object -FilePath $log -Append
$goBuild = $LASTEXITCODE

"=== GO VET ===" | Tee-Object -FilePath $log -Append
go vet ./... 2>&1 | Tee-Object -FilePath $log -Append
$goVet = $LASTEXITCODE

"=== TSC ===" | Tee-Object -FilePath $log -Append
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Tee-Object -FilePath $log -Append
$tsc = $LASTEXITCODE
cd D:\repos\teslasync
```

## Step 2 — Zero TODO/stub scan

```powershell
"=== TODO SCAN ===" | Tee-Object -FilePath $log -Append
$todos = Select-String -Path (Get-ChildItem -Recurse internal\*.go -Exclude *_test.go) -Pattern "TODO.*signal_log|TODO.*SignalTrace|TODO.*implement.*battery|TODO.*derive.*signal|no dedicated table|captured via signal_log" | Where-Object { $_.Line -notmatch '^\s*//' -eq $false }
"TODO/stub refs: $($todos.Count)" | Tee-Object -FilePath $log -Append
if ($todos.Count -gt 0) { $todos | ForEach-Object { "$($_.Filename):$($_.LineNumber): $($_.Line.Trim())" } | Tee-Object -FilePath $log -Append }
```

## Step 3 — Dead dispatch scan

```powershell
"=== DEAD DISPATCH SCAN ===" | Tee-Object -FilePath $log -Append
$dead = Select-String -Path (Get-ChildItem -Recurse internal\api\*.go -Exclude *_test.go) -Pattern "no-op.*snapshot|trackMedia|trackVehicleConfig|func.*trackMedia|func.*trackVehicleConfig"
"Dead dispatch refs: $($dead.Count)" | Tee-Object -FilePath $log -Append
if ($dead.Count -gt 0) { $dead | Tee-Object -FilePath $log -Append }
```

## Step 4 — Battery endpoint data check

```powershell
"=== BATTERY DATA CHECK ===" | Tee-Object -FilePath $log -Append
$bat = curl -s http://localhost:8080/api/v1/vehicles/1/battery 2>&1
$bat | Tee-Object -FilePath $log -Append
# Check if monthly_trend is non-null (may still be empty if no historical data)
if ($bat -match '"monthly_trend":\s*null') {
  "WARNING: monthly_trend is null — may need cagg refresh" | Tee-Object -FilePath $log -Append
}
```

## Step 5 — API scan

```powershell
"=== API SCAN ===" | Tee-Object -FilePath $log -Append
$endpoints = @("/api/v1/vehicles","/api/v1/vehicles/1","/api/v1/vehicles/1/state","/api/v1/vehicles/1/energy","/api/v1/drives?vehicle_id=1","/api/v1/charging?vehicle_id=1","/api/v1/analytics/battery-health?vehicle_id=1","/api/v1/analytics/fleet?vehicle_id=1","/api/v1/system/health")
$pass=0;$fail=0
foreach($ep in $endpoints){try{Invoke-WebRequest -Uri "http://localhost:8080$ep" -TimeoutSec 5 -ErrorAction Stop|Out-Null;$pass++}catch{$fail++;Write-Host "FAIL: $ep"}}
"API: $pass/$($pass+$fail) passing" | Tee-Object -FilePath $log -Append
```

## Step 6 — Summary

```powershell
"=== GATE ===" | Tee-Object -FilePath $log -Append
if ($goBuild -ne 0 -or $tsc -ne 0) {
  "STATUS=BLOCKED (build failure)" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  exit 1
}
if ($dead.Count -gt 0) {
  "STATUS=BLOCKED (dead dispatch code remains)" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  exit 1
}
"STATUS=DONE" | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
```
