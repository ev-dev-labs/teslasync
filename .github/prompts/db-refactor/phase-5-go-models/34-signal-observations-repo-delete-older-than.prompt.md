---
description: "Phase 5 - implement DeleteOlderThan on SignalObservationRepo"
---

# 🔵 Repos 34 - SignalObservationRepo: DeleteOlderThan

> **Severity:** Standard | **Priority:** High | **Prompt #:** 34 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/signal_observation_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-001 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Drop observations older than `cutoff`. Used by the cold-storage retention worker.

## What's Being Established

A single method `DeleteOlderThan` on the existing repo struct in `internal/database/signal_observation_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *SignalObservationRepo) DeleteOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
    tag, err := r.pool.Exec(ctx, `DELETE FROM signal_observations WHERE ts < $1`, cutoff)
    if err != nil { return 0, fmt.Errorf("delete older than: %w", err) }
    return tag.RowsAffected(), nil
}
```

## Suggested Fix

1. Open `internal/database/signal_observation_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `DeleteOlderThan` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("signal-observations-repo-delete-older-than: %w", err)`.
5. 

## Acceptance Criteria

- Method `DeleteOlderThan` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/signal_observation_repo.go -Pattern 'DeleteOlderThan'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/signal_observation_repo.go
git commit -m "phase-5(repos): add DeleteOlderThan to signalobservationrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
