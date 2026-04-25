---
description: "Phase-14 — SSE push path: Redis Pub/Sub replaces in-memory store"
---
# Prompt 18 — SSE Push Path: Redis Pub/Sub
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-18-sse-redis.log` |
| Allowed files to change | `internal/api/sse_handler.go` (or wherever SSE is handled), `internal/api/telemetry_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 02 (Redis write path)

## Problem

The SSE `vehicle_update` event is currently built from the in-memory signal store.
After prompt 12 removes the FlushLoop and snapshot writers, the in-memory store
is still updated (prompt 02 keeps it), BUT multi-pod deployments mean only the pod
that received the MQTT message has the update in memory. Other pods' SSE clients
see stale data.

The fix: use Redis Pub/Sub to broadcast signal updates to ALL pods' SSE handlers.

## Task

### 1. Survey the current SSE handler

Find where SSE events are sent. Look for:
```bash
grep -rn "SSE\|eventHub\|event_hub\|ServerSentEvent\|Notify\|Broadcast" --include="*.go" internal/api/
```

Understand:
- How is `vehicle_update` event constructed?
- What data does it send to the frontend?
- Where does it read from (signal store? direct from MQTT batch?)

### 2. Add Redis Pub/Sub publish on signal batch

In `telemetry_handler.go`, after writing to Redis HSET, also PUBLISH:

```go
if h.redisSignalCache != nil {
    go func() {
        h.redisSignalCache.Update(context.Background(), vehicleID, signals)
        // Pub/Sub broadcast for SSE across pods
        payload, _ := json.Marshal(map[string]interface{}{
            "vehicle_id": vehicleID,
            "signals":    signals,
            "ts":         time.Now().UTC(),
        })
        h.redisClient.Publish(context.Background(), "vehicle_signals", payload)
    }()
}
```

### 3. SSE handler subscribes to Redis Pub/Sub

The SSE handler (or event hub) should subscribe to the `vehicle_signals` Redis
channel and forward events to connected SSE clients:

```go
func (hub *EventHub) SubscribeRedis(ctx context.Context, rdb *redis.Client) {
    sub := rdb.Subscribe(ctx, "vehicle_signals")
    ch := sub.Channel()
    for msg := range ch {
        var payload map[string]interface{}
        if json.Unmarshal([]byte(msg.Payload), &payload) == nil {
            hub.Broadcast(payload)  // send to all connected SSE clients
        }
    }
}
```

### Constraints

- **Keep existing in-process event hub** as fallback — if Redis Pub/Sub is not
  configured, fall back to direct in-memory broadcasting (single pod mode)
- The SSE payload format sent to the frontend must NOT change — same JSON shape
- Redis Pub/Sub is fire-and-forget (no persistence) — if an SSE client reconnects,
  it reads current state from Redis HSET, not replayed Pub/Sub messages
- Use the existing Redis client from `internal/platform/cache/connect.go`

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
```

Log result. STATUS=DONE only if build passes.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/18-sse-redis: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/18-sse-redis` as the commit message prefix.

