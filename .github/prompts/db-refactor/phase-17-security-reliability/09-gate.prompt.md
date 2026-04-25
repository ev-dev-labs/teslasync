---
description: "Phase-17 — Gate: build + vet + tsc + security regression checks"
---
# Prompt 09 — Gate: Full Verification
> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-17-09-gate.log` |
| Allowed files to change | NONE (read-only verification), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 00–08

## Step 1 — Build + Vet + TSC

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-17-09-gate.log"
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

## Step 2 — SQL injection fixed (Prompt 00)

```powershell
"=== SQL INJECTION CHECK ===" | Tee-Object -FilePath $log -Append
$sqlInject = Select-String -Path internal\backup\processor.go -Pattern 'Sprintf.*FROM.*%s'
"Unvalidated Sprintf+FROM+%s in processor.go: $($sqlInject.Count)" | Tee-Object -FilePath $log -Append
if ($sqlInject.Count -gt 0) { $sqlInject | Tee-Object -FilePath $log -Append }
```

## Step 3 — Query param key removed (Prompt 03)

```powershell
"=== QUERY PARAM KEY CHECK ===" | Tee-Object -FilePath $log -Append
$queryKey = Select-String -Path internal\api\apikey_middleware.go -Pattern 'Query\(\)\.Get\("key"\)'
"Query().Get(""key"") in apikey_middleware.go: $($queryKey.Count)" | Tee-Object -FilePath $log -Append
if ($queryKey.Count -gt 0) { $queryKey | Tee-Object -FilePath $log -Append }
```

## Step 4 — SSE terminal state removed (Prompt 04)

```powershell
"=== SSE UNAVAILABLE CHECK ===" | Tee-Object -FilePath $log -Append
cd D:\repos\teslasync\web
$unavailable = Get-ChildItem -Recurse src\*.ts,src\*.tsx | Select-String 'unavailable'
"'unavailable' across web/src/: $($unavailable.Count)" | Tee-Object -FilePath $log -Append
if ($unavailable.Count -gt 0) { $unavailable | Tee-Object -FilePath $log -Append }
cd D:\repos\teslasync
```

## Step 5 — Config deprecation documented (Prompt 07)

```powershell
"=== CONFIG DEPRECATION CHECK ===" | Tee-Object -FilePath $log -Append
$deprecated = Select-String -Path internal\platform\config\config.go -Pattern 'Deprecated'
"'Deprecated' in platform/config/config.go: $($deprecated.Count)" | Tee-Object -FilePath $log -Append
```

## Step 6 — Graceful shutdown WaitGroup (Prompt 05)

```powershell
"=== WAITGROUP CHECK ===" | Tee-Object -FilePath $log -Append
$wg = Select-String -Path internal\notification\worker.go,internal\export\worker.go -Pattern 'WaitGroup|wg\.Wait|\.wg\.'
"WaitGroup in worker packages: $($wg.Count)" | Tee-Object -FilePath $log -Append
$shutdown = Select-String -Path cmd\notification-worker\main.go,cmd\export-worker\main.go -Pattern 'Shutdown\(\)'
"Shutdown() calls in main.go: $($shutdown.Count)" | Tee-Object -FilePath $log -Append
```

## Step 7 — API scan

```powershell
"=== API SCAN ===" | Tee-Object -FilePath $log -Append
docker compose build teslasync-api web 2>&1 | Select-Object -Last 5 | Tee-Object -FilePath $log -Append
docker compose up -d 2>&1 | Select-Object -Last 3 | Tee-Object -FilePath $log -Append
Start-Sleep 10

$endpoints = @(
  "/api/v1/vehicles","/api/v1/vehicles/1","/api/v1/vehicles/1/state",
  "/api/v1/drives?vehicle_id=1","/api/v1/charging?vehicle_id=1",
  "/api/v1/analytics/fleet?vehicle_id=1","/api/v1/settings",
  "/api/v1/system/health"
)
$pass=0;$fail=0;$failList=@()
foreach($ep in $endpoints){
  try{Invoke-WebRequest -Uri "http://localhost:8080$ep" -TimeoutSec 5 -ErrorAction Stop|Out-Null;$pass++}
  catch{$fail++;$failList+=$ep;Write-Host "FAIL: $ep"}
}
"API: $pass/$($pass+$fail) passing" | Tee-Object -FilePath $log -Append
if ($fail -gt 0) { "Failed endpoints:" | Tee-Object -FilePath $log -Append; $failList | Tee-Object -FilePath $log -Append }
```

## Step 8 — Runtime error check

```powershell
"=== RUNTIME ERRORS ===" | Tee-Object -FilePath $log -Append
$errs = docker logs teslasync-api --since 2m 2>&1 | Select-String "error|ERROR" | Where-Object { $_ -notmatch "no stored tokens" }
"Runtime errors: $($errs.Count)" | Tee-Object -FilePath $log -Append
```

## Step 9 — Summary (GATE DECISION)

```powershell
"=== GATE ===" | Tee-Object -FilePath $log -Append

$blocked = $false
$reasons = @()

if ($goBuild -ne 0) { $blocked = $true; $reasons += "go build failed" }
if ($goVet -ne 0) { $blocked = $true; $reasons += "go vet failed" }
if ($tsc -ne 0) { $blocked = $true; $reasons += "tsc failed" }
if ($sqlInject.Count -gt 0) { $blocked = $true; $reasons += "SQL injection not fixed: Sprintf+FROM+%s in processor.go" }
if ($queryKey.Count -gt 0) { $blocked = $true; $reasons += "query param ?key= still in apikey_middleware.go" }
if ($unavailable.Count -gt 0) { $blocked = $true; $reasons += "'unavailable' state still in web/src/: $($unavailable.Count) refs" }
if ($deprecated.Count -eq 0) { $blocked = $true; $reasons += "Deprecated comment missing in platform/config/config.go" }
if ($wg.Count -lt 2) { $blocked = $true; $reasons += "WaitGroup missing in worker packages (found $($wg.Count), need 2+)" }
if ($shutdown.Count -lt 2) { $blocked = $true; $reasons += "Shutdown() not called in both main.go (found $($shutdown.Count), need 2)" }
if ($fail -gt 0) { $blocked = $true; $reasons += "API endpoints failed: $fail" }

if ($blocked) {
  "STATUS=BLOCKED ($($reasons -join '; '))" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  exit 1
}

"STATUS=DONE" | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
```
