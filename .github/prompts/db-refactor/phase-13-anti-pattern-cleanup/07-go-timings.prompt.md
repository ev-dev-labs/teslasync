---
description: "Phase-13 — Centralize Go timeout/interval constants"
---
# Prompt 07 — Centralize Go Timeouts and Intervals
> **Severity:** MEDIUM | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-13-07-go-timings.log` |
| Allowed files to change | `internal/config/timings.go` (CREATE), files with hardcoded timeouts, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

Timeout and interval values scattered as magic numbers:
- `5 * time.Minute` — auth cache TTL in `authentik_middleware.go`
- `10 * time.Second` — HTTP client timeout in multiple places
- `60 * time.Second` — memory cache cleanup interval
- `30 * time.Second` — MQTT keepalive in `mqtt.go`
- `2 * time.Second` — signal_history flush interval
- Various retry intervals, circuit breaker thresholds

## Task

### 1. Create `internal/config/timings.go`

```go
package config

import "time"

// Centralized timing constants. Change here → applies everywhere.
const (
    // HTTP
    HTTPClientTimeout     = 10 * time.Second
    HTTPWriteTimeout      = 30 * time.Second

    // Auth
    AuthCacheTTL          = 5 * time.Minute
    AuthRefreshInterval   = 30 * time.Minute

    // MQTT
    MQTTKeepAlive         = 30 * time.Second
    MQTTReconnectMax      = 60 * time.Second

    // Signal pipeline
    SignalFlushInterval   = 2 * time.Second
    SignalFlushTimeout    = 10 * time.Second
    LiveStateFlushNormal  = 1 * time.Second
    LiveStateFlushDegraded = 5 * time.Second

    // Cache
    MemCacheCleanup       = 60 * time.Second

    // Circuit breaker
    CBFailureThreshold    = 5
    CBResetTimeout        = 30 * time.Second
)
```

### 2. Replace hardcoded values in source files

Survey `internal/` for `time.Second`, `time.Minute` with bare numbers.
Replace with the appropriate constant. Only replace values that match
the constants above — leave test-specific or one-off timeouts as-is.

### Important constraints

- **Do NOT change timeout values** — only replace literals with named constants
- Values in config structs that come from environment variables stay as-is
  (e.g., `envStr("MQTT_KEEPALIVE", "30s")` is fine — it's already configurable)
- Only centralize values that are currently hardcoded with no env override
- Test timeouts (in `*_test.go`) are fine as-is

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
go vet ./...
```

Log result. STATUS=DONE only if build+vet pass.
