# 03 — Update Go Models and Repos

**Phase:** 5
**Branch:** `db-refactor/timescaledb-migration-mo-jsonb-at-all`
**Pre-req:** Migration 000142 applies cleanly
**Estimated effort:** 3-4 days

---

## Goal

Bring `internal/models/` and `internal/database/*Repo.go` into alignment with the new typed schema. Eliminate every `json.RawMessage`, `pgtype.JSONB`, or `[]byte` field that corresponds to an eliminated jsonb column.

## Scope

**Files affected (estimated):**
- `internal/models/models.go` — ~30 struct changes
- `internal/database/*_repo.go` — 27 repo files, ~10 of them rewritten substantially
- New: `internal/database/signal_observations_repo.go`
- New: `internal/database/signal_catalog_repo.go`
- New: `internal/database/automation_steps_repo.go` (replaces JSON-based automation persistence)

## Step-by-step

### Step 1: Regenerate model structs

For each table in the new schema, define a Go struct with:
- `json` tags matching the **snake_case** column names (frontend expects this)
- `db` tags identical to column names (used by some pgx scan helpers)
- Nullable columns → pointer types (`*float64`, `*string`, `*time.Time`)
- timestamptz → `time.Time` (or `*time.Time` for nullable)
- enums → typed `string` aliases with constants:
  ```go
  type AutomationStepKind string
  const (
    StepKindTriggerSignal   AutomationStepKind = "trigger_signal"
    StepKindTriggerGeofence AutomationStepKind = "trigger_geofence"
    // ...
  )
  ```
- One Go struct per child table (ADR-004): `AutomationStepTriggerSignal`, `AutomationStepConditionTimeWindow`, etc.
- Composite read shape: `AutomationFull` aggregates `Automation` + `[]AutomationStep` + per-step typed details for repository return values

### Step 2: Delete eliminated fields

For every `tesla_*` model, remove the `RawJSON json.RawMessage` field. Ensure no reader anywhere references it (`grep RawJSON internal/`).

For every snapshot model (`Position`, `ChargingTelemetry`, `ClimateSnapshot`, etc.), remove the `Signals map[string]any` (or equivalent) field. Replaced by typed columns + `signal_observations`.

### Step 3: Rewrite signal-handling repos

**New `SignalObservationsRepo`:**
```go
type SignalObservationsRepo struct { db *DB }
func (r *SignalObservationsRepo) BulkInsert(ctx context.Context, obs []SignalObservation) error
func (r *SignalObservationsRepo) QuerySignalForVehicle(ctx context.Context, vehicleID int64, signalName string, since, until time.Time) ([]SignalObservation, error)
func (r *SignalObservationsRepo) ListSignalsByVehicle(ctx context.Context, vehicleID int64, since time.Time) ([]string, error)
```
Use `pgx.CopyFrom` for bulk inserts.

**New `SignalCatalogRepo`:**
```go
func (r *SignalCatalogRepo) Upsert(ctx context.Context, name string) error  // bumps last_seen_at + count
func (r *SignalCatalogRepo) ListByTier(ctx context.Context, tier string) ([]SignalCatalogEntry, error)
func (r *SignalCatalogRepo) Promote(ctx context.Context, name, tableName, columnName string) error
```

### Step 4: Rewrite automation repo

**Single-row reads become joins:**
```go
func (r *AutomationRepo) GetFull(ctx context.Context, id int64) (*AutomationFull, error) {
  // 1. SELECT from automations
  // 2. SELECT from automation_steps WHERE automation_id = $1 ORDER BY step_order
  // 3. For each step kind, SELECT from the matching child table
  // Return the assembled AutomationFull
}
```

**Writes use a transaction:**
```go
func (r *AutomationRepo) Create(ctx context.Context, a *AutomationFull) error {
  // tx: insert into automations, then for each step:
  //   insert into automation_steps RETURNING id
  //   insert into the matching child table with step_id
}
```

### Step 5: Telemetry write path

**This is its own prompt (`04-update-telemetry-write-path`).** Don't change `telemetry_handler.go` here — leave it for prompt 04.

But: ensure the new `SignalObservationsRepo` is wired into the handler's constructor in `cmd/teslasync/main.go` so prompt 04 can pick it up.

### Step 6: Tesla integration repos

For each `tesla_*` repo, remove all references to `raw_json`/`data`/`site_info_json`/`invitations` jsonb columns. The Go-side handlers should now extract every needed field from the Tesla API response into typed columns at write time, not lazily from the jsonb at read time.

### Step 7: Analytics services (per ADR-006)

Create `internal/analytics/`:
- `drive_score.go` — Go port of `fn_drive_score_*`
- `anomaly.go` — Go port of `fn_anomaly_*`
- `battery_health.go` — Go port of `fn_battery_degradation_rate`, `fn_battery_risk_factors`
- `tco.go` — Go port of `fn_true_cost_*`
- `compare.go` — Go port of `fn_compare_periods`
- `efficiency.go` — Go port of `fn_route_efficiency`, `fn_speed_profile_histogram`, `fn_sleep_efficiency`

Each service:
- Takes interfaces (DB, settings) for testability
- Has unit tests with table-driven scenarios
- Returns typed structs, not maps

Update API handlers to call the services instead of the deleted DB functions.

## Validation

```powershell
go build ./...
go vet ./...
go test -race -count=1 ./...
golangci-lint run ./...
```

All must pass.

Additionally:
```powershell
# Should return zero matches:
Select-String -Path internal\**\*.go -Pattern 'json\.RawMessage|pgtype\.JSONB' -Recurse
Select-String -Path internal\**\*.go -Pattern 'raw_json|RawJSON' -Recurse | Where-Object { $_.Line -notmatch '//' }
```

## Exit gate

- [ ] `go build ./...` clean
- [ ] `go test -race ./...` all pass
- [ ] `go vet` and `golangci-lint` clean
- [ ] No `json.RawMessage` or `pgtype.JSONB` in `internal/` (except inside `automation_actions.command_params` handling)
- [ ] No `RawJSON`/`raw_json` references outside the migration drop statements
- [ ] All 27 repos compile
- [ ] New `SignalObservationsRepo`, `SignalCatalogRepo`, `AutomationStepsRepo` exist with tests
- [ ] All 6 analytics services exist in `internal/analytics/` with unit tests
