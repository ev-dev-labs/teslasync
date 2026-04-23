---
description: "Phase 5 - implement ListFull on AutomationRepo"
---

# 🔵 Repos 41 - AutomationRepo: ListFull

> **Severity:** Standard | **Priority:** Medium | **Prompt #:** 41 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/automation_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-004 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Return automations with their steps + tags fully hydrated. Uses the UNION-query loader (prompts 49-51) rather than per-step fan-out.

## What's Being Established

A single method `ListFull` on the existing repo struct in `internal/database/automation_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *AutomationRepo) ListFull(ctx context.Context) ([]models.AutomationFull, error) {
    parents, err := r.ListSummaries(ctx)
    if err != nil { return nil, err }
    out := make([]models.AutomationFull, 0, len(parents))
    for _, p := range parents {
        steps, err := r.steps.ListByAutomation(ctx, p.ID)
        if err != nil { return nil, fmt.Errorf("hydrate %d: %w", p.ID, err) }
        out = append(out, models.AutomationFull{Automation: models.Automation{ID: p.ID, Name: p.Name, Enabled: p.Enabled}, Steps: steps})
    }
    return out, nil
}
```

## Suggested Fix

1. Open `internal/database/automation_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `ListFull` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("automations-repo-list-full: %w", err)`.
5. 

## Acceptance Criteria

- Method `ListFull` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/automation_repo.go -Pattern 'ListFull'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/automation_repo.go
git commit -m "phase-5(repos): add ListFull to automationrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
