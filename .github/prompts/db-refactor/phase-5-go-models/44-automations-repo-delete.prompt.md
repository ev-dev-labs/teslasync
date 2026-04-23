---
description: "Phase 5 - implement Delete on AutomationRepo"
---

# 🔵 Repos 44 - AutomationRepo: Delete

> **Severity:** Standard | **Priority:** Medium | **Prompt #:** 44 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/automation_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-004 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Delete an automation. Children cascade via FK ON DELETE CASCADE.

## What's Being Established

A single method `Delete` on the existing repo struct in `internal/database/automation_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *AutomationRepo) Delete(ctx context.Context, id int64) error {
    _, err := r.pool.Exec(ctx, `DELETE FROM automations WHERE id=$1`, id)
    if err != nil { return fmt.Errorf("delete: %w", err) }
    return nil
}
```

## Suggested Fix

1. Open `internal/database/automation_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `Delete` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("automations-repo-delete: %w", err)`.
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
Select-String -Path internal/database/automation_repo.go -Pattern 'Delete'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/automation_repo.go
git commit -m "phase-5(repos): add Delete to automationrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
