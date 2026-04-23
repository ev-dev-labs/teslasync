---
description: "Phase 5 - implement GetByID on AutomationRepo"
---

# 🔵 Repos 39 - AutomationRepo: GetByID

> **Severity:** Standard | **Priority:** Medium | **Prompt #:** 39 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/automation_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-004 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Return an automation parent row by id (no children).

## What's Being Established

A single method `GetByID` on the existing repo struct in `internal/database/automation_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *AutomationRepo) GetByID(ctx context.Context, id int64) (*models.Automation, error) {
    var a models.Automation
    err := r.pool.QueryRow(ctx, `SELECT id, name, enabled, created_at FROM automations WHERE id=$1`, id).Scan(&a.ID, &a.Name, &a.Enabled, &a.CreatedAt)
    if err == pgx.ErrNoRows { return nil, nil }
    if err != nil { return nil, fmt.Errorf("get by id: %w", err) }
    return &a, nil
}
```

## Suggested Fix

1. Open `internal/database/automation_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `GetByID` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("automations-repo-get-by-id: %w", err)`.
5. 

## Acceptance Criteria

- Method `GetByID` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/automation_repo.go -Pattern 'GetByID'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/automation_repo.go
git commit -m "phase-5(repos): add GetByID to automationrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
