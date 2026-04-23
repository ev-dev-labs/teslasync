---
description: "Phase 5 - implement Upsert on AutomationStepChildRepo"
---

# 🔵 Repos 52 - AutomationStepChildRepo: Upsert

> **Severity:** Architectural | **Priority:** Medium | **Prompt #:** 52 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/automation_step_child_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-004 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Route an upsert to the correct CTI child table based on the step's typed `Kind`.

## What's Being Established

A single method `Upsert` on the existing repo struct in `internal/database/automation_step_child_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *AutomationStepChildRepo) Upsert(ctx context.Context, step models.AutomationStep, payload any) error {
    switch step.Kind {
    case string(models.TriggerSchedule):
        return r.upsertTriggerSchedule(ctx, step.ID, payload)
    case string(models.ActionCommand):
        return r.upsertActionCommand(ctx, step.ID, payload)
    /* ... 10 more cases ... */
    default:
        return fmt.Errorf("unknown step kind: %s", step.Kind)
    }
}
```

## Suggested Fix

1. Open `internal/database/automation_step_child_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `Upsert` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("automation-step-children-upsert-router: %w", err)`.
5. 

## Acceptance Criteria

- Method `Upsert` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/automation_step_child_repo.go -Pattern 'Upsert'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/automation_step_child_repo.go
git commit -m "phase-5(repos): add Upsert to automationstepchildrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
