---
description: "Phase-14 — Redis HSET write path for signal cache"
---
# Prompt 02 — Redis Signal Cache: Write Path
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-02-redis-write.log` |
| Allowed files to change | `internal/signal/redis_cache.go` (CREATE), `internal/api/telemetry_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Task

### 1. Create `internal/signal/redis_cache.go`

```go
type RedisSignalCache struct {
    rdb *redis.Client
}

func NewRedisSignalCache(rdb *redis.Client) *RedisSignalCache

// Update writes all non-nil signals to Redis HSET "vehicle:{vehicleID}:signals".
// Single HSET call per batch (variadic). Fire-and-forget — errors logged, not returned.
// Sets 7-day TTL on the key to auto-expire stale vehicles.
func (c *RedisSignalCache) Update(ctx context.Context, vehicleID int64, signals map[string]interface{})
```

Value encoding: `float64` → decimal string, `bool` → "true"/"false", `string` → as-is,
`map[string]interface{}` → JSON string. Use `fmt.Sprintf("%v", v)` for simple types.

### 2. Wire into `telemetry_handler.go`

At line ~464, after `h.signalStore.Update(vehicleID, signals)`:

```go
if h.redisSignalCache != nil {
    go h.redisSignalCache.Update(context.Background(), vehicleID, signals)
}
```

- Add `redisSignalCache *signal.RedisSignalCache` field to telemetry handler struct
- Wire from existing Redis client: `internal/platform/cache/connect.go` → `Underlying()` returns `*redis.Client`

### Constraints

- **Keep** in-memory `signalStore.Update()` — it stays as the primary hot path for now
- Redis write is **goroutine** — must not block MQTT processing
- If Redis is unavailable, log warn and continue — no crash

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# After rebuilding + receiving signals:
docker exec teslasync-redis redis-cli HLEN vehicle:1:signals
# Should be > 0
docker exec teslasync-redis redis-cli HGET vehicle:1:signals BatteryLevel
# Should return a numeric string
```

Log result. STATUS=DONE only if build passes AND Redis HSET has data.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/02-redis-write: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/02-redis-write` as the commit message prefix.

