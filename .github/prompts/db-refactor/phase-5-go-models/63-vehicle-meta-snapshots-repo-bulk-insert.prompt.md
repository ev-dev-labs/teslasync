---
description: "Phase 5 - implement BulkInsert on VehicleMetaRepo"
---

# 🔵 Repos 63 - VehicleMetaRepo: BulkInsert

> **Severity:** Architectural | **Priority:** Medium | **Prompt #:** 63 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/vehicle_meta_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-5-go-models/67-build-models-package` |
| ADR refs | ADR-002 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Bulk-insert vehicle meta snapshots via `pgx.CopyFrom`.

## What's Being Established

A single method `BulkInsert` on the existing repo struct in `internal/database/vehicle_meta_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *VehicleMetaRepo) BulkInsert(ctx context.Context, ms []models.VehicleMetaSnapshot) error {
    if len(ms) == 0 { return nil }
    rows := pgx.CopyFromSlice(len(ms), func(i int) ([]any, error) {
        m := ms[i]
        return []any{m.VehicleID, m.Ts, m.Odometer, m.Software}, nil
    })
    _, err := r.pool.CopyFrom(ctx, pgx.Identifier{"vehicle_meta_snapshots"}, []string{"vehicle_id","ts","odometer","software_version"}, rows)
    if err != nil { return fmt.Errorf("vehicle meta bulk insert: %w", err) }
    return nil
}
```

## Suggested Fix

1. Open `internal/database/vehicle_meta_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `BulkInsert` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("vehicle-meta-snapshots-repo-bulk-insert: %w", err)`.
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
Select-String -Path internal/database/vehicle_meta_repo.go -Pattern 'BulkInsert'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/vehicle_meta_repo.go
git commit -m "phase-5(repos): add BulkInsert to vehiclemetarepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
