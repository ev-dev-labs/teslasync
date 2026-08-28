---
applyTo: "internal/models/**,internal/database/**,migrations/**"
---

# Data Modeling & Schema Instructions

## Source of Truth Chain

```
Migration SQL (schema) → models/*.go (struct + db tags) → *_repo.go (SQL + Scan) → *_handler.go (JSON)
```

ALL layers must stay in sync. A field rename in models that isn't propagated to
repos and handlers causes cascading compile errors across 20+ files.

### Layering rule (ADR-002)

State reads (point-in-time "what was the value of X at time T?") belong in
`internal/signal/` behind the `signal.StateReader` port — they are cold-path SQL
forward-folds of the `signal_log` change feed. Change-feed reads (raw event streams
and aggregations over `signal_log`) belong in `internal/database/`. New repos that
return point-in-time signal state from `signal_log` MUST live in `internal/signal/`,
NOT in `internal/database/`. See ADR-002 in `.github/ARCHITECTURE.md`.

## Model Struct Conventions

### Field Naming

```go
// ✅ GOOD — unit suffix in field name + db tag
DistanceMi      float64    `db:"distance_mi"      json:"distance_mi"`
MaxSpeedMph     *float64   `db:"max_speed_mph"     json:"max_speed_mph"`
InsideTempAvgC  *float64   `db:"inside_temp_avg_c" json:"inside_temp_avg_c"`
StartBatteryPct *int16     `db:"start_battery_pct" json:"start_battery_pct"`
EnergyAddedKwh  *float64   `db:"energy_added_kwh"  json:"energy_added_kwh"`
ChargerPowerKwMax *float64 `db:"charger_power_kw_max" json:"charger_power_kw_max"`
ElevationM      *float64   `db:"elevation_m"       json:"elevation_m"`

// ❌ BAD — ambiguous, what unit is this?
Distance        float64    `db:"distance"`          // miles? km? meters?
SpeedMax        float64    `db:"speed_max"`          // mph? km/h?
TempAvg         float64    `db:"temp_avg"`            // celsius? fahrenheit?
BatteryLevel    int        `db:"battery_level"`       // percent? voltage?
ChargerPower    float64    `db:"charger_power"`       // kW? W? hp?
```

**Rule:** Every numeric measurement field MUST have a unit suffix:
| Unit | Suffix | Example |
|---|---|---|
| Miles | `_mi` | `distance_mi` |
| Kilometers | `_km` | `distance_km` |
| Miles per hour | `_mph` | `max_speed_mph` |
| Km per hour | `_kmh` | `max_speed_kmh` |
| Celsius | `_c` | `outside_temp_avg_c` |
| Fahrenheit | `_f` | `outside_temp_avg_f` |
| Percentage | `_pct` | `start_battery_pct` |
| Kilowatt-hours | `_kwh` | `energy_added_kwh` |
| Kilowatts | `_kw` | `charger_power_kw_max` |
| Meters | `_m` | `elevation_m` |
| Minutes | `_min` | `duration_min` |
| Seconds | `_sec` | `awake_interval_sec` |
| PSI | `_psi` | `tire_pressure_fl_psi` |
| Bar | `_bar` | `tire_pressure_fl_bar` |

### Timestamp Naming

```go
// ✅ GOOD — use _ts suffix for timestamps, _at suffix for created/updated
StartTs     time.Time  `db:"start_ts"`      // event start
EndTs       *time.Time `db:"end_ts"`        // nullable event end
CreatedAt   time.Time  `db:"created_at"`    // row creation audit
UpdatedAt   time.Time  `db:"updated_at"`    // row update audit
EnrolledAt  time.Time  `db:"enrolled_at"`   // business event

// ❌ BAD — ambiguous date naming
StartDate   time.Time  `db:"start_date"`    // is this a date or datetime?
EndDate     time.Time  `db:"end_date"`      // same ambiguity
```

### Nullable Fields

Go pointers map to SQL NULL:
```go
// ✅ GOOD — nullable fields are pointers
EndTs           *time.Time `db:"end_ts"`        // NULL while in progress
EndBatteryPct   *int16     `db:"end_battery_pct"`
ChargerLocation *string    `db:"charger_location"`

// ❌ BAD — non-pointer for nullable column causes scan errors
EndTs           time.Time  `db:"end_ts"`        // can't hold NULL!
```

### db Tag = JSON Tag = SQL Column

All three must use the same snake_case name:
```go
// ✅ GOOD — all three match
ChargerPowerKwMax *float64 `db:"charger_power_kw_max" json:"charger_power_kw_max"`
// SQL: SELECT charger_power_kw_max FROM charging_sessions

// ❌ BAD — mismatches cause silent bugs
ChargerPower *float64 `db:"charger_power" json:"charger_power_kw"` // db ≠ json!
```

### ID Fields

```go
// ✅ GOOD — primary key is always `ID`, foreign keys are descriptive
ID        int64  `db:"id"`
VehicleID int64  `db:"vehicle_id"`
TeslaID   int64  `db:"tesla_id"`     // Tesla's numeric identifier

// ❌ BAD — ambiguous ID naming
VehicleID int64  `db:"vehicle_id"`   // on the Vehicle struct itself (use ID)
```

**Rule:** On the entity's own struct, the primary key is `ID`. On a referencing
struct, use `{Entity}ID` (e.g., `VehicleID` on `Drive`).

## No JSONB for Typed Data (ADR-001)

```
❌ DO NOT store structured data as JSONB when the schema is known at design time
❌ DO NOT add a `raw_json jsonb` column to "store the full API response"
❌ DO NOT use `json.RawMessage` fields on models for typed data

✅ DO define explicit typed columns for every field
✅ DO use the Class-Table-Inheritance (CTI) pattern for polymorphic entities
✅ DO keep JSONB only for truly dynamic/opaque payloads (user-provided webhook bodies)
```

**Why:** JSONB bypasses compile-time safety, prevents SQL indexing, and creates
a maintenance nightmare when field shapes change. The db-refactor proved this:
eliminating JSONB from 8 Tesla* tables required touching 30+ consumer files
because the `RawJSON` field was spread everywhere.

## Class-Table-Inheritance (CTI) Pattern (ADR-004)

For polymorphic entities where different rows have different field sets:

```sql
-- Parent table: common fields only
CREATE TABLE automations (
  id          bigint PRIMARY KEY,
  name        text NOT NULL,
  enabled     boolean DEFAULT true
);

-- Discriminator table: one row per child, kind selects the child table
CREATE TABLE automation_steps (
  id              bigint PRIMARY KEY,
  automation_id   bigint REFERENCES automations(id),
  step_order      int NOT NULL,
  kind            automation_step_kind NOT NULL  -- enum
);

-- Child tables: kind-specific columns only
CREATE TABLE automation_step_trigger_signal (
  step_id   bigint PRIMARY KEY REFERENCES automation_steps(id),
  signal    text NOT NULL,
  op        text NOT NULL,
  value_num double precision
);

CREATE TABLE automation_step_action_command (
  step_id       bigint PRIMARY KEY REFERENCES automation_steps(id),
  command_name  text NOT NULL,
  command_params jsonb  -- OK here: truly dynamic user input
);
```

**Go pattern:**
```go
// Parent
type Automation struct { ID int64; Name string; Enabled bool }

// Discriminator
type AutomationStep struct { ID int64; AutomationID int64; StepOrder int; Kind string }

// Aggregate (hydrated with children)
type AutomationFull struct {
    Automation
    Steps      []AutomationStep
    Triggers   []any  // loaded from child tables
    Conditions []any
    Actions    []any
}
```

## Unit-Aware Storage (ADR-020)

Tesla Fleet Telemetry sends values in the car's GUI unit. The unit preference
arrives as a separate signal and is cached in `vehicle_units`.

### Per-Row Unit Columns

Every table with unit-sensitive data has a `smallint` column:

```sql
ALTER TABLE drives ADD COLUMN distance_unit smallint NOT NULL DEFAULT 0;
ALTER TABLE drives ADD COLUMN temp_unit smallint NOT NULL DEFAULT 0;
ALTER TABLE tire_pressure_snapshots ADD COLUMN pressure_unit smallint NOT NULL DEFAULT 0;
```

Values match Tesla's proto enum:
```
DistanceUnit:    0=Unknown, 1=Miles, 2=Kilometers
TemperatureUnit: 0=Unknown, 1=Fahrenheit, 2=Celsius
PressureUnit:    0=Unknown, 1=PSI, 2=Bar
```

### Repo Write Pattern

```go
func (r *DriveRepo) Create(ctx context.Context, d *models.Drive) error {
    // Read cached car preference
    var distPref, tempPref string
    _ = r.db.Pool.QueryRow(ctx,
        `SELECT car_distance_pref, car_temp_pref FROM vehicle_units WHERE vehicle_id = $1`,
        d.VehicleID).Scan(&distPref, &tempPref)
    d.DistanceUnit = models.ParseDistanceUnit(distPref)
    d.TempUnit = models.ParseTemperatureUnit(tempPref)

    query := `INSERT INTO drives (..., distance_unit, temp_unit) VALUES (..., $N, $M)`
    // ...
}
```

## Migration Best Practices

### Review manifest (OPS-04) — required for every new migration

Every migration above `baseline_version` in `ops/migrations/manifest.yaml`
MUST have an entry recording four things, or `go run ./cmd/ops-gate -check migrations`
fails the build:

| Field | What it must answer |
|---|---|
| `forward_compatible` | Can the PREVIOUS application revision still run against the NEW schema? Required for rolling deploys, where both revisions are live at once. `false` demands either a `two_phase_plan` or `requires_downtime: true`. |
| `rollback_notes` | What an operator must do if the deploy is rolled back after this migration applied. Usually "leave it applied"; say so explicitly. |
| `expected_duration` + `duration_basis` | How long it takes on production data volumes, and whether that is `measured` or an `estimate`. |
| `lock_risk` + `lock_details` | `none`/`low`/`medium`/`high`, plus the locks taken and the mitigation. |

The gate also runs static SQL analysis over the `.up.sql` and **fails if
the declared `lock_risk` is weaker than what it detects** — e.g.
declaring `low` on a migration that does `CREATE INDEX` on an existing
table. Detected patterns: index-without-`CONCURRENTLY`, `ADD COLUMN … NOT NULL`
without `DEFAULT`, `ALTER COLUMN … TYPE`, `DROP COLUMN`/`DROP TABLE`,
`ADD CONSTRAINT` without `NOT VALID`, and `UPDATE`/`DELETE` without a
`WHERE` clause.

```bash
go run ./cmd/ops-gate -check migrations
```

### File Naming
```
migrations/000143_add_unit_columns.up.sql
migrations/000143_add_unit_columns.down.sql
```

- Sequential numbering, 6-digit zero-padded
- Descriptive snake_case suffix
- Always provide both up AND down
- Check latest: `Get-ChildItem migrations -Filter "*.up.sql" | Sort-Object Name | Select-Object -Last 3`

### Column Operations

```sql
-- ✅ GOOD — safe column addition
ALTER TABLE drives ADD COLUMN IF NOT EXISTS distance_unit smallint NOT NULL DEFAULT 0;
COMMENT ON COLUMN drives.distance_unit IS 'DistanceUnit enum: 0=Unknown, 1=Miles, 2=Km';

-- ✅ GOOD — column rename via add+backfill+drop (safe for running systems)
ALTER TABLE drives ADD COLUMN IF NOT EXISTS start_ts timestamptz;
UPDATE drives SET start_ts = start_date WHERE start_ts IS NULL;
ALTER TABLE drives ALTER COLUMN start_ts SET NOT NULL;
ALTER TABLE drives DROP COLUMN IF EXISTS start_date;

-- ❌ BAD — direct rename breaks running code that references old name
ALTER TABLE drives RENAME COLUMN start_date TO start_ts;

-- ❌ BAD — no IF NOT EXISTS (fails on re-run)
ALTER TABLE drives ADD COLUMN distance_unit smallint;
```

### TimescaleDB Hypertables

```sql
-- Hypertables have composite PKs: (id, ts)
-- ❌ DO NOT add FK references TO a hypertable (TimescaleDB restriction)
-- ❌ DO NOT add UNIQUE constraints on non-partition-key columns
-- ✅ DO include the time column in any unique constraint/index
```

## Repo ↔ Model ↔ SQL Alignment Checklist

When modifying ANY model field, run this checklist:

```
□ 1. Update the model struct field name + db tag + json tag
□ 2. grep the old field name across ALL of internal/:
       Select-String -Recurse -Path internal\*.go -Pattern 'OldFieldName'
□ 3. Update every repo that SELECTs this column (SQL + Scan targets)
□ 4. Update every repo that INSERTs this column (SQL + $N + args)
□ 5. Update every handler that reads the field from the model
□ 6. Update every service/export/worker that accesses the field
□ 7. Verify column count = $N count = Scan count = arg count (PER QUERY)
□ 8. Run: go build -gcflags=-e ./...  (extended errors, catches ALL failures)
□ 9. Run: go vet ./...
□ 10. Run: go test -count=1 ./...
```

**The `-gcflags=-e` flag is critical.** Without it, Go stops at ~10 errors per
package, hiding dozens of remaining failures in other packages. Always use
extended error mode when doing field renames.

## Anti-Patterns from db-refactor (Hard-Won Lessons)

```
❌ DO NOT rename a model field and only fix the repo that owns it
   (handlers, services, exports, workers also access model fields directly)

❌ DO NOT rely on `go build ./...` to find ALL errors
   (it stops at 10 per package — use `go build -gcflags=-e ./...`)

❌ DO NOT use ambiguous field names without unit suffixes
   (Distance, Speed, Temp, Level, Power — always specify the unit)

❌ DO NOT store API responses as raw JSONB "just in case"
   (creates untraceable field dependencies across the codebase)

❌ DO NOT use struct field access (d.StartDate) in SQL column names
   (the db tag is the column name: d.StartTs → "start_ts")

❌ DO NOT assume nullable DB columns can use non-pointer Go types
   (SQL NULL → Go nil → must be a pointer type)

❌ DO NOT create wide denormalized tables with 50+ columns
   (prefer smaller focused tables joined at query time)
```
