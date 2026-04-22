---
description: "Phase 7 — Drop `raw_state` from Vehicle; add VehicleLiveState interface"
---

# 🟢 Frontend 01 — Drop `raw_state` from Vehicle; add VehicleLiveState interface

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 1 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/types.ts` |
| Depends on | `phase-6-write-path/32-integration-test-fleet-batch` |
| Blocks | 02-update-types-drive |
| ADR refs | ADR-001, ADR-004 |


## Single Goal

Remove `raw_state?: unknown` from `Vehicle`. Add `VehicleLiveState` interface mirroring the new typed columns on the `vehicle_live_state` table from Phase 3.

## Recommendation

### Edit `web/src/api/types.ts`

```typescript
// REMOVE from Vehicle interface:
//   raw_state?: unknown;

// ADD new interface (mirrors vehicle_live_state typed columns):
export interface VehicleLiveState {
  vehicle_id: number;
  updated_at: string;
  battery_level: number | null;
  usable_battery_level: number | null;
  charge_state: string | null;
  shift_state: string | null;
  speed_kph: number | null;
  odometer_km: number | null;
  inside_temp_c: number | null;
  outside_temp_c: number | null;
  latitude: number | null;
  longitude: number | null;
  heading: number | null;
  is_locked: boolean | null;
  is_user_present: boolean | null;
}
```

`tsc` will fail at any page reading `vehicle.raw_state` — that's expected; later prompts fix consumers.

## Acceptance Criteria

- [ ] `Vehicle` no longer contains `raw_state`
- [ ] `VehicleLiveState` exported from `api/types.ts` with all 14 typed columns
- [ ] No `: any` introduced
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\types.ts -Pattern 'raw_state'
# Expected: 0 hits
Select-String -Path src\api\types.ts -Pattern 'export interface VehicleLiveState'
# Expected: 1 hit
```

## Out of Scope

- Don't add hooks or update consumers (later prompts)
- Don't touch other interfaces here

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): drop Vehicle.raw_state, add VehicleLiveState type

Mirrors Phase 3 vehicle_live_state typed columns. Consumers fixed in
subsequent atomic prompts; tsc errors expected until 39-fix-pages-* lands.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 3: vehicle_live_state schema
- `.github/instructions/react-frontend.instructions.md`
