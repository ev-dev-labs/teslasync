---
description: "Phase 5 - implement GetByName on SignalCatalogRepo"
---

# 🔵 Repos 36 - SignalCatalogRepo: GetByName

> **Severity:** Standard | **Priority:** High | **Prompt #:** 36 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/signal_catalog_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-009 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Lookup a signal definition by its canonical name.

## What's Being Established

A single method `GetByName` on the existing repo struct in `internal/database/signal_catalog_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *SignalCatalogRepo) GetByName(ctx context.Context, name string) (*models.SignalDef, error) {
    var d models.SignalDef
    err := r.pool.QueryRow(ctx, `SELECT id, name, value_kind, unit FROM signal_catalog WHERE name=$1`, name).Scan(&d.ID, &d.Name, &d.ValueKind, &d.Unit)
    if err == pgx.ErrNoRows { return nil, nil }
    if err != nil { return nil, fmt.Errorf("get by name: %w", err) }
    return &d, nil
}
```

## Suggested Fix

1. Open `internal/database/signal_catalog_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `GetByName` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("signal-catalog-repo-get-by-name: %w", err)`.
5. 

## Acceptance Criteria

- Method `GetByName` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/signal_catalog_repo.go -Pattern 'GetByName'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/signal_catalog_repo.go
git commit -m "phase-5(repos): add GetByName to signalcatalogrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
