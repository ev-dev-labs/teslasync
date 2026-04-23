---
description: "Phase 5 - implement ListByAutomation on AutomationStepRepo"
---

# 🔵 Repos 48 - AutomationStepRepo: ListByAutomation

> **Severity:** Standard | **Priority:** Medium | **Prompt #:** 48 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/automation_step_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-004 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Return steps for an automation in ordinal order, with CTI children fully loaded via the UNION loader (prompts 49-51).

## What's Being Established

A single method `ListByAutomation` on the existing repo struct in `internal/database/automation_step_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *AutomationStepRepo) ListByAutomation(ctx context.Context, automationID int64) ([]models.AutomationStep, error) {
    rows, err := r.pool.Query(ctx, `SELECT id, automation_id, kind, ordinal FROM automation_steps WHERE automation_id=$1 ORDER BY ordinal`, automationID)
    if err != nil { return nil, fmt.Errorf("list: %w", err) }
    defer rows.Close()
    var out []models.AutomationStep
    for rows.Next() {
        var s models.AutomationStep
        if err := rows.Scan(&s.ID, &s.AutomationID, &s.Kind, &s.Ordinal); err != nil { return nil, err }
        out = append(out, s)
    }
    if err := rows.Err(); err != nil { return nil, err }
    return r.children.HydrateAll(ctx, out)
}
```

## Suggested Fix

1. Open `internal/database/automation_step_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `ListByAutomation` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("automation-steps-repo-list-by-automation: %w", err)`.
5. 

## Acceptance Criteria

- Method `ListByAutomation` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/automation_step_repo.go -Pattern 'ListByAutomation'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/automation_step_repo.go
git commit -m "phase-5(repos): add ListByAutomation to automationsteprepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
