---
description: "Phase-12 — Redis signal cache read path"
---
# Prompt 02 — Redis Signal Cache: Read Path
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-12-02-redis-read.log` |
| Allowed files to change | `internal/signal/redis_cache.go`, `internal/signal/store.go`, `internal/api/telemetry_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 01 (Redis write path)

## Context

After prompt 01, signals are written to both the in-memory store AND Redis HSET.
Now we need to add a read path so the signal store can recover from Redis on startup
instead of the limited `vehicle_live_state` table (~30 columns).

Currently `store.go:LoadFromDB` calls `flusher.LoadLiveState()` which reads
`vehicle_live_state` — a table with only ~30 hardcoded columns. Redis HSET has ALL signals.

## Task

### 1. Add read methods to `RedisSignalCache`

```go
// GetAll returns all signals for a vehicle from Redis HSET.
// Returns map[string]interface{} matching the signal store format.
func (c *RedisSignalCache) GetAll(ctx context.Context, vehicleID int64) (map[string]interface{}, error)

// GetSignal returns a single signal value.
func (c *RedisSignalCache) GetSignal(ctx context.Context, vehicleID int64, signal string) (interface{}, error)
```

Value decoding: attempt `strconv.ParseFloat` first → `float64`. Then check "true"/"false" → `bool`. Otherwise → `string`.

### 2. Update `store.go` — `LoadFromDB` fallback chain

Modify `LoadFromDB` to try Redis first, fall back to Postgres:

```go
func (s *Store) LoadFromDB(ctx context.Context, vehicleID int64) {
    // 1. Try Redis HSET first (has all 230+ signals)
    if s.redisCache != nil {
        signals, err := s.redisCache.GetAll(ctx, vehicleID)
        if err == nil && len(signals) > 0 {
            // merge into store without marking dirty
            s.Hydrate(vehicleID, signals)
            log.Info().Int64("vehicle_id", vehicleID).Int("signals", len(signals)).Msg("signal store: loaded from Redis")
            return
        }
    }
    // 2. Fall back to Postgres vehicle_live_state (legacy, ~30 columns)
    if s.flusher != nil { ... existing code ... }
}
```

- Add `redisCache *RedisSignalCache` field to the `Store` struct
- Add it as parameter to `signal.New()` constructor
- Wire through from telemetry handler

### Important constraints

- **Redis is optional** — if nil or Redis is down, fall back to existing Postgres path
- **Do NOT change** the in-memory read path (Get/GetAll/GetRawMap) — those stay as the primary hot reads for dashboard/SSE/FSM
- The goal is startup recovery, not replacing the in-memory read path (that's prompt 04 territory if needed)

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Restart API, check logs for "loaded from Redis"
docker compose restart teslasync-api
docker logs teslasync-api --since 30s 2>&1 | Select-String "loaded from Redis"
```

Log result. STATUS=DONE only if build passes and startup loads from Redis.
