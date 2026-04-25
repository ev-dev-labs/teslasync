---
description: "Phase-17 — Token encryption fallback to plaintext: warn/fatal when ENCRYPTION_KEY missing"
---
# Prompt 01 — Token Encryption Fallback to Plaintext (HIGH)
> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-17-01-token-encryption-fallback.log` |
| Allowed files to change | `internal/crypto/crypto.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

**File:** `internal/crypto/crypto.go:53-63`

`NewFromEnv()` returns `nil` when `ENCRYPTION_KEY` is missing. Downstream,
`EncryptIfEnabled()` silently returns plaintext when the encryptor is nil. This means
tokens are stored unencrypted with zero indication to the operator.

## Task

### 1. Survey

Read `internal/crypto/crypto.go` lines 1-100 to understand `NewFromEnv()` and
`EncryptIfEnabled()` behavior.

### 2. Add environment-aware logging

In `NewFromEnv()`, when `ENCRYPTION_KEY` is empty:

1. Check `os.Getenv("APP_ENV")` or `os.Getenv("GO_ENV")` for production detection.
   Consider values `"production"`, `"prod"` as production mode.
2. **Production mode:** Call `log.Fatal().Msg("ENCRYPTION_KEY is required in production — refusing to start with plaintext token storage")`
   This will terminate the process, preventing accidental plaintext storage in prod.
3. **Non-production mode:** Call `log.Warn().Msg("ENCRYPTION_KEY not set — tokens will be stored in PLAINTEXT. Set ENCRYPTION_KEY before deploying to production")`
   Then return `nil` as before (dev/test continues to work).

### 3. Document EncryptIfEnabled behavior

In `EncryptIfEnabled()`, where it checks for nil and returns plaintext, add a comment:
```go
// When enc is nil, returns plaintext. This is only safe in dev/test —
// production startup is blocked by NewFromEnv() when ENCRYPTION_KEY is missing.
```

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify the warning/fatal logic exists:
$warn = Select-String -Path internal\crypto\crypto.go -Pattern 'log\.(Warn|Fatal).*ENCRYPTION_KEY'
if ($warn.Count -eq 0) { Write-Error "FAIL: no log.Warn/Fatal for missing ENCRYPTION_KEY"; exit 1 }
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-17/01-token-encryption-fallback: fatal in production when ENCRYPTION_KEY missing, warn in dev

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-17/01-token-encryption-fallback` as the commit message prefix.
