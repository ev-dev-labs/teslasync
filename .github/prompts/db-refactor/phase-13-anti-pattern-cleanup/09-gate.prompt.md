---
description: "Phase-13 — Gate: tsc + go build + zero duplicate verification"
---
# Prompt 09 — Gate: Build + TSC + Anti-Pattern Verification
> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-13-09-gate.log` |
| Allowed files to change | NONE (read-only verification), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 00–08

## Step 1 — Go build + vet

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-13-09-gate.log"
$env:CGO_ENABLED = "0"
"=== GO BUILD ===" | Tee-Object -FilePath $log
go build ./... 2>&1 | Tee-Object -FilePath $log -Append
$goBuild = $LASTEXITCODE
"GO_BUILD_EXIT=$goBuild" | Tee-Object -FilePath $log -Append
go vet ./... 2>&1 | Tee-Object -FilePath $log -Append
$goVet = $LASTEXITCODE
"GO_VET_EXIT=$goVet" | Tee-Object -FilePath $log -Append
```

## Step 2 — TypeScript compile

```powershell
"=== TSC ===" | Tee-Object -FilePath $log -Append
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Tee-Object -FilePath $log -Append
$tsc = $LASTEXITCODE
"TSC_EXIT=$tsc" | Tee-Object -FilePath $log -Append
```

## Step 3 — Frontend duplicate constant scan

```powershell
"=== FE DUPLICATE SCAN ===" | Tee-Object -FilePath $log -Append
cd D:\repos\teslasync\web

# Domain constants in .tsx (should be 0 — all moved to .ts)
$feConsts = grep -rn "const DAYS\b\|const MONTHS\b\|const COMMON_TIMEZONES\|const DAY_LABELS\|const NUMERIC_OPERATORS\|const BOOL_OPERATORS\|const STATE_CHECK_FIELDS\|const BOOL_FIELDS" --include="*.tsx" src/
"FE domain constants in .tsx: $($feConsts.Count)" | Tee-Object -FilePath $log -Append

# Duplicate utility functions in .tsx (should be 0)
$feFuncs = grep -rn "function toLocalDatetime\b\|function formatValue\b\|function batteryColor\b" --include="*.tsx" src/features/ src/components/ | grep -v "export function"
"FE duplicate utils in .tsx: $($feFuncs.Count)" | Tee-Object -FilePath $log -Append

# Bare timing numbers in hooks (should be 0 or minimal)
$feTiming = grep -rn "staleTime: [0-9]\|refetchInterval: [0-9]" --include="*.ts" src/api/
"FE bare timing numbers: $($feTiming.Count)" | Tee-Object -FilePath $log -Append

# Duplicate type definitions in .tsx
$feTypes = grep -rn "interface SignalRow\b\|type BadgeVariant\b" --include="*.tsx" src/features/
"FE duplicate types in .tsx: $($feTypes.Count)" | Tee-Object -FilePath $log -Append
```

## Step 4 — Backend duplicate scan

```powershell
"=== BE DUPLICATE SCAN ===" | Tee-Object -FilePath $log -Append
cd D:\repos\teslasync

# Duplicate helper functions in api/ (each should appear exactly once)
$beHelpers = grep -rn "func safeFloat\b\|func toFloat64\b" --include="*.go" internal/api/
"BE duplicate helpers: $($beHelpers.Count) (expect 1 each)" | Tee-Object -FilePath $log -Append
$beHelpers | Tee-Object -FilePath $log -Append

# signalToColumn still local in live_state_repo (should be 0 — moved to catalog)
$beSigMap = grep -n "var signalToColumn\|var isVarcharCol\|var isTimestampCol" internal/database/live_state_repo.go
"BE local signal maps in live_state_repo: $($beSigMap.Count)" | Tee-Object -FilePath $log -Append
```

## Step 5 — Summary

```powershell
"=== GATE ===" | Tee-Object -FilePath $log -Append
if ($goBuild -ne 0 -or $goVet -ne 0 -or $tsc -ne 0) {
  "STATUS=BLOCKED (build failure)" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append
  exit 1
}
"STATUS=DONE" | Tee-Object -FilePath $log -Append
"EXIT=0" | Tee-Object -FilePath $log -Append
```
