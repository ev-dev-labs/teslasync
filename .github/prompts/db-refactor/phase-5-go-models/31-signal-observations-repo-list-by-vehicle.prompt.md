---
description: "Phase 5 - implement ListByVehicle on SignalObservationRepo"
---

# 🔵 Repos 31 - SignalObservationRepo: ListByVehicle

> **Severity:** Standard | **Priority:** High | **Prompt #:** 31 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/signal_observation_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-6-handlers/*` |
| ADR refs | ADR-001 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Return signal observations for a vehicle in a time window, ordered by ts ASC.

## What's Being Established

A single method `ListByVehicle` on the existing repo struct in `internal/database/signal_observation_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *SignalObservationRepo) ListByVehicle(ctx context.Context, vehicleID int64, from, to time.Time, limit int) ([]models.SignalObservation, error) {
    rows, err := r.pool.Query(ctx, `SELECT vehicle_id, ts, signal_id, num_value, str_value FROM signal_observations WHERE vehicle_id=$1 AND ts BETWEEN $2 AND $3 ORDER BY ts ASC LIMIT $4`, vehicleID, from, to, limit)
    if err != nil { return nil, fmt.Errorf("list by vehicle: %w", err) }
    defer rows.Close()
    var out []models.SignalObservation
    for rows.Next() {
        var o models.SignalObservation
        if err := rows.Scan(&o.VehicleID, &o.Ts, &o.SignalID, &o.NumValue, &o.StrValue); err != nil { return nil, err }
        out = append(out, o)
    }
    return out, rows.Err()
}
```

## Suggested Fix

1. Open `internal/database/signal_observation_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `ListByVehicle` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("signal-observations-repo-list-by-vehicle: %w", err)`.
5. 

## Acceptance Criteria

- Method `ListByVehicle` exists on the repo.
- All queries are parameterized.
- Errors are wrapped with context.
- `go build ./internal/database/...` succeeds.
- No reference to eliminated fields (`raw_json`, dropped snapshot columns, etc.).

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/database/...
Select-String -Path internal/database/signal_observation_repo.go -Pattern 'ListByVehicle'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/signal_observation_repo.go
git commit -m "phase-5(repos): add ListByVehicle to signalobservationrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
