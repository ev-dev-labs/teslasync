---
description: "Phase-14 — Rewire location + user-prefs + vehicle-config endpoints → signal_log"
---
# Prompt 26c — Location + User Preferences + Vehicle Config → signal_log
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-26c-loc-prefs-config.log` |
| Allowed files to change | `internal/api/location_snapshot_handler.go`, `internal/api/user_preference_handler.go`, `internal/api/vehicle_config_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 06 (SnapshotAt), 23 (SignalTracePivot)

## Exactly 3 handlers, 6 endpoints

### 1. Location Snapshot Handler

| Endpoint | Old | New |
|---|---|---|
| `GET /location-snapshots` (history) | `FROM location_snapshots` | `SignalTracePivotFlat` |
| `GET /location-snapshots/latest` | Latest snapshot row | `SnapshotAt(now)` or Redis |

Signal mappings:
```go
var locationMappings = []database.SignalMapping{
    {Signal: "Latitude", Field: "latitude"},
    {Signal: "Longitude", Field: "longitude"},
    {Signal: "GpsHeading", Field: "heading"},
    {Signal: "GpsState", Field: "gps_state"},
    {Signal: "Elevation", Field: "elevation_m"},
    {Signal: "VehicleSpeed", Field: "speed_mph"},
}
```

### 2. User Preference Handler

| Endpoint | Old | New |
|---|---|---|
| `GET /user-preferences` (history) | `FROM user_preference_snapshots` | `SignalTracePivotFlat` |
| `GET /user-preferences/latest` | Latest snapshot row | `SnapshotAt(now)` |

Signal mappings:
```go
var userPrefMappings = []database.SignalMapping{
    {Signal: "Setting24HourTime", Field: "setting_24hr_time"},
    {Signal: "SettingChargeUnit", Field: "setting_charge_unit"},
    {Signal: "SettingDistanceUnit", Field: "setting_distance_unit"},
    {Signal: "SettingTemperatureUnit", Field: "setting_temperature_unit"},
    {Signal: "SettingTirePressureUnit", Field: "setting_tire_pressure_unit"},
}
```

### 3. Vehicle Config Handler

| Endpoint | Old | New |
|---|---|---|
| `GET /vehicle-config` (list) | `FROM vehicle_config_snapshots` | `SignalTracePivotFlat` |
| `GET /vehicle-config/latest` | Latest snapshot row | `SnapshotAt(now)` |

Vehicle config signals are compound (JSON) → stored in `value_jsonb`:
```go
var vehicleConfigMappings = []database.SignalMapping{
    {Signal: "VehicleConfig", Field: "config"},  // compound → value_jsonb
}
```
Or individual config fields if Tesla sends them separately.

### Constraints

- Location `/latest` can use Redis for sub-ms reads (same as vehicle state)
- User preferences are used by the unit conversion system (prompt 07) — these
  signals feed `SettingDistanceUnit` etc. that `SnapshotAt` queries for unit normalization
- Vehicle config rarely changes — `/latest` from `SnapshotAt(now)` is fine

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
grep -rn "location_snapshot\|user_preference_snapshot\|vehicle_config_snapshot" --include="*.go" internal/api/location_snapshot_handler.go internal/api/user_preference_handler.go internal/api/vehicle_config_handler.go
# Should return 0 matches
```

Log result. STATUS=DONE only if build passes AND zero snapshot refs in these 3 files.
