---
description: "Phase-15 — Gate: build + vet + tsc + zero dropped-table refs + Docker"
---
# Prompt 06 — Gate: Full Verification
> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-15-06-gate.log` |
| Allowed files to change | NONE (read-only verification), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 00–05

## Step 1 — Build + Vet + TSC

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-15-06-gate.log"
$env:CGO_ENABLED = "0"

"=== GO BUILD ===" | Tee-Object -FilePath $log
go build ./... 2>&1 | Tee-Object -FilePath $log -Append
$goBuild = $LASTEXITCODE
"GO_BUILD_EXIT=$goBuild" | Tee-Object -FilePath $log -Append

"=== GO VET ===" | Tee-Object -FilePath $log -Append
go vet ./... 2>&1 | Tee-Object -FilePath $log -Append
$goVet = $LASTEXITCODE
"GO_VET_EXIT=$goVet" | Tee-Object -FilePath $log -Append

"=== TSC ===" | Tee-Object -FilePath $log -Append
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Tee-Object -FilePath $log -Append
$tsc = $LASTEXITCODE
"TSC_EXIT=$tsc" | Tee-Object -FilePath $log -Append
cd D:\repos\teslasync
```

## Step 2 — Zero dropped-table references scan

```powershell
"=== DROPPED TABLE SCAN ===" | Tee-Object -FilePath $log -Append
$dropped = Select-String -Path (Get-ChildItem -Recurse internal\*.go -Exclude *_test.go) -Pattern "battery_snapshots|vehicle_meta_snapshots|motor_snapshots|climate_snapshots|location_snapshots|safety_snapshots|tire_pressure_snapshots|user_preference_snapshots|vehicle_live_state|charging_telemetry[^_]|drive_telemetry_readings" | Where-Object { $_.Line -notmatch '^\s*//' -and $_.Line -notmatch 'signal_log|// (removed|dropped|legacy)' }
"Dropped table refs (non-test, non-comment): $($dropped.Count)" | Tee-Object -FilePath $log -Append
if ($dropped.Count -gt 0) { $dropped | Tee-Object -FilePath $log -Append }
```

## Step 3 — Docker rebuild + replay + API scan

```powershell
"=== DOCKER BUILD ===" | Tee-Object -FilePath $log -Append
docker compose build teslasync-api notification-worker automation-worker export-worker web 2>&1 | Select-Object -Last 5 | Tee-Object -FilePath $log -Append
docker compose up -d 2>&1 | Select-Object -Last 3 | Tee-Object -FilePath $log -Append
Start-Sleep 10

"=== WIPE + SEED + REPLAY ===" | Tee-Object -FilePath $log -Append
$wipe = "DO `$`$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('vehicles','schema_migrations','spatial_ref_sys')) LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END`$`$;"
$wipe | docker exec -i teslasync-postgres psql -U teslasync -d teslasync 2>&1 | Tee-Object -FilePath $log -Append
Start-Sleep 2
Get-Content tests\fixtures\seed_test_vehicle.sql | docker exec -i teslasync-postgres psql -U teslasync -d teslasync 2>&1 | Tee-Object -FilePath $log -Append
python tests\fixtures\replay_signals_fast.py --csv "D:\copilot\teslasync\prod-signals\signal_history_last_7d.csv" --vin "TEST00000000000VIN" --no-delay --batch-delay-ms 50 2>&1 | Select-Object -Last 10 | Tee-Object -FilePath $log -Append

"=== API SCAN ===" | Tee-Object -FilePath $log -Append
$endpoints = @("/api/v1/vehicles","/api/v1/vehicles/1","/api/v1/vehicles/1/state","/api/v1/vehicles/1/energy","/api/v1/vehicles/1/energy/flow","/api/v1/drives?vehicle_id=1","/api/v1/drives/stats?vehicle_id=1","/api/v1/drives/score?vehicle_id=1","/api/v1/drives/dynamics?vehicle_id=1","/api/v1/charging?vehicle_id=1","/api/v1/analytics/fleet?vehicle_id=1","/api/v1/analytics/tco?vehicle_id=1","/api/v1/analytics/regen?vehicle_id=1","/api/v1/analytics/battery-health?vehicle_id=1","/api/v1/analytics/speed-profile?vehicle_id=1","/api/v1/analytics/temperature-impact?vehicle_id=1","/api/v1/analytics/energy?vehicle_id=1","/api/v1/analytics/lifetime?vehicle_id=1","/api/v1/analytics/year-review?vehicle_id=1","/api/v1/analytics/sleep?vehicle_id=1","/api/v1/analytics/charging-optimizer?vehicle_id=1","/api/v1/tire-pressure?vehicle_id=1","/api/v1/locations?vehicle_id=1","/api/v1/trips?vehicle_id=1","/api/v1/vampire-drain?vehicle_id=1","/api/v1/geofences","/api/v1/automations","/api/v1/notifications","/api/v1/settings","/api/v1/export/jobs","/api/v1/system/health")
$pass=0;$fail=0
foreach($ep in $endpoints){try{Invoke-WebRequest -Uri "http://localhost:8080$ep" -TimeoutSec 5 -ErrorAction Stop|Out-Null;$pass++}catch{$fail++;Write-Host "FAIL: $ep"}}
"API: $pass/$($pass+$fail) passing" | Tee-Object -FilePath $log -Append

"=== RUNTIME ERRORS ===" | Tee-Object -FilePath $log -Append
$errs = docker logs teslasync-api --since 2m 2>&1 | Select-String "error|ERROR" | Where-Object { $_ -notmatch "no stored tokens" }
"Runtime errors: $($errs.Count)" | Tee-Object -FilePath $log -Append
```

## Step 4 — Summary

```powershell
"=== GATE ===" | Tee-Object -FilePath $log -Append
if ($goBuild -ne 0 -or $goVet -ne 0 -or $tsc -ne 0) {
  "STATUS=BLOCKED (build/vet/tsc failure)" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  exit 1
}
if ($dropped.Count -gt 0) {
  "STATUS=BLOCKED (dropped table refs remain)" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  exit 1
}
"STATUS=DONE" | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
```
