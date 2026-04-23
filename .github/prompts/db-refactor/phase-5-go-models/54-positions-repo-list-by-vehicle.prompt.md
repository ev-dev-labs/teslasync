---
description: "Phase 5 - implement ListByVehicle on PositionRepo"
---

# 🔵 Repos 54 - PositionRepo: ListByVehicle

> **Severity:** Standard | **Priority:** Medium | **Prompt #:** 54 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/position_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-5-go-models/67-build-models-package` |
| ADR refs | ADR-002 |
| Estimated effort | small (~15-30 min) |

## Single Goal

List positions for a vehicle in a time window.

## What's Being Established

A single method `ListByVehicle` on the existing repo struct in `internal/database/position_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *PositionRepo) ListByVehicle(ctx context.Context, vehicleID int64, from, to time.Time) ([]models.Position, error) {
    rows, err := r.pool.Query(ctx, `SELECT vehicle_id, ts, lat, lon, speed_kph FROM positions WHERE vehicle_id=$1 AND ts BETWEEN $2 AND $3 ORDER BY ts`, vehicleID, from, to)
    if err != nil { return nil, err }
    defer rows.Close()
    var out []models.Position
    for rows.Next() {
        var p models.Position
        if err := rows.Scan(&p.VehicleID, &p.Ts, &p.Lat, &p.Lon, &p.SpeedKph); err != nil { return nil, err }
        out = append(out, p)
    }
    return out, rows.Err()
}
```

## Suggested Fix

1. Open `internal/database/position_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `ListByVehicle` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("positions-repo-list-by-vehicle: %w", err)`.
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
Select-String -Path internal/database/position_repo.go -Pattern 'ListByVehicle'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/position_repo.go
git commit -m "phase-5(repos): add ListByVehicle to positionrepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
