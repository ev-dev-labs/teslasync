---
description: "Phase 5 - implement BulkInsert on PositionRepo"
---

# 🔵 Repos 53 - PositionRepo: BulkInsert

> **Severity:** Architectural | **Priority:** Medium | **Prompt #:** 53 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/position_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-5-go-models/67-build-models-package` |
| ADR refs | ADR-002, ADR-005 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Bulk-insert positions via `pgx.CopyFrom`. Drops the old `signals jsonb` write entirely.

## What's Being Established

A single method `BulkInsert` on the existing repo struct in `internal/database/position_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *PositionRepo) BulkInsert(ctx context.Context, ps []models.Position) error {
    if len(ps) == 0 { return nil }
    rows := pgx.CopyFromSlice(len(ps), func(i int) ([]any, error) {
        p := ps[i]
        return []any{p.VehicleID, p.Ts, p.Lat, p.Lon, p.SpeedKph}, nil
    })
    _, err := r.pool.CopyFrom(ctx, pgx.Identifier{"positions"}, []string{"vehicle_id","ts","lat","lon","speed_kph"}, rows)
    if err != nil { return fmt.Errorf("positions bulk insert: %w", err) }
    return nil
}
```

## Suggested Fix

1. Open `internal/database/position_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `BulkInsert` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("positions-repo-bulk-insert: %w", err)`.
5. 

## Acceptance Criteria

- Method `BulkInsert` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/position_repo.go -Pattern 'BulkInsert'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/position_repo.go
git commit -m "phase-5(repos): add BulkInsert to positionrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
