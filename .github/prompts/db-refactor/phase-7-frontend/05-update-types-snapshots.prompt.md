---
description: "Phase 7 — Align Position, ClimateSnapshot, MotorSnapshot, SecurityEvent, VehicleMetaSnapshot with Phase 3 typed cols"
---

# 🟢 Frontend 05 — Align Position, ClimateSnapshot, MotorSnapshot, SecurityEvent, VehicleMetaSnapshot with Phase 3 typed cols

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 5 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/types.ts` |
| Depends on | 04-update-types-trip |
| Blocks | 06-update-types-cleanup-any |
| ADR refs | ADR-001, ADR-002 |


## Single Goal

Verify the five snapshot interfaces match Phase 3 schema exactly. Drop any leftover `raw_json`/`signals` fields.

## Recommendation

### Edit `web/src/api/types.ts`

For each interface below, ensure the listed fields exist as typed columns (snake_case) and DELETE any `raw_json`, `signals`, or `data: Record<string, any>` fields:

```typescript
export interface Position {
  vehicle_id: number; ts: string;
  latitude: number; longitude: number;
  heading: number | null; speed_kph: number | null;
  altitude_m: number | null; gps_accuracy_m: number | null;
}

export interface ClimateSnapshot {
  vehicle_id: number; ts: string;
  inside_temp_c: number | null; outside_temp_c: number | null;
  driver_temp_setting_c: number | null; passenger_temp_setting_c: number | null;
  is_climate_on: boolean | null; is_preconditioning: boolean | null;
  fan_status: number | null;
}

export interface MotorSnapshot {
  vehicle_id: number; ts: string;
  motor_rpm_front: number | null; motor_rpm_rear: number | null;
  motor_torque_front_nm: number | null; motor_torque_rear_nm: number | null;
  motor_temp_front_c: number | null; motor_temp_rear_c: number | null;
}

export interface SecurityEvent {
  vehicle_id: number; ts: string;
  event_type: string;
  is_locked: boolean | null; is_user_present: boolean | null;
  sentry_mode: boolean | null;
}

export interface VehicleMetaSnapshot {
  vehicle_id: number; ts: string;
  software_version: string | null; vehicle_name: string | null;
  odometer_km: number | null; tpms_front_left_kpa: number | null;
  tpms_front_right_kpa: number | null; tpms_rear_left_kpa: number | null;
  tpms_rear_right_kpa: number | null;
}
```

## Acceptance Criteria

- [ ] All 5 snapshot interfaces present and typed
- [ ] Zero `raw_json`/`signals` on any snapshot
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\types.ts -Pattern 'Snapshot[\s\S]{0,400}(raw_json|signals\?:|Record<string)'
# Expected: 0 hits
```

## Out of Scope

- Don't update useVehicleSystems hook (prompt 38)
- Don't add new snapshot kinds

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): align snapshot types with Phase 3 typed cols

Position, Climate, Motor, Security, VehicleMeta snapshots now mirror
Phase 3 hypertables exactly. No jsonb leakage.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
