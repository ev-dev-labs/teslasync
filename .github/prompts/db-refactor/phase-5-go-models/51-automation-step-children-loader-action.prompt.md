---
description: "Phase 5 - implement loadActions on AutomationStepChildRepo"
---

# 🔵 Repos 51 - AutomationStepChildRepo: loadActions

> **Severity:** Architectural | **Priority:** Medium | **Prompt #:** 51 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/automation_step_child_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-004, ADR-005 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Single UNION query that returns action CTI rows for a batch of step ids. The `command` action carries `command_params jsonb` (sole ADR-005 carve-out).

## What's Being Established

A single method `loadActions` on the existing repo struct in `internal/database/automation_step_child_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *AutomationStepChildRepo) loadActions(ctx context.Context, stepIDs []int64) (map[int64]any, error) {
    if len(stepIDs) == 0 { return nil, nil }
    const q = `SELECT step_id, 'command' AS kind, command_name, command_params FROM automation_step_action_command WHERE step_id = ANY($1)
               UNION ALL SELECT step_id, 'notification', channel_id::text, NULL FROM automation_step_action_notification WHERE step_id = ANY($1)
               UNION ALL SELECT step_id, 'webhook', url, NULL FROM automation_step_action_webhook WHERE step_id = ANY($1)
               UNION ALL SELECT step_id, 'delay', duration::text, NULL FROM automation_step_action_delay WHERE step_id = ANY($1)`
    /* ... scan ... */
    return nil, nil
}
```

## Suggested Fix

1. Open `internal/database/automation_step_child_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `loadActions` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("automation-step-children-loader-action: %w", err)`.
5. 

## Acceptance Criteria

- Method `loadActions` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/automation_step_child_repo.go -Pattern 'loadActions'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/automation_step_child_repo.go
git commit -m "phase-5(repos): add loadActions to automationstepchildrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
