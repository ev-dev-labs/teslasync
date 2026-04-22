---
description: "Phase 6 — Build the in-memory HotSignalCatalog (Tesla name -> typed table+column)"
---

# 🔵 Write-Path 01 — HotSignalCatalog

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 1 of 4

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/hot_signals.go` (new package) |
| Depends on | Phase 5 complete |
| Blocks | `02-implement-flatten-compound`, `03-rewrite-telemetry-handler` |
| ADR refs | ADR-002 |
| Estimated effort | small (~half day) |

## Single Goal

Define `internal/telemetry/hot_signals.go` containing the static map that tells the telemetry handler "for signal X, write to table T column C using transformer F". Every Phase 3 typed snapshot column has at least one entry.

## What's Being Established

The hot-signal selection methodology was deferred from Phase 3 to here — this prompt is where it lands. Source of truth for the list:
1. Every typed column on `vehicle_live_state` (prompt 02)
2. Every typed column on `positions` (prompt 03)
3. Every typed column on `charging_telemetry` (prompt 04)
4. Every typed column on `climate_snapshots` (prompt 05)
5. Every typed column on `motor_snapshots` (prompt 06)
6. Every typed column on `security_events` (prompt 07)
7. Every typed column on `vehicle_meta_snapshots` (prompt 10)

Anything not in the catalog → cold path.

## Recommendation

```go
package telemetry

import (
    "fmt"
    "strconv"
    "strings"
)

// SignalKind classifies how a raw Fleet Telemetry value is converted before write.
type SignalKind string

const (
    KindNumeric          SignalKind = "numeric"           // raw float64
    KindText             SignalKind = "text"              // raw string
    KindBool             SignalKind = "bool"              // raw bool
    KindEnumNormalized   SignalKind = "enum_normalized"   // text via Transformer (lowercase, alias map)
    KindCompoundDoors    SignalKind = "compound_doors"    // expanded by Flatten()
    KindCompoundWindows  SignalKind = "compound_windows"
    KindCompoundLocation SignalKind = "compound_location"
    KindCompoundTime     SignalKind = "compound_time"
)

type HotSignal struct {
    Name        string
    Table       string
    Column      string
    Kind        SignalKind
    Transformer func(raw any) (any, error) // nil = pass-through
}

// HotSignalCatalog is the static routing map.
// Keys are Tesla signal names exactly as Fleet Telemetry emits them.
var HotSignalCatalog = map[string]HotSignal{
    // ===== positions =====
    "VehicleSpeed":  {"VehicleSpeed",  "positions", "speed_mps",   KindNumeric, ConvertMphToMps},
    "Heading":       {"Heading",       "positions", "heading_deg", KindNumeric, nil},
    "Elevation":     {"Elevation",     "positions", "altitude_m",  KindNumeric, nil},
    "Location":      {"Location",      "positions", "",            KindCompoundLocation, nil}, // expands to lat/lon

    // ===== vehicle_live_state =====
    "BatteryLevel":  {"BatteryLevel",  "vehicle_live_state", "battery_level",  KindNumeric, nil},
    "ChargeState":   {"ChargeState",   "vehicle_live_state", "charge_state",   KindEnumNormalized, NormalizeChargeState},
    "Gear":          {"Gear",          "vehicle_live_state", "gear",           KindEnumNormalized, NormalizeGear},
    "Soc":           {"Soc",           "vehicle_live_state", "battery_level",  KindNumeric, nil}, // alias
    // ... ~30 more vehicle_live_state columns ...

    // ===== charging_telemetry =====
    "ChargerPower":          {"ChargerPower",          "charging_telemetry", "charger_power_kw",       KindNumeric, nil},
    "ChargerVoltage":        {"ChargerVoltage",        "charging_telemetry", "charger_voltage",        KindNumeric, nil},
    "ChargerActualCurrent":  {"ChargerActualCurrent",  "charging_telemetry", "charger_actual_current", KindNumeric, nil},
    "ChargeEnergyAdded":     {"ChargeEnergyAdded",     "charging_telemetry", "charge_energy_added_kwh",KindNumeric, nil},
    "ScheduledChargingStartTime": {"ScheduledChargingStartTime", "charging_telemetry", "scheduled_charging_at", KindCompoundTime, nil},
    // ... more ...

    // ===== climate_snapshots =====
    "InsideTemp":           {"InsideTemp",           "climate_snapshots", "inside_temp_c",      KindNumeric, nil},
    "OutsideTemp":          {"OutsideTemp",          "climate_snapshots", "outside_temp_c",     KindNumeric, nil},
    "HvacAutoMode":         {"HvacAutoMode",         "climate_snapshots", "hvac_auto_mode",     KindEnumNormalized, NormalizeHvacAutoMode},
    "DefrostMode":          {"DefrostMode",          "climate_snapshots", "defrost_mode",       KindEnumNormalized, NormalizeDefrostMode},
    "DriverTempSetting":    {"DriverTempSetting",    "climate_snapshots", "driver_temp_setting_c",    KindNumeric, nil},
    "PassengerTempSetting": {"PassengerTempSetting", "climate_snapshots", "passenger_temp_setting_c", KindNumeric, nil},

    // ===== motor_snapshots =====
    "RearMotorRpm":  {"RearMotorRpm",  "motor_snapshots", "rear_motor_rpm",  KindNumeric, nil},
    "FrontMotorRpm": {"FrontMotorRpm", "motor_snapshots", "front_motor_rpm", KindNumeric, nil},
    "BatteryTemp":   {"BatteryTemp",   "motor_snapshots", "battery_temp_c",  KindNumeric, nil},

    // ===== security_events (compounds expand here) =====
    "DoorState":   {"DoorState",   "security_events", "", KindCompoundDoors,   nil},
    "WindowState": {"WindowState", "security_events", "", KindCompoundWindows, nil},
    "Locked":      {"Locked",      "security_events", "locked", KindBool, nil},
    "SentryMode":  {"SentryMode",  "security_events", "sentry_mode", KindEnumNormalized, NormalizeSentryMode},
    "TonneauPosition": {"TonneauPosition", "security_events", "tonneau_position", KindEnumNormalized, NormalizeTonneauPosition},
    "TonneauTentMode": {"TonneauTentMode", "security_events", "tonneau_tent_mode", KindEnumNormalized, NormalizeTonneauTentMode},
    "TurnSignal":  {"TurnSignal",  "security_events", "turn_signal", KindEnumNormalized, NormalizeTurnSignal},

    // ===== vehicle_meta_snapshots (5 categories) =====
    "TirePressureFL": {"TirePressureFL", "vehicle_meta_snapshots", "tire_pressure_fl_psi", KindNumeric, nil},
    "TirePressureFR": {"TirePressureFR", "vehicle_meta_snapshots", "tire_pressure_fr_psi", KindNumeric, nil},
    "TirePressureRL": {"TirePressureRL", "vehicle_meta_snapshots", "tire_pressure_rl_psi", KindNumeric, nil},
    "TirePressureRR": {"TirePressureRR", "vehicle_meta_snapshots", "tire_pressure_rr_psi", KindNumeric, nil},
    "MediaVolume":    {"MediaVolume",    "vehicle_meta_snapshots", "media_volume",         KindNumeric, nil},
    "CenterDisplay":  {"CenterDisplay",  "vehicle_meta_snapshots", "center_display",       KindEnumNormalized, NormalizeCenterDisplay},
    // ... rest of meta cols ...
}

// LookupHot returns the routing entry, or nil if the signal is cold.
func LookupHot(name string) *HotSignal {
    if h, ok := HotSignalCatalog[name]; ok { return &h }
    return nil
}
```

### Transformer functions

Live in same file. Each takes `any`, returns `(any, error)`. Reuse the existing normalizers from migrations 000129–000139 logic — those normalization rules are already validated in DB CHECK constraints, so the Go side should produce values that pass.

```go
func ConvertMphToMps(raw any) (any, error) {
    f, err := toFloat64(raw)
    if err != nil { return nil, err }
    return f * 0.44704, nil
}

func NormalizeChargeState(raw any) (any, error) {
    s, ok := raw.(string)
    if !ok { return nil, fmt.Errorf("ChargeState: expected string, got %T", raw) }
    s = strings.ToLower(strings.TrimSpace(s))
    // alias map for Tesla's variant spellings
    aliases := map[string]string{"chargingcomplete": "complete", "starting": "charging"}
    if v, ok := aliases[s]; ok { return v, nil }
    return s, nil
}

func toFloat64(raw any) (float64, error) {
    switch v := raw.(type) {
    case float64: return v, nil
    case float32: return float64(v), nil
    case int:     return float64(v), nil
    case int64:   return float64(v), nil
    case string:
        f, err := strconv.ParseFloat(v, 64)
        if err != nil { return 0, fmt.Errorf("parse float %q: %w", v, err) }
        return f, nil
    default:
        return 0, fmt.Errorf("not numeric: %T", raw)
    }
}
```

## Suggested Fix

1. Create `internal/telemetry/` package
2. Write `hot_signals.go` with the catalog + transformers
3. Cross-reference every typed column in `migrations/_baseline_source/02-vehicle-live-state.sql` etc. — add a catalog entry for each
4. Add unit tests for every transformer (table-driven)
5. Build + test + commit

## Acceptance Criteria

- [ ] `internal/telemetry/hot_signals.go` exists
- [ ] `HotSignalCatalog` has at least one entry per typed column on each Phase 3 snapshot table
- [ ] Every entry's `Table` matches a real table from Phase 3
- [ ] Every entry's `Column` (when non-empty) matches a real column on that table
- [ ] All 4 compound kinds present (DoorState, WindowState, Location, TimeOfDay-style for ScheduledChargingStartTime)
- [ ] Every transformer has a unit test covering: happy path, type mismatch error, alias normalization
- [ ] Compile-time validation: an `init()` test runs `for k,v := range HotSignalCatalog { … }` and verifies the table/column reference (against a hardcoded snapshot of expected schemas, OR via reflection on the model structs)
- [ ] `go test ./internal/telemetry/...` passes
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
go test -race -count=1 ./internal/telemetry/...

# Catalog size sanity
$count = (Select-String -Path internal\telemetry\hot_signals.go -Pattern '^\s*"\w+":\s*\{').Count
Write-Host "Hot signal entries: $count"
# Expected: ≥ 50 (rough lower bound across 7 snapshot tables)
```

## Out of Scope

- Don't yet wire into the telemetry handler (prompt 03)
- Don't load the catalog from DB or YAML — static map is fine and version-controlled
- Don't add per-environment toggles — same catalog dev/staging/prod
- Don't try to discover hot signals at runtime — promotion from cold to hot is a deliberate operator action (Phase 10 deliverable)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/hot_signals.go internal/telemetry/hot_signals_test.go
git commit -m "telemetry(db-refactor): add HotSignalCatalog + transformers

ADR-002: static map from Tesla signal name to typed snapshot column.
Covers all Phase 3 hot columns plus 4 compound kinds (Door/Window/
Location/Time). Transformers reuse normalization rules from migrations
129-139.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002
- `migrations/_baseline_source/` (column inventory source)
- `internal/enums/signal_types.go` (legacy classification reference)
