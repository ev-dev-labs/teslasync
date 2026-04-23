---
description: "Phase 5 - implement Insert on AutomationStepRepo"
---

# 🔵 Repos 45 - AutomationStepRepo: Insert

> **Severity:** Standard | **Priority:** Medium | **Prompt #:** 45 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/automation_step_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-004 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Insert a new step row (parent of the CTI child). Returns the assigned step id.

## What's Being Established

A single method `Insert` on the existing repo struct in `internal/database/automation_step_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *AutomationStepRepo) Insert(ctx context.Context, s *models.AutomationStep) error {
    return r.pool.QueryRow(ctx, `INSERT INTO automation_steps (automation_id, kind, ordinal) VALUES ($1,$2,$3) RETURNING id`, s.AutomationID, s.Kind, s.Ordinal).Scan(&s.ID)
}
```

## Suggested Fix

1. Open `internal/database/automation_step_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `Insert` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("automation-steps-repo-insert: %w", err)`.
5. 

## Acceptance Criteria

- Method `Insert` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/automation_step_repo.go -Pattern 'Insert'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/automation_step_repo.go
git commit -m "phase-5(repos): add Insert to automationsteprepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
