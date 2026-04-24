---
description: "Phase-12 — Gate: build + integration test (replay → verify)"
---
# Prompt 06 — Gate: Build + TSC + Integration Verification
> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-12-06-gate.log` |
| Allowed files to change | NONE (read-only verification), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 00–05

## Step 1 — Go build

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-12-06-gate.log"
$env:CGO_ENABLED = "0"
"=== GO BUILD ===" | Tee-Object -FilePath $log
go build ./... 2>&1 | Tee-Object -FilePath $log -Append
$goBuild = $LASTEXITCODE
"GO_BUILD_EXIT=$goBuild" | Tee-Object -FilePath $log -Append
```

## Step 2 — TypeScript compile

```powershell
"=== TSC ===" | Tee-Object -FilePath $log -Append
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Tee-Object -FilePath $log -Append
$tsc = $LASTEXITCODE
"TSC_EXIT=$tsc" | Tee-Object -FilePath $log -Append
```

## Step 3 — Docker rebuild + restart

```powershell
"=== DOCKER BUILD ===" | Tee-Object -FilePath $log -Append
cd D:\repos\teslasync
docker compose build teslasync-api 2>&1 | Select-Object -Last 5 | Tee-Object -FilePath $log -Append
docker compose up -d teslasync-api 2>&1 | Tee-Object -FilePath $log -Append
Start-Sleep 10
docker ps --format "table {{.Names}}\t{{.Status}}" --filter "name=teslasync-api" | Tee-Object -FilePath $log -Append
```

## Step 4 — Verify signal_history is hypertable

```powershell
"=== HYPERTABLE CHECK ===" | Tee-Object -FilePath $log -Append
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = 'signal_history';" 2>&1 | Tee-Object -FilePath $log -Append
```

## Step 5 — Verify Redis HSET has signal data

```powershell
"=== REDIS SIGNAL CHECK ===" | Tee-Object -FilePath $log -Append
docker exec teslasync-redis redis-cli HLEN vehicle:1:signals 2>&1 | Tee-Object -FilePath $log -Append
docker exec teslasync-redis redis-cli HGET vehicle:1:signals Gear 2>&1 | Tee-Object -FilePath $log -Append
docker exec teslasync-redis redis-cli HGET vehicle:1:signals BatteryLevel 2>&1 | Tee-Object -FilePath $log -Append
```

## Step 6 — Verify point-in-time reconstruction query

```powershell
"=== PIT QUERY CHECK ===" | Tee-Object -FilePath $log -Append
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "
SELECT DISTINCT ON (signal) signal,
  COALESCE(value_num::text, value_str, value_bool::text) as value,
  created_at
FROM signal_history
WHERE vehicle_id = 1 AND created_at <= NOW()
ORDER BY signal, created_at DESC
LIMIT 20;" 2>&1 | Tee-Object -FilePath $log -Append
```

## Step 7 — API scan (31 endpoints)

```powershell
"=== API SCAN ===" | Tee-Object -FilePath $log -Append
$endpoints = @("/api/v1/vehicles","/api/v1/vehicles/1","/api/v1/vehicles/1/state","/api/v1/vehicles/1/energy","/api/v1/vehicles/1/energy/flow","/api/v1/drives?vehicle_id=1","/api/v1/drives/stats?vehicle_id=1","/api/v1/drives/score?vehicle_id=1","/api/v1/drives/dynamics?vehicle_id=1","/api/v1/charging?vehicle_id=1","/api/v1/analytics/fleet?vehicle_id=1","/api/v1/analytics/tco?vehicle_id=1","/api/v1/analytics/regen?vehicle_id=1","/api/v1/analytics/battery-health?vehicle_id=1","/api/v1/analytics/speed-profile?vehicle_id=1","/api/v1/analytics/temperature-impact?vehicle_id=1","/api/v1/analytics/energy?vehicle_id=1","/api/v1/analytics/lifetime?vehicle_id=1","/api/v1/analytics/year-review?vehicle_id=1","/api/v1/analytics/sleep?vehicle_id=1","/api/v1/analytics/charging-optimizer?vehicle_id=1","/api/v1/tire-pressure?vehicle_id=1","/api/v1/locations?vehicle_id=1","/api/v1/trips?vehicle_id=1","/api/v1/vampire-drain?vehicle_id=1","/api/v1/geofences","/api/v1/automations","/api/v1/notifications","/api/v1/settings","/api/v1/export/jobs","/api/v1/system/health")
$pass=0;$fail=0
foreach($ep in $endpoints){try{Invoke-WebRequest -Uri "http://localhost:8080$ep" -TimeoutSec 5 -ErrorAction Stop|Out-Null;$pass++}catch{$fail++;Write-Host "FAIL: $ep"}}
"API: $pass/$($pass+$fail) passing" | Tee-Object -FilePath $log -Append
```

## Step 8 — Check runtime errors

```powershell
"=== RUNTIME ERRORS ===" | Tee-Object -FilePath $log -Append
$errs = docker logs teslasync-api --since 2m 2>&1 | Select-String "error|ERROR|panic"
"Runtime errors: $($errs.Count)" | Tee-Object -FilePath $log -Append
if ($errs.Count -gt 0) { $errs | Tee-Object -FilePath $log -Append }
```

## Step 9 — Summary

```powershell
"=== GATE ===" | Tee-Object -FilePath $log -Append
if ($goBuild -ne 0 -or $tsc -ne 0) {
  "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  exit 1
}
"STATUS=DONE" | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
```
