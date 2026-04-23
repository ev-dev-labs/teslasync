# Caching & Cache-Invalidation

Status as of write-path refactor (db-refactor prompt 29 / ADR-002).

## TL;DR

The new typed-column write path (`TelemetryHandler.ProcessBatch`) does **not** need to
invalidate any cache keys for vehicle state, battery, energy, or per-table latest
snapshots, because **no such keys exist today**. The only Redis-backed cache in
production caches geocoding/route results inside the trip planner, which is not
touched by telemetry writes.

This document records the result of the cache invalidation audit so future
contributors don't have to re-derive it, and pins the TTL contract to use *if* a
read-through cache is introduced for vehicle state in a later prompt.

## Inventory of cache surfaces (audit result)

| Symbol | Package | Used by | Touches telemetry data? |
|---|---|---|---|
| `cache.Store` | `internal/cache` | `TripPlannerHandler` (held but currently no `.Get/.Set/.Delete` calls in handler logic — reserved for route/geocode caching) | No |
| `database.Cache` | `internal/database` | None (no `database.NewCache` call sites) | No |
| `redis.VehicleCache` (`vehicle:%s:state`, 30s TTL) | `internal/adapter/redis` | None — adapter is wired in the hexagonal sample but no production handler uses it | No |
| `redis.SessionCache` (`session:%s:%s`, 5min TTL) | `internal/adapter/redis` | None | No |

Verification commands (re-run any time):

```powershell
# every cache write
Select-String -Path internal\**\*.go -Pattern 'cache\.(Set|Delete|Invalidate)' -Context 0,1
# every cache read
Select-String -Path internal\**\*.go -Pattern 'cache\.Get'
# any reference to VehicleCache (currently only its own file)
Select-String -Path internal\**\*.go -Pattern 'VehicleCache'
```

## Why ProcessBatch does not invalidate

`/vehicles/{id}/state`, `/vehicles/{id}/battery`, and `/vehicles/{id}/energy`
read directly from `vehicle_live_state` (write-through from the in-memory
`SignalStore`, zero lag). There is no Redis or in-memory layer between the
handler and the table, so a fresh write is visible to the next read without any
explicit invalidation.

If a future prompt adds a read-through cache for these endpoints, the
invalidation hook **must** live at the end of `ProcessBatch`, after dispatch and
before return, deleting the keys listed below.

## TTL contract (use these values if a cache is introduced)

| Key pattern | TTL | Rationale |
|---|---|---|
| `vehicle:%d:state` | 30s | Live-state aggregate; readers tolerate up to one batch of staleness |
| `vehicle:%d:battery` | 30s | Derived from live state, refreshes together |
| `vehicle:%d:energy` | 30s | Derived from live state, refreshes together |
| `vehicle:%d:<hot_table>:latest` | 30s | Per-hot-table latest snapshot (positions, charging_telemetry, climate_snapshots, motor_snapshots, security_events, vehicle_meta_snapshots) |
| `vehicle:%d:signal:<name>:latest` | 5min | Cold per-signal latest from `signal_observations`; cold by definition |
| `session:%s:*` | 5min | Already in use by `SessionCache` (preferences/UI state) |
| `tripplan:*` | (handler-local) | Trip planner geocode / route cache; unrelated to telemetry |

## Reference invalidation sketch

For when a cache layer is added — recommended placement is just before the final
log line in `ProcessBatch`:

```go
keys := []string{
    fmt.Sprintf("vehicle:%d:state", vehicleID),
    fmt.Sprintf("vehicle:%d:battery", vehicleID),
    fmt.Sprintf("vehicle:%d:energy", vehicleID),
}
for table := range hotRows {
    keys = append(keys, fmt.Sprintf("vehicle:%d:%s:latest", vehicleID, table))
}
for _, k := range keys {
    h.cache.Delete(ctx, k) // best-effort; log at Debug, never block the batch
}
```

The single-instance assumption holds (no Redis Pub/Sub broadcast required).

## Out of scope

- Introducing a cache layer where one does not exist today.
- Cross-instance invalidation (multi-pod deployments).
- Caching cold per-signal history reads (read volume is low; not currently a hot path).
