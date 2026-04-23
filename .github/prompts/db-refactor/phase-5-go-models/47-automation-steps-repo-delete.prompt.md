---
description: "Phase 5 - implement Delete on AutomationStepRepo"
---

# 🔵 Repos 47 - AutomationStepRepo: Delete

> **Severity:** Standard | **Priority:** Medium | **Prompt #:** 47 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/automation_step_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-004 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Delete a single step. CTI child cascades via FK.

## What's Being Established

A single method `Delete` on the existing repo struct in `internal/database/automation_step_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *AutomationStepRepo) Delete(ctx context.Context, stepID int64) error {
    _, err := r.pool.Exec(ctx, `DELETE FROM automation_steps WHERE id=$1`, stepID)
    if err != nil { return fmt.Errorf("delete: %w", err) }
    return nil
}
```

## Suggested Fix

1. Open `internal/database/automation_step_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `Delete` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("automation-steps-repo-delete: %w", err)`.
5. 

## Acceptance Criteria

- Method `Delete` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/automation_step_repo.go -Pattern 'Delete'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/automation_step_repo.go
git commit -m "phase-5(repos): add Delete to automationsteprepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
