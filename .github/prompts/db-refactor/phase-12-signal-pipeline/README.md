# Phase 12 — Signal Pipeline: Redis Hot Cache + TimescaleDB Event Log

## Goal

Replace the in-memory Go signal store with Redis HSET (hot cache) and upgrade
`signal_history` to a TimescaleDB hypertable (cold store / event log). This
solves the **missing context problem**: Tesla uses delta encoding (only sends
changed signals), so any logic reading only the current batch loses context.

## Architecture

```
MQTT Broker
     │
     ▼
  telemetry_handler.go  (stateless signal router)
     │
     ├──▶ Redis HSET per vehicle  (hot cache — replaces in-memory signal.Store)
     ├──▶ signal_history hypertable  (append-only event log — already exists, needs upgrade)
     └──▶ Redis Pub/Sub → SSE  (real-time push to frontend)
```

## Key design decisions

- **signal_history** is already written to on every signal batch — just needs hypertable conversion
- **Redis** is already in the Docker stack with `go-redis/v9` — just needs HSET writes
- **User-configurable retention** — existing manual TTL cleanup stays, no forced TimescaleDB policies
- **Backward compatible** — in-memory store stays as fallback until Redis path is proven

## Prompt ordering (7 atomic prompts)

```
00 — Convert signal_history to TimescaleDB hypertable + compression
01 — Redis signal cache: HSET write on every batch
02 — Redis signal cache: read path (replace in-memory store reads)
03 — Point-in-time reconstruction helper for session completion
04 — Drive completion: use signal_history instead of accumulated fields
05 — Charge completion: use signal_history instead of accumulated fields
06 — Gate: build + tsc + integration test (replay signals → verify data)
```

## Existing code paths (for reference)

| Component | File | Current behavior |
|---|---|---|
| Signal dispatch | `internal/api/telemetry_handler.go:460-486` | Updates in-memory store + appends to signal_history |
| In-memory store | `internal/signal/store.go` | Go map, merge-only, debounced flush to vehicle_live_state |
| signal_history writer | `internal/database/signal_history_writer.go` | Buffered batch INSERT via pgx CopyFrom |
| DB flush | `internal/database/live_state_repo.go` | UPSERT ~30 hardcoded columns into vehicle_live_state |
| Drive completion | `internal/api/telemetry_sessions.go:~1450-1550` | Reads accumulated session fields |
| Charge completion | `internal/api/telemetry_sessions.go:~1560-1625` | Reads accumulated session fields |
| Redis client | `internal/cache/cache.go`, `internal/platform/cache/connect.go` | Already using go-redis/v9 |
| Startup hydration | `internal/signal/store.go:194-219` | LoadFromDB reads vehicle_live_state |
