---
description: "Phase-14 — Rewire charge telemetry endpoint"
---
# Prompt 25 — Charge Telemetry: Read from signal_log via Pivot
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-25-charge-telem.log` |
| Allowed files to change | `internal/api/charging_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 23 (SignalTracePivot)

## Problem

`/charging/{id}/telemetry` reads from `charging_telemetry` table (DROPPED in prompt 13).
The charge detail page shows voltage/current/power/SOC curves over time.

## Task

### 1. Rewire the telemetry endpoint

```go
var chargeTelemetryMappings = []database.SignalMapping{
    {Signal: "BatteryLevel", Field: "battery_pct"},
    {Signal: "ChargerVoltage", Field: "charger_voltage"},
    {Signal: "ChargerActualCurrent", Field: "charger_current"},
    {Signal: "ACChargingPower", Field: "charger_power_kw"},
    {Signal: "DCChargingPower", Field: "dc_power_kw"},
    {Signal: "ACChargingEnergyIn", Field: "energy_added_kwh"},
    {Signal: "ChargeRateMilePerHour", Field: "charge_rate_mph"},
    {Signal: "BatteryHeaterOn", Field: "battery_heater_on"},
    {Signal: "InsideTemp", Field: "inside_temp_c"},
    {Signal: "OutsideTemp", Field: "outside_temp_c"},
}

func (h *ChargingHandler) TelemetryReadings(w http.ResponseWriter, r *http.Request) {
    sessionID := urlParamInt64(r, "sessionID")
    session, _ := h.chargeRepo.Get(ctx, sessionID)

    endTs := session.EndTs
    if endTs.IsZero() {
        endTs = time.Now().UTC() // in-progress charge
    }

    rows, err := h.signalLogReader.SignalTracePivotFlat(ctx,
        session.VehicleID, chargeTelemetryMappings, session.StartTs, endTs)

    writeJSON(w, http.StatusOK, map[string]interface{}{
        "session_id": sessionID,
        "data":       rows,
    })
}
```

### Constraints

- **Match existing response shape** — survey current `/charging/{id}/telemetry` response format first
- Wire `signalLogReader` into charging_handler
- For in-progress charges (`end_ts IS NULL`), use `time.Now()` as end
- Use both `ACChargingPower` and `DCChargingPower` — frontend shows whichever is non-zero

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
curl -s "http://localhost:8080/api/v1/charging/1/telemetry" | python -m json.tool | head -20
# Should return 200 with charge curve data
```

Log result. STATUS=DONE only if build passes AND endpoint returns 200.
