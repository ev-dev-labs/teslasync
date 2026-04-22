---
description: "Phase 6 — Bulk-upsert all unique signal names into signal_catalog (one round-trip per batch)"
---

# 🔵 Write-Path 25 — Catalog Upsert

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 25 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/api/telemetry_handler.go` (edit) |
| Depends on | `24-extract-build-cold-observations` |
| Blocks | `26-extract-fan-out-bulk-writes` |
| ADR refs | ADR-002, ADR-009 |

## Single Goal

Add the single-round-trip catalog upsert: dedupe `buckets.AllNames`, call `signalCatalogRepo.BulkUpsertObserved(ctx, names)`, and log the new-name count. This must happen BEFORE cold inserts so the FK in `signal_observations` resolves.

## Recommendation

```go
// Dedupe in stable order
seen := make(map[string]struct{}, len(buckets.AllNames))
unique := buckets.AllNames[:0]
for _, n := range buckets.AllNames {
    if _, ok := seen[n]; ok {
        continue
    }
    seen[n] = struct{}{}
    unique = append(unique, n)
}

newCount, err := h.signalCatalogRepo.BulkUpsertObserved(ctx, unique)
if err != nil {
    return fmt.Errorf("catalog upsert: %w", err)
}
log.Debug().
    Int("unique_names", len(unique)).
    Int("new_names", newCount).
    Msg("catalog upsert complete")
```

`BulkUpsertObserved` is the Phase 5 repo method that does:
```sql
INSERT INTO signal_catalog (name) VALUES ($1), ($2), ...
ON CONFLICT (name) DO NOTHING
RETURNING name;
```
Returned rows = newly-inserted names. The `RETURNING` count is what `newCount` captures.

## Acceptance Criteria

- [ ] Dedupe uses stable in-place compaction (no allocation if all unique)
- [ ] `BulkUpsertObserved` is called exactly once per batch (single round-trip)
- [ ] Error wraps with `catalog upsert: %w` and aborts the batch (FK would fail anyway)
- [ ] `newCount` logged at debug
- [ ] `go build ./internal/api/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/api/...
Select-String -Path internal\api\telemetry_handler.go -Pattern 'BulkUpsertObserved'
# Expected: 1 call site
```

## Out of Scope

- Don't pre-warm the catalog on startup — runtime upsert is fine (ADR-009)
- Don't return `nameToID` map — `signal_observations` keys by `signal_name`, not numeric id (per Phase 3 prompt 08)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/api/telemetry_handler.go
git commit -m "telemetry(db-refactor): bulk catalog upsert per batch (1 round-trip)

ON CONFLICT DO NOTHING with RETURNING name for newCount log. Required
before cold inserts so signal_observations FK resolves.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 3 prompt 09 (signal_catalog), prompt 08 (FK)
- ADR-009 (onboarding ritual)
