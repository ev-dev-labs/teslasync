---
description: "Phase-14 — Rewire drive telemetry + positions endpoints"
---
# Prompt 24 — Drive Telemetry + Positions: Read from signal_log via Pivot
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-24-drive-telem.log` |
| Allowed files to change | `internal/api/drive_handler.go`, `internal/api/vehicle_handler.go` (positions), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 23 (SignalTracePivot)

## Problem

- `/drives/{id}/telemetry` reads from `drive_telemetry_readings` (DROPPED)
- `/drives/{id}/positions` reads from `positions` table (write path removed in prompt 12)
- `/vehicles/{id}/positions` also reads from `positions`

All these need to query signal_log instead.

## Task

### 1. Rewire `/drives/{id}/telemetry`

Find the handler (likely in `drive_handler.go`). Replace the `drive_telemetry_readings`
query with `SignalTracePivotFlat`:

```go
// Drive telemetry signal mappings
var driveTelemetryMappings = []database.SignalMapping{
    {Signal: "VehicleSpeed", Field: "speed_mph"},
    {Signal: "PackCurrent", Field: "pack_current"},
    {Signal: "PackVoltage", Field: "pack_voltage"},
    {Signal: "BatteryLevel", Field: "battery_pct"},
    {Signal: "Elevation", Field: "elevation_m"},
    {Signal: "LifetimeEnergyUsed", Field: "energy_kwh"},
    {Signal: "InsideTemp", Field: "inside_temp_c"},
    {Signal: "OutsideTemp", Field: "outside_temp_c"},
    {Signal: "TpmsPressureFl", Field: "tire_fl_psi"},
    {Signal: "TpmsPressureFr", Field: "tire_fr_psi"},
    {Signal: "TpmsPressureRl", Field: "tire_rl_psi"},
    {Signal: "TpmsPressureRr", Field: "tire_rr_psi"},
}

func (h *DriveHandler) TelemetryReadings(w http.ResponseWriter, r *http.Request) {
    driveID := urlParamInt64(r, "driveID")
    drive, _ := h.driveRepo.Get(ctx, driveID) // get start_ts, end_ts

    rows, err := h.signalLogReader.SignalTracePivotFlat(ctx,
        drive.VehicleID, driveTelemetryMappings, drive.StartTs, drive.EndTs)

    writeJSON(w, http.StatusOK, map[string]interface{}{
        "drive_id": driveID,
        "data":     rows,
    })
}
```

### 2. Rewire `/drives/{id}/positions`

```go
var positionMappings = []database.SignalMapping{
    {Signal: "Latitude", Field: "latitude"},
    {Signal: "Longitude", Field: "longitude"},
    {Signal: "GpsHeading", Field: "heading"},
    {Signal: "VehicleSpeed", Field: "speed_mph"},
    {Signal: "Elevation", Field: "elevation_m"},
}

func (h *DriveHandler) Positions(w http.ResponseWriter, r *http.Request) {
    driveID := urlParamInt64(r, "driveID")
    drive, _ := h.driveRepo.Get(ctx, driveID)

    rows, err := h.signalLogReader.SignalTracePivotFlat(ctx,
        drive.VehicleID, positionMappings, drive.StartTs, drive.EndTs)

    writeJSON(w, http.StatusOK, rows)
}
```

### 3. Rewire `/vehicles/{id}/positions`

Same pattern but with a time range from query params instead of drive timestamps.

### Constraints

- **API response shape must match** what the frontend expects. Survey the current
  response format before rewriting. If the frontend expects `{latitude, longitude, speed, ...}`
  flat objects, use `SignalTracePivotFlat` with matching field names.
- Wire `signalLogReader` into drive_handler and vehicle_handler
- For in-progress drives (no `end_ts`), use `time.Now()` as the end timestamp

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Test endpoints
curl -s http://localhost:8080/api/v1/drives/1/telemetry | python -m json.tool | head -20
curl -s http://localhost:8080/api/v1/drives/1/positions | python -m json.tool | head -20
# Both should return data (not 500 errors)
```

Log result. STATUS=DONE only if build passes AND both endpoints return 200.
