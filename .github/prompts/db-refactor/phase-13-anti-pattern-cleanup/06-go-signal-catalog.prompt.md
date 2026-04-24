---
description: "Phase-13 — Create Go signal catalog (centralize signal→column mapping)"
---
# Prompt 06 — Signal Catalog: Centralize signalToColumn + Column Metadata
> **Severity:** HIGH | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-13-06-go-signal-catalog.log` |
| Allowed files to change | `internal/database/signal_catalog.go` (CREATE), `internal/database/live_state_repo.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

Signal-to-column mappings are scattered:
- `live_state_repo.go:36-61` — `signalToColumn` map (15 entries)
- `live_state_repo.go:20-23` — `isVarcharCol` map
- `live_state_repo.go:26` — `isTimestampCol` map
- Other repos (`automation_repo.go`, `position_repo.go`, `security_repo.go`) hardcode
  column names like `"battery_level"`, `"speed_mph"`, `"sentry_mode"` inline.

If Tesla renames a signal or we rename a column, changes are needed in 5+ files.

## Task

### 1. Create `internal/database/signal_catalog.go`

```go
package database

// ColumnType indicates the Postgres type for type-aware encoding.
type ColumnType int
const (
    ColTypeNumeric   ColumnType = iota // float64 → double precision
    ColTypeVarchar                      // string → text/varchar
    ColTypeBool                         // bool → boolean
    ColTypeTimestamp                     // time.Time → timestamptz
)

// SignalMapping defines how a Tesla signal maps to a DB column.
type SignalMapping struct {
    Column string     // DB column name
    Type   ColumnType // Column type for encoding
}

// SignalCatalog is the single source of truth for Tesla signal → DB column mapping.
// Used by live_state_repo (UPSERT), automation_repo (condition checks),
// position_repo (INSERT), and any future signal consumers.
var SignalCatalog = map[string]SignalMapping{
    // Location
    "Latitude":   {Column: "latitude", Type: ColTypeNumeric},
    "Longitude":  {Column: "longitude", Type: ColTypeNumeric},
    "GpsHeading": {Column: "heading", Type: ColTypeNumeric},
    "GpsState":   {Column: "gps_state", Type: ColTypeVarchar},

    // Driving
    "VehicleSpeed": {Column: "speed_mph", Type: ColTypeNumeric},

    // Battery
    "BatteryLevel":   {Column: "battery_level", Type: ColTypeNumeric},
    "ChargeLimitSoc": {Column: "charge_limit_soc", Type: ColTypeNumeric},

    // Climate
    "InsideTemp":  {Column: "inside_temp_c", Type: ColTypeNumeric},
    "OutsideTemp": {Column: "outside_temp_c", Type: ColTypeNumeric},
    "DefrostMode": {Column: "defrost_mode", Type: ColTypeVarchar},

    // Charging
    "ChargerVoltage": {Column: "charger_voltage", Type: ColTypeNumeric},

    // Security
    "Locked":     {Column: "locked", Type: ColTypeBool},
    "SentryMode": {Column: "sentry_mode", Type: ColTypeBool},
}

// Derived maps (computed once at init, used by live_state_repo)
var (
    SignalToColumn  map[string]string
    IsVarcharCol    map[string]bool
    IsTimestampCol  map[string]bool
)

func init() {
    SignalToColumn = make(map[string]string, len(SignalCatalog))
    IsVarcharCol = make(map[string]bool)
    IsTimestampCol = make(map[string]bool)
    for signal, m := range SignalCatalog {
        SignalToColumn[signal] = m.Column
        switch m.Type {
        case ColTypeVarchar:
            IsVarcharCol[m.Column] = true
        case ColTypeTimestamp:
            IsTimestampCol[m.Column] = true
        }
    }
}
```

### 2. Update `live_state_repo.go`

Replace the three local maps with imports from the catalog:
- Delete `signalToColumn` (lines 35-61)
- Delete `isVarcharCol` (lines 20-23)
- Delete `isTimestampCol` (line 26)
- Replace references with `SignalToColumn`, `IsVarcharCol`, `IsTimestampCol`

### Important constraints

- **Do NOT change column names or signal names** — only move the definitions
- The `FlushLiveState` function's special handlers (Location, HvacPower, SentryMode, Locked,
  DCChargingPower) stay inline — they have custom logic beyond simple mapping
- Run existing `schema_test.go` if it validates the signal map

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
go vet ./...
# Verify signalToColumn is no longer locally defined in live_state_repo.go
grep -n "var signalToColumn\|var isVarcharCol\|var isTimestampCol" internal/database/live_state_repo.go
# Should return 0 matches (moved to signal_catalog.go)
```

Log result. STATUS=DONE only if build+vet pass AND local maps are deleted from live_state_repo.go.
