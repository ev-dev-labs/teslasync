---
description: "Phase 5 - implement BulkInsert on SignalObservationRepo"
---

# 🔵 Repos 30 - SignalObservationRepo: BulkInsert

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 30 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/signal_observation_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-001, ADR-002 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Bulk-insert signal observations using `pgx.CopyFrom` for high-throughput telemetry ingest (ADR-001).

## What's Being Established

A single method `BulkInsert` on the existing repo struct in `internal/database/signal_observation_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *SignalObservationRepo) BulkInsert(ctx context.Context, obs []models.SignalObservation) error {
    if len(obs) == 0 { return nil }
    rows := pgx.CopyFromSlice(len(obs), func(i int) ([]any, error) {
        o := obs[i]
        return []any{o.VehicleID, o.Ts, o.SignalID, o.NumValue, o.StrValue}, nil
    })
    _, err := r.pool.CopyFrom(ctx, pgx.Identifier{"signal_observations"},
        []string{"vehicle_id", "ts", "signal_id", "num_value", "str_value"}, rows)
    if err != nil { return fmt.Errorf("signal observations bulk insert: %w", err) }
    return nil
}
```

## Suggested Fix

1. Open `internal/database/signal_observation_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `BulkInsert` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("signal-observations-repo-bulk-insert: %w", err)`.
5. 

## Acceptance Criteria

- Method `BulkInsert` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/signal_observation_repo.go -Pattern 'BulkInsert'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/signal_observation_repo.go
git commit -m "phase-5(repos): add BulkInsert to signalobservationrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
