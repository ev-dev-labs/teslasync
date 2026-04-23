---
description: "Phase 5 - implement UpdateOrder on AutomationStepRepo"
---

# 🔵 Repos 46 - AutomationStepRepo: UpdateOrder

> **Severity:** Standard | **Priority:** Medium | **Prompt #:** 46 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/automation_step_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-004 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Reorder steps within an automation. Takes a slice of (stepID, ordinal) tuples and runs the updates in a single transaction.

## What's Being Established

A single method `UpdateOrder` on the existing repo struct in `internal/database/automation_step_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *AutomationStepRepo) UpdateOrder(ctx context.Context, automationID int64, ordering []models.StepOrder) error {
    tx, err := r.pool.Begin(ctx)
    if err != nil { return fmt.Errorf("begin: %w", err) }
    defer tx.Rollback(ctx)
    for _, o := range ordering {
        if _, err := tx.Exec(ctx, `UPDATE automation_steps SET ordinal=$1 WHERE id=$2 AND automation_id=$3`, o.Ordinal, o.ID, automationID); err != nil {
            return fmt.Errorf("reorder %d: %w", o.ID, err)
        }
    }
    return tx.Commit(ctx)
}
```

## Suggested Fix

1. Open `internal/database/automation_step_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `UpdateOrder` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("automation-steps-repo-update-order: %w", err)`.
5. 

## Acceptance Criteria

- Method `UpdateOrder` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/automation_step_repo.go -Pattern 'UpdateOrder'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/automation_step_repo.go
git commit -m "phase-5(repos): add UpdateOrder to automationsteprepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
