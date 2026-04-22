---
description: "Phase 7 — Drop `raw_json` from ChargingSession; verify ChargingTelemetry shape"
---

# 🟢 Frontend 03 — Drop `raw_json` from ChargingSession; verify ChargingTelemetry shape

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 3 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/types.ts` |
| Depends on | 02-update-types-drive |
| Blocks | 04-update-types-trip |
| ADR refs | ADR-001, ADR-002 |


## Single Goal

Remove `raw_json` from `ChargingSession`. Confirm `ChargingTelemetry` has all typed columns from Phase 3 `charging_telemetry` hypertable (battery_level, charger_voltage, charger_actual_current, charge_rate_kw, etc.).

## Recommendation

### Edit `web/src/api/types.ts`

```typescript
// REMOVE from ChargingSession:
//   raw_json?: unknown;

// VERIFY/ADD on ChargingTelemetry (one row per timestamp, typed cols only):
export interface ChargingTelemetry {
  vehicle_id: number;
  session_id: number;
  ts: string;
  battery_level: number | null;
  charger_voltage: number | null;
  charger_actual_current: number | null;
  charger_power_kw: number | null;
  charge_rate_kw: number | null;
  battery_range_km: number | null;
  charger_phases: number | null;
}
```

## Acceptance Criteria

- [ ] `ChargingSession.raw_json` deleted
- [ ] `ChargingTelemetry` has 7+ typed numeric cols, no jsonb
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\types.ts -Pattern 'ChargingSession[\s\S]*?raw_json'
# Expected: 0 hits
```

## Out of Scope

- Don't update useCharging hook here (prompt 35)
- Don't touch billing fields

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): drop ChargingSession.raw_json; verify telemetry typed cols

Aligns FE with Phase 3 charging_telemetry hypertable.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
