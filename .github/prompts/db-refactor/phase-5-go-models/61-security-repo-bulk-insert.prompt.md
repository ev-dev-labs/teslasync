---
description: "Phase 5 - implement BulkInsert on SecurityRepo"
---

# 🔵 Repos 61 - SecurityRepo: BulkInsert

> **Severity:** Architectural | **Priority:** Medium | **Prompt #:** 61 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/security_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-5-go-models/67-build-models-package` |
| ADR refs | ADR-002 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Bulk-insert security events via `pgx.CopyFrom`.

## What's Being Established

A single method `BulkInsert` on the existing repo struct in `internal/database/security_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *SecurityRepo) BulkInsert(ctx context.Context, es []models.SecurityEvent) error {
    if len(es) == 0 { return nil }
    rows := pgx.CopyFromSlice(len(es), func(i int) ([]any, error) {
        e := es[i]
        return []any{e.VehicleID, e.Ts, e.EventKind}, nil
    })
    _, err := r.pool.CopyFrom(ctx, pgx.Identifier{"security_events"}, []string{"vehicle_id","ts","event_kind"}, rows)
    if err != nil { return fmt.Errorf("security bulk insert: %w", err) }
    return nil
}
```

## Suggested Fix

1. Open `internal/database/security_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `BulkInsert` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("security-repo-bulk-insert: %w", err)`.
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
Select-String -Path internal/database/security_repo.go -Pattern 'BulkInsert'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/security_repo.go
git commit -m "phase-5(repos): add BulkInsert to securityrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
