---
description: "Phase 5 - implement loadTriggers on AutomationStepChildRepo"
---

# 🔵 Repos 49 - AutomationStepChildRepo: loadTriggers

> **Severity:** Architectural | **Priority:** Medium | **Prompt #:** 49 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/automation_step_child_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-004 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Single UNION query that returns trigger CTI rows for a batch of step ids. Avoids N+1 fan-out.

## What's Being Established

A single method `loadTriggers` on the existing repo struct in `internal/database/automation_step_child_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *AutomationStepChildRepo) loadTriggers(ctx context.Context, stepIDs []int64) (map[int64]any, error) {
    if len(stepIDs) == 0 { return nil, nil }
    const q = `SELECT step_id, 'schedule' AS kind, cron_expr AS payload FROM automation_step_trigger_schedule WHERE step_id = ANY($1)
               UNION ALL SELECT step_id, 'signal_event', signal_name FROM automation_step_trigger_signal_event WHERE step_id = ANY($1)
               UNION ALL SELECT step_id, 'state_enter', state_name FROM automation_step_trigger_state_enter WHERE step_id = ANY($1)
               UNION ALL SELECT step_id, 'webhook', endpoint FROM automation_step_trigger_webhook WHERE step_id = ANY($1)`
    rows, err := r.pool.Query(ctx, q, stepIDs)
    if err != nil { return nil, fmt.Errorf("load triggers: %w", err) }
    defer rows.Close()
    out := map[int64]any{}
    for rows.Next() { /* scan into typed struct based on kind */ }
    return out, rows.Err()
}
```

## Suggested Fix

1. Open `internal/database/automation_step_child_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `loadTriggers` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("automation-step-children-loader-trigger: %w", err)`.
5. 

## Acceptance Criteria

- Method `loadTriggers` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/automation_step_child_repo.go -Pattern 'loadTriggers'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/automation_step_child_repo.go
git commit -m "phase-5(repos): add loadTriggers to automationstepchildrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
