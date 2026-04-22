---
description: "Phase 5 — Rewrite snapshot repos to drop signals jsonb writes; route through hot-typed columns only"
---

# 🟢 Models 05 — Snapshot Repos (drop signals jsonb)

> **Severity:** Standard (cleanup) | **Priority:** Medium-High | **Prompt #:** 5 of 6

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `internal/database/positions_repo.go`, `charging_telemetry_repo.go`, `climate_repo.go`, `motor_repo.go`, `security_repo.go`, `vehicle_meta_snapshots_repo.go`, `vehicle_live_state_repo.go` |
| Depends on | `01-regenerate-models`, `02-delete-eliminated-fields` |
| Blocks | Phase 6 |
| ADR refs | ADR-002 |
| Estimated effort | small-medium (~half day) |

## Single Goal

Update each snapshot repo so its INSERT and SELECT statements reference only the typed columns from Phase 3 — no `signals jsonb` column writes, no jsonb scans.

## What's Being Established

The new snapshot tables have no `signals jsonb` column at all. Old repos write to it. After this prompt, the repos write only to typed columns. Anything that doesn't fit a typed column is the **Phase 6** telemetry handler's responsibility to route to `signal_observations` instead.

## Recommendation

### Pattern (apply to each snapshot repo)

**Before** (typical legacy):
```go
const insertQ = `INSERT INTO climate_snapshots
  (ts, vehicle_id, inside_temp_c, outside_temp_c, signals)
  VALUES ($1,$2,$3,$4,$5)`
_, err := r.db.Pool.Exec(ctx, insertQ, ts, vid, inT, outT, signalsJSON)
```

**After**:
```go
const insertQ = `INSERT INTO climate_snapshots
  (ts, vehicle_id, inside_temp_c, outside_temp_c, hvac_auto_mode, defrost_mode,
   driver_temp_setting_c, passenger_temp_setting_c)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
_, err := r.db.Pool.Exec(ctx, insertQ, snap.Ts, snap.VehicleID, snap.InsideTempC, snap.OutsideTempC,
    snap.HvacAutoMode, snap.DefrostMode, snap.DriverTempSettingC, snap.PassengerTempSettingC)
```

### Bulk-insert path (for telemetry batches)

Each snapshot repo gets a `BulkInsert([]models.X) error` method using `pgx.CopyFrom` for the throughput path the telemetry handler will call.

```go
func (r *PositionsRepo) BulkInsert(ctx context.Context, snaps []models.Position) error {
    if len(snaps) == 0 { return nil }
    rows := make([][]any, 0, len(snaps))
    for _, s := range snaps {
        rows = append(rows, []any{
            s.Ts, s.VehicleID, s.Latitude, s.Longitude,
            s.SpeedMps, s.HeadingDeg, s.AltitudeM, s.Source,
        })
    }
    _, err := r.db.Pool.CopyFrom(ctx,
        pgx.Identifier{"positions"},
        []string{"ts","vehicle_id","latitude","longitude","speed_mps","heading_deg","altitude_m","source"},
        pgx.CopyFromRows(rows))
    if err != nil { return fmt.Errorf("positions bulk insert (%d): %w", len(snaps), err) }
    return nil
}
```

### `vehicle_live_state_repo.go` — UPSERT (write-through)

This is the only mutable snapshot repo. Pattern:

```go
// Upsert merges the partial state from a single signal/batch into the existing row.
// Uses INSERT ... ON CONFLICT (vehicle_id) DO UPDATE with COALESCE() to preserve
// non-null prior values when the new write doesn't include that column.
func (r *VehicleLiveStateRepo) Upsert(ctx context.Context, state *models.VehicleLiveState) error {
    const q = `
      INSERT INTO vehicle_live_state (vehicle_id, ts, battery_level, charge_state, ...)
      VALUES ($1, $2, $3, $4, ...)
      ON CONFLICT (vehicle_id) DO UPDATE SET
        ts            = GREATEST(vehicle_live_state.ts, EXCLUDED.ts),
        battery_level = COALESCE(EXCLUDED.battery_level, vehicle_live_state.battery_level),
        charge_state  = COALESCE(EXCLUDED.charge_state,  vehicle_live_state.charge_state),
        ...`
    _, err := r.db.Pool.Exec(ctx, q, /* args ... */)
    return err
}
```

## Suggested Fix

1. List affected repos via `Select-String -Pattern 'signals.*\$\d' internal\database\*.go`
2. For each: rewrite INSERT and SELECT statements to use only typed columns
3. Add `BulkInsert` to each snapshot repo using `CopyFrom`
4. Special-case `vehicle_live_state_repo.go`: implement `Upsert` with `COALESCE` partial-merge
5. Update HTTP handlers (sweeping pass; the deeper rewrite is Phase 6)
6. Build + test + commit

## Acceptance Criteria

- [ ] No INSERT in any snapshot repo references a `signals` column
- [ ] No SELECT in any snapshot repo SELECTs a `signals` column
- [ ] Each snapshot repo has a `BulkInsert` method using `CopyFrom`
- [ ] `vehicle_live_state_repo.go` has an `Upsert` method using `ON CONFLICT … DO UPDATE … COALESCE`
- [ ] Repo unit tests pass
- [ ] `go build ./...` + `go test -race ./internal/database/...` exit 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync

# No remaining 'signals' column references in repo INSERT/SELECT
Select-String -Path internal\database\*_repo.go -Pattern '"signals"|signals\s*[\)\]]' |
  Where-Object { $_.Path -notmatch 'signal_(observations|catalog)' }
# Expected: 0 hits

# Every snapshot repo has BulkInsert
@('positions_repo.go','charging_telemetry_repo.go','climate_repo.go','motor_repo.go','security_repo.go') |
  ForEach-Object {
    $f = "internal\database\$_"
    if (-not (Select-String -Path $f -Pattern 'func.*BulkInsert')) { Write-Host "MISSING: $_" }
  }
# Expected: no MISSING output

go test -race -count=1 ./internal/database/...
```

## Out of Scope

- Don't yet route signals from telemetry into these repos (Phase 6)
- Don't write the hot-signal catalog metadata here — that's Phase 6's `internal/telemetry/hot_signals.go`
- Don't change HTTP response shapes — types stay snake_case; field set widens but doesn't shrink (after frontend Phase 7 ships)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/database/ internal/api/
git commit -m "repo(db-refactor): drop signals jsonb writes; add BulkInsert to snapshot repos

ADR-002: snapshot repos now write only to typed columns. Each gets a
CopyFrom-based BulkInsert for the Phase 6 telemetry batch path.
vehicle_live_state_repo.Upsert merges partial state via ON CONFLICT
... DO UPDATE ... COALESCE.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002
- `phase-3-schema/02-create-vehicle-live-state.prompt.md` (write-through SoT)
- `phase-3-schema/03-create-positions-hypertable.prompt.md` (and 04-07, 10)
