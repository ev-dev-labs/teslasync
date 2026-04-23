---
description: "Phase 5 - implement Upsert on VehicleLiveStateRepo"
---

# 🔵 Repos 66 - VehicleLiveStateRepo: Upsert

> **Severity:** Architectural | **Priority:** Medium | **Prompt #:** 66 of 71

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file(s) | `internal/database/vehicle_live_state_repo.go` |
| Depends on | `phase-5-go-models/29-delete-eliminated-fields` |
| Blocks | `phase-5-go-models/67-build-models-package` |
| ADR refs | ADR-002 |
| Estimated effort | small (~15-30 min) |

## Single Goal

Write-through upsert. Uses `ON CONFLICT (vehicle_id) DO UPDATE` with `COALESCE` to preserve known fields and `GREATEST(ts, EXCLUDED.ts)` to never regress the timestamp (ADR-002).

## What's Being Established

A single method `Upsert` on the existing repo struct in `internal/database/vehicle_live_state_repo.go`. The repo struct itself is unchanged; only this method is added or rewritten.

## Recommendation

```go
func (r *VehicleLiveStateRepo) Upsert(ctx context.Context, s models.VehicleLiveState) error {
    const q = `INSERT INTO vehicle_live_state (vehicle_id, ts, state, soc, lat, lon)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (vehicle_id) DO UPDATE SET
                 ts    = GREATEST(vehicle_live_state.ts, EXCLUDED.ts),
                 state = COALESCE(EXCLUDED.state, vehicle_live_state.state),
                 soc   = COALESCE(EXCLUDED.soc,   vehicle_live_state.soc),
                 lat   = COALESCE(EXCLUDED.lat,   vehicle_live_state.lat),
                 lon   = COALESCE(EXCLUDED.lon,   vehicle_live_state.lon)`
    _, err := r.pool.Exec(ctx, q, s.VehicleID, s.Ts, s.State, s.SOC, s.Lat, s.Lon)
    if err != nil { return fmt.Errorf("live state upsert: %w", err) }
    return nil
}
```

## Suggested Fix

1. Open `internal/database/vehicle_live_state_repo.go` (create the file with the repo struct skeleton if this is the first method on this repo).
2. Add the `Upsert` method shown above.
3. Use parameterized queries only - no `fmt.Sprintf` into SQL.
4. Wrap errors with context: `fmt.Errorf("vehicle-live-state-repo-upsert: %w", err)`.
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
Select-String -Path internal/database/vehicle_live_state_repo.go -Pattern 'Upsert'
```

## Out of Scope

Handler wiring (Phase 6). Migration changes. Other methods on this repo (separate prompts).

## Commit When Done

```powershell
git add internal/database/vehicle_live_state_repo.go
git commit -m "phase-5(repos): add Upsert to vehiclelivestaterepo`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR docs: `docs/adr/`
- Phase 5 README: `.github/prompts/db-refactor/phase-5-go-models/README.md`
- Schema source: `.github/prompts/db-refactor/phase-3-schema/`
