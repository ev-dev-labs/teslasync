---
description: "Phase 6 — Audit cache keys touched by old write path; rewrite to invalidate on new typed-column writes"
---

# 🔵 Write-Path 29 — Cache Invalidation Audit

> **Severity:** Quality gate | **Priority:** High | **Prompt #:** 29 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `internal/cache/*.go`, `internal/api/telemetry_handler.go`, any handler reading vehicle state |
| Depends on | `28-extract-error-aggregation` |
| Blocks | `30-sse-payload-audit` |
| ADR refs | ADR-002 |

## Single Goal

Find every cache key the legacy write path invalidated (vehicle state, latest snapshot, etc.) and ensure the new write path invalidates the equivalent keys. Document any TTL changes needed (typed columns often need shorter TTL than raw JSON snapshots because they refresh together).

## Recommendation

### Audit script

```powershell
cd D:\repos\teslasync

# 1. Find every cache.Set / cache.Delete touching telemetry keys
Select-String -Path internal\**\*.go -Pattern 'cache\.(Set|Delete|Invalidate)' -Context 0,1

# 2. Find every cache.Get reading state — those are the keys to invalidate on write
Select-String -Path internal\**\*.go -Pattern 'cache\.Get' -Context 0,2

# 3. Compare against new write-path's cache touches
Select-String -Path internal\api\telemetry_handler.go -Pattern 'h\.cache\.'
```

### Required invalidations after each batch

In `ProcessBatch`, after dispatch and before return:

```go
// Invalidate per-vehicle cache keys touched by this batch.
// Hot table writes -> latest-snapshot keys for those tables.
// Cold writes -> per-signal latest-value keys (only for newly seen signals).
keysToInvalidate := []string{
    fmt.Sprintf("vehicle:%d:state", veh.ID),
    fmt.Sprintf("vehicle:%d:battery", veh.ID),
    fmt.Sprintf("vehicle:%d:energy", veh.ID),
}
for table := range hotRows {
    keysToInvalidate = append(keysToInvalidate, fmt.Sprintf("vehicle:%d:%s:latest", veh.ID, table))
}
for _, key := range keysToInvalidate {
    if err := h.cache.Delete(ctx, key); err != nil {
        log.Debug().Err(err).Str("key", key).Msg("cache invalidate (non-fatal)")
    }
}
```

### TTL changes

Per the Go-backend instructions:
- Vehicle state: 30s (was longer because raw_state was expensive to build)
- Snapshot latest: 30s
- Per-signal cold latest: 5min (cold by definition)

Document any change in `docs/caching.md` (create if missing) and in the commit message.

## Acceptance Criteria

- [ ] Every legacy cache.Delete / Invalidate call referenced from old write path is matched by an equivalent in the new path
- [ ] Per-table latest keys invalidated on each batch
- [ ] No stale-data regression: a manual smoke test (write batch → GET vehicle/{id}/state) returns the just-written values
- [ ] TTL changes documented in `docs/caching.md` (or noted in commit body)
- [ ] `go build ./internal/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/...

# Spot-check: every cache key read by handlers is invalidated by ProcessBatch
$readKeys = (Select-String -Path internal\api\*_handler.go -Pattern 'cache\.Get\(.+vehicle:%d:(\w+)' -AllMatches).Matches | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
$writeKeys = (Select-String -Path internal\api\telemetry_handler.go -Pattern 'vehicle:%d:(\w+)' -AllMatches).Matches | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
Write-Host "Read keys:  $($readKeys -join ',')"
Write-Host "Write keys: $($writeKeys -join ',')"
# Read set should be subset of write set
```

## Out of Scope

- Don't introduce a cache layer where there wasn't one — this is invalidation parity, not new caching
- Don't add Redis Pub/Sub invalidation broadcast — single-instance assumption holds

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/api/telemetry_handler.go internal/cache/ docs/caching.md
git commit -m "telemetry(db-refactor): cache invalidation parity for new write path

Per-batch invalidation of vehicle:%d:state, :battery, :energy, plus
per-hot-table :latest keys. TTL adjustments documented (state 30s,
cold per-signal 5min).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `internal/cache/`
- ADR-002
