---
description: "Phase 5 - implement ListSummaries on AutomationRepo"
---

# 🔵 Repos 40 - AutomationRepo: ListSummaries

> **Severity:** Standard | **Priority:** Medium | **Prompt #:** 40 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/automation_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-004 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Return lightweight automation summaries (id/name/enabled) for list views - no steps loaded.

## What's Being Established

A single method `ListSummaries` on the existing repo struct in `internal/database/automation_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *AutomationRepo) ListSummaries(ctx context.Context) ([]models.AutomationSummary, error) {
    rows, err := r.pool.Query(ctx, `SELECT id, name, enabled FROM automations ORDER BY name`)
    if err != nil { return nil, fmt.Errorf("list summaries: %w", err) }
    defer rows.Close()
    var out []models.AutomationSummary
    for rows.Next() {
        var s models.AutomationSummary
        if err := rows.Scan(&s.ID, &s.Name, &s.Enabled); err != nil { return nil, err }
        out = append(out, s)
    }
    return out, rows.Err()
}
```

## Suggested Fix

1. Open `internal/database/automation_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `ListSummaries` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("automations-repo-list-summaries: %w", err)`.
5. 

## Acceptance Criteria

- Method `ListSummaries` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/automation_repo.go -Pattern 'ListSummaries'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/automation_repo.go
git commit -m "phase-5(repos): add ListSummaries to automationrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
