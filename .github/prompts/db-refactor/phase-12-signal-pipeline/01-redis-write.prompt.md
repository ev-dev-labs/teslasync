---
description: "Phase-12 — Redis HSET write path for signal cache"
---
# Prompt 01 — Redis Signal Cache: Write Path
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-12-01-redis-write.log` |
| Allowed files to change | `internal/signal/redis_cache.go` (NEW), `internal/api/telemetry_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Context

The in-memory `signal.Store` (`internal/signal/store.go`) is a Go map that holds the latest
value of every signal per vehicle. It's the hot path for dashboard, SSE, and FSM.
Problem: it's lost on pod restart and can't be shared across pods.

Redis is already in the stack (`go-redis/v9` at `internal/cache/cache.go` and
`internal/platform/cache/connect.go`). We need to add a Redis HSET write alongside
the in-memory store update.

## Task

### 1. Create `internal/signal/redis_cache.go`

```go
// RedisSignalCache writes signal values to Redis HSET.
// Key: "vehicle:{vehicleID}:signals"
// Field: signal name, Value: JSON-encoded typed value
type RedisSignalCache struct {
    rdb *redis.Client
}

func NewRedisSignalCache(rdb *redis.Client) *RedisSignalCache

// Update writes all non-nil signals to the vehicle's HSET.
// Uses HSET (variadic) for single round-trip per batch.
// Also sets a TTL on the key (e.g. 7 days) to auto-expire stale vehicles.
func (c *RedisSignalCache) Update(ctx context.Context, vehicleID int64, signals map[string]interface{}) error
```

Value encoding: store as string. Numbers as decimal string, bools as "true"/"false",
strings as-is. Keep it simple — no JSON wrapping needed for flat values.

### 2. Wire into `telemetry_handler.go`

At line ~464, after `h.signalStore.Update(vehicleID, signals)`, add:

```go
if h.redisCache != nil {
    go h.redisCache.Update(context.Background(), vehicleID, signals)
}
```

- Add `redisCache *signal.RedisSignalCache` field to the telemetry handler struct
- Wire it in the constructor from the existing Redis client

### Important constraints

- **Do NOT remove** the in-memory `signalStore.Update()` call — it stays as the primary hot path
- Redis write is **fire-and-forget** (goroutine) — must not slow down MQTT processing
- If Redis is down, log a warning and continue — signals still flow through in-memory store
- Use the **existing** Redis client from `internal/platform/cache/connect.go` — do NOT create a new connection

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Verify Redis key after signal replay
docker exec teslasync-redis redis-cli HLEN vehicle:1:signals
# Should be > 0 after receiving signals
```

Log result. STATUS=DONE only if `go build` passes and HSET contains signal data.
