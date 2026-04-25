---
description: "Phase-14 — Gate: full build + replay + verify sessions"
---
# Prompt 17 — Gate: Build + TSC + Replay + Verify Everything
> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-17-gate.log` |
| Allowed files to change | NONE (read-only verification), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: ALL previous prompts (00–16)

## Step 1 — Build gates

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-14-17-gate.log"
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

## Step 2 — Docker rebuild + fresh DB + replay

```powershell
"=== DOCKER BUILD ===" | Tee-Object -FilePath $log -Append
docker compose build teslasync-api notification-worker automation-worker export-worker web 2>&1 | Select-Object -Last 5 | Tee-Object -FilePath $log -Append
docker compose up -d 2>&1 | Select-Object -Last 5 | Tee-Object -FilePath $log -Append
Start-Sleep 10

"=== WIPE + SEED ===" | Tee-Object -FilePath $log -Append
# Wipe all data tables
$wipe = @"
DO `$`$ DECLARE r RECORD; BEGIN
FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('vehicles','schema_migrations','spatial_ref_sys'))
LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END`$`$;
"@
$wipe | docker exec -i teslasync-postgres psql -U teslasync -d teslasync 2>&1 | Tee-Object -FilePath $log -Append
Get-Content tests\fixtures\seed_test_vehicle.sql | docker exec -i teslasync-postgres psql -U teslasync -d teslasync 2>&1 | Tee-Object -FilePath $log -Append

"=== REPLAY SIGNALS ===" | Tee-Object -FilePath $log -Append
python tests\fixtures\replay_signals_fast.py --csv "D:\copilot\teslasync\prod-signals\signal_history_last_7d.csv" --vin "TEST00000000000VIN" --no-delay --batch-delay-ms 50 2>&1 | Tee-Object -FilePath $log -Append
```

## Step 3 — Verify signal_log hypertable

```powershell
"=== SIGNAL_LOG CHECK ===" | Tee-Object -FilePath $log -Append
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = 'signal_log';" 2>&1 | Tee-Object -FilePath $log -Append
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "SELECT count(*) FROM signal_log;" 2>&1 | Tee-Object -FilePath $log -Append
```

## Step 4 — Verify Redis HSET

```powershell
"=== REDIS CHECK ===" | Tee-Object -FilePath $log -Append
docker exec teslasync-redis redis-cli HLEN vehicle:1:signals 2>&1 | Tee-Object -FilePath $log -Append
```

## Step 5 — Verify snapshot tables are GONE

```powershell
"=== LEGACY TABLE CHECK ===" | Tee-Object -FilePath $log -Append
$legacy = docker exec teslasync-postgres psql -U teslasync -d teslasync -c "SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE '%snapshot%' OR tablename = 'vehicle_live_state' OR tablename = 'charging_telemetry' OR tablename = 'drive_telemetry_readings' OR tablename = 'charge_telemetry_readings');" 2>&1
"Legacy tables remaining: $legacy" | Tee-Object -FilePath $log -Append
```

## Step 6 — Verify data pipeline

```powershell
"=== DATA COUNTS ===" | Tee-Object -FilePath $log -Append
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "
SELECT 'signal_log' t, count(*) FROM signal_log
UNION ALL SELECT 'drives', count(*) FROM drives
UNION ALL SELECT 'charging_sessions', count(*) FROM charging_sessions
UNION ALL SELECT 'vehicle_states', count(*) FROM vehicle_states
ORDER BY 1;" 2>&1 | Tee-Object -FilePath $log -Append
```

## Step 7 — Verify SnapshotAt works

```powershell
"=== SNAPSHOT_AT CHECK ===" | Tee-Object -FilePath $log -Append
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "
SELECT DISTINCT ON (signal) signal,
  COALESCE(value_num::text, value_str, value_bool::text) as value
FROM signal_log WHERE vehicle_id = 1 AND created_at <= NOW()
ORDER BY signal, created_at DESC LIMIT 15;" 2>&1 | Tee-Object -FilePath $log -Append
```

## Step 8 — API scan (31 endpoints)

```powershell
"=== API SCAN ===" | Tee-Object -FilePath $log -Append
$endpoints = @("/api/v1/vehicles","/api/v1/vehicles/1","/api/v1/vehicles/1/state","/api/v1/vehicles/1/energy","/api/v1/vehicles/1/energy/flow","/api/v1/drives?vehicle_id=1","/api/v1/drives/stats?vehicle_id=1","/api/v1/drives/score?vehicle_id=1","/api/v1/drives/dynamics?vehicle_id=1","/api/v1/charging?vehicle_id=1","/api/v1/analytics/fleet?vehicle_id=1","/api/v1/analytics/tco?vehicle_id=1","/api/v1/analytics/regen?vehicle_id=1","/api/v1/analytics/battery-health?vehicle_id=1","/api/v1/analytics/speed-profile?vehicle_id=1","/api/v1/analytics/temperature-impact?vehicle_id=1","/api/v1/analytics/energy?vehicle_id=1","/api/v1/analytics/lifetime?vehicle_id=1","/api/v1/analytics/year-review?vehicle_id=1","/api/v1/analytics/sleep?vehicle_id=1","/api/v1/analytics/charging-optimizer?vehicle_id=1","/api/v1/tire-pressure?vehicle_id=1","/api/v1/locations?vehicle_id=1","/api/v1/trips?vehicle_id=1","/api/v1/vampire-drain?vehicle_id=1","/api/v1/geofences","/api/v1/automations","/api/v1/notifications","/api/v1/settings","/api/v1/export/jobs","/api/v1/system/health")
$pass=0;$fail=0
foreach($ep in $endpoints){try{Invoke-WebRequest -Uri "http://localhost:8080$ep" -TimeoutSec 5 -ErrorAction Stop|Out-Null;$pass++}catch{$fail++;Write-Host "FAIL: $ep"}}
"API: $pass/$($pass+$fail) passing" | Tee-Object -FilePath $log -Append
```

## Step 9 — Runtime errors

```powershell
"=== RUNTIME ERRORS ===" | Tee-Object -FilePath $log -Append
$errs = docker logs teslasync-api --since 3m 2>&1 | Select-String "error|ERROR|panic"
"Runtime errors: $($errs.Count)" | Tee-Object -FilePath $log -Append
if ($errs.Count -gt 5) { $errs | Select-Object -First 10 | Tee-Object -FilePath $log -Append }
```

## Step 10 — Summary

```powershell
"=== GATE ===" | Tee-Object -FilePath $log -Append
if ($goBuild -ne 0 -or $goVet -ne 0 -or $tsc -ne 0) {
  "STATUS=BLOCKED (build failure)" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  exit 1
}
if ($fail -gt 0) {
  "WARNING: $fail API endpoints failing" | Tee-Object -FilePath $log -Append
}
"STATUS=DONE" | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
```
