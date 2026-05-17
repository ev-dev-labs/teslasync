# Caching

TeslaSync caches data at five distinct layers. Each layer exists for a different reason, and each one has a different invalidation story. If you understand all five, you can reason about why a value looks stale, where to clear it, and why "just turn caching off" is never a real option.

This page is a reference, not a tutorial — read top to bottom once, then come back when you need to debug a specific layer.

## The five layers, top to bottom

```
Browser
  │
  ├─ Service Worker (PWA) ── caches app shell, fonts, map tiles
  │
  ├─ TanStack Query   ── caches JSON responses, dedupes parallel requests
  │
  ▼
API server
  │
  ├─ L1 in-process signal.Store ── live state per process, microsecond reads
  │
  ├─ L2 Redis cache    ── shared live state across replicas + pub/sub fanout
  │
  ▼
TimescaleDB
  │
  └─ Continuous aggregates ── pre-rolled buckets so chart queries stay fast
```

Plus a sixth, dataviz-only layer:

```
Grafana ── per-panel query cache for repeat-render of the same time range
```

We treat Grafana's cache as out-of-scope here — it's part of the observability stack, not the application path.

## Layer 1 — Service Worker (PWA)

**What it caches.** The app shell (HTML, JS, CSS), the icon set, fonts, OSM map tiles, the Helix brand mark, anything else in `web/dist`. Stale-while-revalidate strategy for assets — the cached version is returned immediately, the network fetch happens in the background, and the next page load gets the updated version.

**What it does not cache.** API JSON responses. SSE streams. Anything user-specific. Anything dynamic.

**Why this matters.** First-load on a cold cache is slow because everything is uncached. Second-load is instantaneous. After a deploy, users get the old shell on first visit, the updated shell on second. We accept this because alternatives (skip-waiting service workers) cause mid-session reloads which are worse UX.

**How to invalidate.** The service worker auto-updates on every deploy by hashing asset filenames; users get the new version on next page load. To force-clear during development, devtools → Application → Service Workers → Unregister, then hard-reload.

**Dev-mode default.** The service worker is **not** registered in dev unless `VITE_PWA_DEV=true`. This prevents the "why are my code changes not appearing" trap.

## Layer 2 — TanStack Query

**What it caches.** Every JSON response from the API, keyed by the hook's `queryKey`. Default stale time is short; queries refetch on window focus and on tab visibility change.

**What it doesn't cache.** SSE messages (those are pushed into the cache via setQueryData, not queried). WebSocket-style live data. Anything explicitly opted out with `gcTime: 0`.

**Why this matters.** The frontend pretends every component can fetch its own data without thinking about it — multiple components asking for the same query get one network request and a shared cache entry. Components unmount/remount freely; cached data is reused.

**How to invalidate.** Mutations (`useMutation`) invalidate related queries via `queryClient.invalidateQueries({ queryKey: [...] })`. Server-pushed updates (SSE) call `queryClient.setQueryData([...], updater)` to mutate the cache in place. Manual cache clear is rarely needed and is a code smell — if you find yourself doing it, the SSE wiring is probably wrong.

**SSE → cache contract.** When the live-state SSE stream pushes an update, the SSE consumer hook calls `setQueryData` for the matching keys. This is how the dashboard stays live without refetching: the API pushes the delta, the cache absorbs it, every subscribed component re-renders.

## Layer 3 — L1 in-process `signal.Store`

**What it caches.** The most recent value per vehicle per signal, in process memory. Lookups are O(1) sync map reads — microseconds.

**Where it lives.** `internal/signal/store.go`. One per running API process.

**What it doesn't cache.** Historical data (that's in TimescaleDB). User session data (that's in Redis). Anything that isn't the latest value of a streaming signal.

**Why this matters.** Every request for "the current state of vehicle X" hits L1 first. If it's there, no Redis hop, no database query — just memory. This is the only reason the dashboard can render dozens of widgets per vehicle without choking the database.

**How it's updated.** Two paths:

1. The Fleet Telemetry consumer + MQTT bridge call `store.Set(vehicleID, signal, value)` as messages arrive
2. The Tesla API polling worker calls `store.Set` after each successful poll

**How it's invalidated.** It isn't — values are overwritten as new data arrives. Process restart clears it; the L2 + DB layers rehydrate.

**Multi-process gotcha.** L1 is per-process. If you scale `teslasync-api` horizontally, each replica has its own L1, and a write to replica A is invisible to replica B until the L2 + pubsub layers fan it out. This is why `LIVE_SIGNAL_STORE_MODE=hybrid` exists.

## Layer 4 — L2 Redis cache + Pub/Sub

**What it caches.** The same data as L1, but in Redis HSETs keyed `vehicle:{id}:signals`. Shared across all `teslasync-api` replicas.

**What it doesn't cache.** Historical data. Anything that isn't a live signal value or a derived live state.

**Why this matters.** L2 is what makes horizontal scaling work. When replica A receives a telemetry update, it:

1. Writes to its own L1
2. HSET into Redis (L2)
3. Publishes a channel message on `signals:{vehicleID}` with the delta

Replicas B, C, … subscribe to that channel. They receive the message, update their own L1, and the next request to any replica sees the new value without rehydrating from the database.

**Modes.** `LIVE_SIGNAL_STORE_MODE` controls the behaviour:

| Mode      | L1   | L2 read  | L2 write  | Pub/Sub  | Use when                                                  |
| --------- | ---- | -------- | --------- | -------- | --------------------------------------------------------- |
| `local`   | yes  | no       | no        | no       | Single replica, no Redis available                        |
| `hybrid`  | yes  | rehydrate-on-miss | yes | yes | Multi-replica production (default)                        |
| `redis`   | no   | every read | yes     | yes      | Diagnostics — bypass L1 to verify L2 contents             |

**How it's invalidated.** Same as L1 — overwritten as new data arrives. Redis eviction policy is `noeviction` for `vehicle:*:signals` keys; they persist as long as Redis is up. After a Redis restart, replicas rehydrate from the database on first request per vehicle.

## Layer 5 — TimescaleDB continuous aggregates

**What it caches.** Pre-rolled time-bucketed aggregates of the high-volume hypertables (`signal_log`, `positions`, drive metrics, charging metrics). Buckets at multiple granularities: 1-minute, 1-hour, 1-day.

**Why this matters.** A query for "average power over the last 90 days" against raw `signal_log` would scan tens of millions of rows. The same query against the 1-hour continuous aggregate scans hundreds. Charts on long ranges stay fast because the database is doing math on rollups, not on raw points.

**How it's refreshed.** TimescaleDB's `continuous_aggregate_policy` jobs refresh the buckets in the background, on the schedule defined in the migration that created each aggregate. You don't need to think about this — it just happens.

**How it's invalidated.** When a backfill or correction is written to raw data, the affected aggregate buckets are marked dirty and re-materialised on the next policy run. For forced refresh: `CALL refresh_continuous_aggregate('<name>', '<from>', '<to>')`.

**Where to find them.** `migrations/*.up.sql` files that create `MATERIALIZED VIEW ... WITH (timescaledb.continuous)`. The Grafana dashboards and a few high-traffic API endpoints query these views directly when the range exceeds a threshold.

## How invalidation flows when something changes

| Change                                | Layers that need to know                                                |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Telemetry message arrives             | L1 (set), L2 (HSET + publish), TanStack (via SSE → setQueryData)         |
| User changes a setting                | TanStack (invalidate `['settings']`), no L1/L2 impact                    |
| User issues a remote command          | L1/L2 unaffected directly; the resulting telemetry update flows normally |
| Migration creates a new aggregate     | Existing data backfills into the aggregate over the next policy cycle    |
| Backfill writes historical signals    | Continuous aggregate marks affected buckets dirty                       |
| Deploy lands a new web bundle         | Service worker fetches the new shell next page load                     |
| API process restarts                  | L1 reset (will rehydrate from L2 on first request per vehicle)          |
| Redis restart                         | L2 reset (will rehydrate from DB on first request per vehicle)          |

## Debugging stale data

Symptom-driven checklist:

| You see…                                                          | Look at…                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Dashboard shows old values, "Polling" badge                       | SSE dropped — browser devtools → Network → EventStream                                |
| Dashboard shows old values, "Live" badge                          | L2 not propagating — check Redis Pub/Sub with `redis-cli MONITOR \| grep signals:`     |
| Dashboard shows old values, single replica                        | L1 not updating — telemetry consumer is stuck. Check `teslasync-api` logs            |
| API returns stale value, frontend refresh helps                   | TanStack stale time too long, or hook isn't invalidating on mutation                  |
| Old web bundle keeps loading after deploy                         | Service worker — devtools → Application → Service Workers → Unregister, hard-reload   |
| Chart on long range is slow                                       | Continuous aggregate missing or stale — check `timescaledb_information.continuous_aggregates` |
| One replica shows different live data than another                | `LIVE_SIGNAL_STORE_MODE` isn't `hybrid`, or Redis Pub/Sub isn't reaching the laggard  |

## Configuration

The env vars that affect caching behaviour:

| Var                            | Layer    | What it does                                                  |
| ------------------------------ | -------- | ------------------------------------------------------------- |
| `LIVE_SIGNAL_STORE_MODE`       | L1+L2    | `local` / `hybrid` (default) / `redis`                        |
| `REDIS_ENABLED`                | L2       | Disable Redis entirely (forces `local`)                       |
| `REDIS_URL`                    | L2       | Redis connection string                                       |
| `SSE_HEARTBEAT_INTERVAL`       | TanStack | How often the API pings; helps the browser detect a dropped stream |
| `ADAPTIVE_POLLING_FALLBACK_MS` | TanStack | How fast the fallback polls when SSE is down                  |
| `VITE_PWA_DEV`                 | SW       | Enable service worker in dev (off by default)                 |

There is no env var that disables TanStack — it's a hard frontend dependency. There is no env var that disables continuous aggregates — they're a hard backend dependency.

## What we deliberately don't cache

- **Helix AI responses.** Every call goes through the decorator chain (trace → audit → cost → ratelimit → redact). Caching responses would defeat the audit ledger and the cost guardrail. If you want the same answer twice, generate it twice.
- **Per-user pages on the API side.** Authorisation is part of every request; caching at the HTTP layer would risk serving one user's data to another. The frontend's per-component cache is fine because it's scoped to the browser session.
- **Tesla command results.** Commands always go to Tesla. Caching a "success" response would be dangerous because the vehicle's state can change between calls.
- **Settings.** Frontend caches them in TanStack with a short stale time. We don't cache them on the API side because they're small and rarely contested.

## Where to learn more

- [Architecture](/guide/architecture) — the runtime view of how data flows
- [Database](/guide/database) — schema and the continuous-aggregate inventory
- [Troubleshooting](/guide/troubleshooting) — symptom-driven debugging
- [Configuration](/guide/configuration) — every cache-related env var with defaults
