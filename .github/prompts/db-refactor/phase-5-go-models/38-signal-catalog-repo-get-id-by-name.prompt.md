---
description: "Phase 5 - implement GetIDByName on SignalCatalogRepo"
---

# 🔵 Repos 38 - SignalCatalogRepo: GetIDByName

> **Severity:** Standard | **Priority:** High | **Prompt #:** 38 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/signal_catalog_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-009 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Fast id-only lookup. Used by the ingest hot path to translate name -> id once and cache it.

## What's Being Established

A single method `GetIDByName` on the existing repo struct in `internal/database/signal_catalog_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *SignalCatalogRepo) GetIDByName(ctx context.Context, name string) (int64, error) {
    var id int64
    err := r.pool.QueryRow(ctx, `SELECT id FROM signal_catalog WHERE name=$1`, name).Scan(&id)
    if err == pgx.ErrNoRows { return 0, nil }
    if err != nil { return 0, fmt.Errorf("get id by name: %w", err) }
    return id, nil
}
```

## Suggested Fix

1. Open `internal/database/signal_catalog_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `GetIDByName` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("signal-catalog-repo-get-id-by-name: %w", err)`.
5. 

## Acceptance Criteria

- Method `GetIDByName` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/signal_catalog_repo.go -Pattern 'GetIDByName'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/signal_catalog_repo.go
git commit -m "phase-5(repos): add GetIDByName to signalcatalogrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
