---
description: "Phase-14 — Redis HSET read path + startup recovery"
---
# Prompt 03 — Redis Signal Cache: Read Path + Startup Recovery
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-03-redis-read.log` |
| Allowed files to change | `internal/signal/redis_cache.go`, `internal/signal/store.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 02

## Task

### 1. Add read methods to `RedisSignalCache`

```go
// GetAll returns all signals for a vehicle from Redis HSET.
func (c *RedisSignalCache) GetAll(ctx context.Context, vehicleID int64) (map[string]interface{}, error)

// GetSignal returns a single signal value.
func (c *RedisSignalCache) GetSignal(ctx context.Context, vehicleID int64, signal string) (interface{}, error)
```

Decode: try `strconv.ParseFloat` → `float64`. Check "true"/"false" → `bool`. Otherwise `string`.
For JSON strings (starts with `{` or `[`), try `json.Unmarshal` → `map[string]interface{}`.

### 2. Update `store.go` LoadFromDB — Redis-first fallback chain

```go
func (s *Store) LoadFromDB(ctx context.Context, vehicleID int64) {
    // Tier 1: Redis HSET (has ALL 230+ signals, survives pod restart)
    if s.redisCache != nil {
        signals, err := s.redisCache.GetAll(ctx, vehicleID)
        if err == nil && len(signals) > 0 {
            s.Hydrate(vehicleID, signals)
            log.Info().Int64("vehicle_id", vehicleID).Int("signals", len(signals)).
                Msg("signal store: loaded from Redis")
            return
        }
        log.Warn().Err(err).Int64("vehicle_id", vehicleID).Msg("signal store: Redis load failed, trying DB")
    }
    // Tier 2: signal_log (query latest value per signal)
    // SELECT DISTINCT ON (signal) signal, value_num, value_str, value_bool
    // FROM signal_log WHERE vehicle_id = $1 ORDER BY signal, created_at DESC
    // (implemented in prompt 06 — for now fall through to legacy)

    // Tier 3: Legacy vehicle_live_state (will be removed in prompt 13)
    if s.flusher != nil {
        // ... existing LoadLiveState code ...
    }
}
```

- Add `redisCache *RedisSignalCache` field to Store struct
- Wire through constructor

### Constraints

- Redis is **optional** — nil check before use
- If Redis + signal_log both fail, fall back to existing vehicle_live_state (until prompt 13 removes it)

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Restart API, verify it loads from Redis
docker compose restart teslasync-api
Start-Sleep 10
docker logs teslasync-api --since 15s 2>&1 | Select-String "loaded from Redis"
# Should find the log line
```

Log result. STATUS=DONE only if build passes AND startup loads from Redis.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/03-redis-read: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/03-redis-read` as the commit message prefix.

