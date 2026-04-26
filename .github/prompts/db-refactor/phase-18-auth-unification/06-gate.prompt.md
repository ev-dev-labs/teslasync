---
description: "Phase-18 — Gate: build + vet + tsc + auth unification regression checks"
---
# Prompt 06 — Gate: Full Verification
> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-18-06-gate.log` |
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
$log = ".github\prompts\db-refactor\logs\phase-18-06-gate.log"
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

## Step 2 — Authentik code fully removed

```powershell
"=== AUTHENTIK REMOVAL CHECK ===" | Tee-Object -FilePath $log -Append
$authentikBackend = Get-ChildItem -Recurse internal\*.go | Select-String 'AuthentikSSEAuth|SSETokenHandler'
"AuthentikSSEAuth/SSETokenHandler in internal/: $($authentikBackend.Count)" | Tee-Object -FilePath $log -Append
if ($authentikBackend.Count -gt 0) { $authentikBackend | Tee-Object -FilePath $log -Append }

$authentikFrontend = Get-ChildItem -Recurse web\src\*.ts,web\src\*.tsx | Select-String 'fetchSSEToken'
"fetchSSEToken in web/src/: $($authentikFrontend.Count)" | Tee-Object -FilePath $log -Append
if ($authentikFrontend.Count -gt 0) { $authentikFrontend | Tee-Object -FilePath $log -Append }
```

## Step 3 — ForwardAuth in place

```powershell
"=== FORWARD AUTH CHECK ===" | Tee-Object -FilePath $log -Append
$configRef = Select-String -Path internal\config\config.go -Pattern 'FORWARD_AUTH_HEADER'
"FORWARD_AUTH_HEADER in config.go: $($configRef.Count)" | Tee-Object -FilePath $log -Append

$middlewareRef = Select-String -Path internal\api\forward_auth_middleware.go -Pattern 'func ForwardAuthMiddleware'
"ForwardAuthMiddleware function: $($middlewareRef.Count)" | Tee-Object -FilePath $log -Append

$routerRef = Select-String -Path internal\api\router.go -Pattern 'ForwardAuthMiddleware'
"ForwardAuthMiddleware in router.go: $($routerRef.Count)" | Tee-Object -FilePath $log -Append
```

## Step 4 — No ?token= in SSE connections

```powershell
"=== SSE TOKEN CHECK ===" | Tee-Object -FilePath $log -Append
$tokenInSSE = Select-String -Path web\src\lib\sseManager.ts,web\src\lib\automationSSE.ts -Pattern 'token='
"?token= in SSE files: $($tokenInSSE.Count)" | Tee-Object -FilePath $log -Append
if ($tokenInSSE.Count -gt 0) { $tokenInSSE | Tee-Object -FilePath $log -Append }
```

## Step 5 — Helm chart valid

```powershell
"=== HELM CHECK ===" | Tee-Object -FilePath $log -Append
helm template test helm\teslasync\ 2>&1 | Select-Object -Last 3 | Tee-Object -FilePath $log -Append
$helmExit = $LASTEXITCODE
"HELM_TEMPLATE_EXIT=$helmExit" | Tee-Object -FilePath $log -Append

$helmFah = Select-String -Path helm\teslasync\values.yaml -Pattern 'forwardAuthHeader'
"forwardAuthHeader in values.yaml: $($helmFah.Count)" | Tee-Object -FilePath $log -Append

$helmCm = Select-String -Path helm\teslasync\templates\configmap.yaml -Pattern 'FORWARD_AUTH_HEADER'
"FORWARD_AUTH_HEADER in configmap: $($helmCm.Count)" | Tee-Object -FilePath $log -Append
```

## Step 6 — API scan

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

## Step 7 — Summary (GATE DECISION)

```powershell
"=== GATE ===" | Tee-Object -FilePath $log -Append

$blocked = $false
$reasons = @()

if ($goBuild -ne 0) { $blocked = $true; $reasons += "go build failed" }
if ($goVet -ne 0) { $blocked = $true; $reasons += "go vet failed" }
if ($tsc -ne 0) { $blocked = $true; $reasons += "tsc failed" }
if ($authentikBackend.Count -gt 0) { $blocked = $true; $reasons += "AuthentikSSEAuth/SSETokenHandler still in backend" }
if ($authentikFrontend.Count -gt 0) { $blocked = $true; $reasons += "fetchSSEToken still in frontend" }
if ($configRef.Count -eq 0) { $blocked = $true; $reasons += "FORWARD_AUTH_HEADER missing from config.go" }
if ($middlewareRef.Count -eq 0) { $blocked = $true; $reasons += "ForwardAuthMiddleware function missing" }
if ($routerRef.Count -eq 0) { $blocked = $true; $reasons += "ForwardAuthMiddleware not wired in router.go" }
if ($tokenInSSE.Count -gt 0) { $blocked = $true; $reasons += "?token= still in SSE connection code" }
if ($helmExit -ne 0) { $blocked = $true; $reasons += "helm template failed" }
if ($helmFah.Count -eq 0) { $blocked = $true; $reasons += "forwardAuthHeader missing from values.yaml" }
if ($helmCm.Count -eq 0) { $blocked = $true; $reasons += "FORWARD_AUTH_HEADER missing from configmap" }
if ($fail -gt 0) { $blocked = $true; $reasons += "API endpoints failed: $fail" }

if ($blocked) {
  "STATUS=BLOCKED ($($reasons -join '; '))" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  exit 1
}

"STATUS=DONE" | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
```
