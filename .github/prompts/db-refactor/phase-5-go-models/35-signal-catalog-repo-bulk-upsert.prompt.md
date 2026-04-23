---
description: "Phase 5 - implement BulkUpsert on SignalCatalogRepo"
---

# 🔵 Repos 35 - SignalCatalogRepo: BulkUpsert

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 35 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/signal_catalog_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-009 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Upsert a batch of signal definitions using `INSERT ... ON CONFLICT (name) DO UPDATE ... RETURNING id` (ADR-009 onboarding ritual).

## What's Being Established

A single method `BulkUpsert` on the existing repo struct in `internal/database/signal_catalog_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *SignalCatalogRepo) BulkUpsert(ctx context.Context, defs []models.SignalDef) error {
    for _, d := range defs {
        err := r.pool.QueryRow(ctx, `INSERT INTO signal_catalog (name, value_kind, unit) VALUES ($1,$2,$3) ON CONFLICT (name) DO UPDATE SET value_kind=EXCLUDED.value_kind, unit=EXCLUDED.unit RETURNING id`, d.Name, d.ValueKind, d.Unit).Scan(&d.ID)
        if err != nil { return fmt.Errorf("upsert %s: %w", d.Name, err) }
    }
    return nil
}
```

## Suggested Fix

1. Open `internal/database/signal_catalog_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `BulkUpsert` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("signal-catalog-repo-bulk-upsert: %w", err)`.
5. 

## Acceptance Criteria

- Method `BulkUpsert` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/signal_catalog_repo.go -Pattern 'BulkUpsert'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/signal_catalog_repo.go
git commit -m "phase-5(repos): add BulkUpsert to signalcatalogrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
