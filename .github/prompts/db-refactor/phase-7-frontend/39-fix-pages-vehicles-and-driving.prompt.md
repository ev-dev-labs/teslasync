---
description: "Phase 7 — Fix features/vehicles + features/driving (drop blob accesses)"
---

# 🟢 Frontend 39 — Fix features/vehicles + features/driving (drop blob accesses)

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 39 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | Files under `features/vehicles` flagged by `tsc --noEmit` |
| Depends on | 38-update-hook-vehicle-systems |
| Blocks | 40-fix-pages-charging |
| ADR refs | ADR-001, ADR-002, ADR-004 |


## Single Goal

Fix every page under `web/src/features/vehicles/` and `web/src/features/driving/` that read `vehicle.raw_state`, `vehicle.signals`, or `drive.raw_json`. Replace with `useVehicleLiveState` + typed `Drive` columns.

## Recommendation

### Step 1 — capture worklist

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-String 'features/vehicles' | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-39-tsc.log
```

### Step 2 — find dead-field reads

```powershell
Select-String -Path src\features/vehicles\**\*.tsx,src\features/vehicles\**\*.ts -Pattern 'raw_state|raw_json|\.signals\?'
```

### Step 3 — apply replacement patterns

| Old | New |
|-----|-----|
| `vehicle.signals?.['BatteryLevel']` | `liveState.battery_level` (from `useVehicleLiveState`) |
| `vehicle.signals?.['ChargeState']` | `liveState.charge_state` |
| `vehicle.raw_state.shift_state` | `liveState.shift_state` |
| `drive.raw_json.foo` | DELETE; use typed Drive cols (or `useSignalObservations`) |

### Sample pages to start from

- `web/src/features/vehicles/pages/VehicleDetailPage.tsx`
- `web/src/features/vehicles/pages/VehicleListPage.tsx`
- `web/src/features/driving/pages/DriveDetailPage.tsx`
- `web/src/features/driving/pages/DrivingListPage.tsx`

### Section rendering rule

Per project rules, every section panel MUST always render. When data is absent, show `<EmptyState message={t('...')} />` — never hide the panel with `{data && ...}`.

## Acceptance Criteria

- [ ] Zero `tsc --noEmit` errors originating from `src/features/vehicles/`
- [ ] No `as any` introduced in this prompt's diff
- [ ] All sections render their panel shell with `EmptyState` fallback
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-String 'features/vehicles'
# Expected: 0 hits
```

## Out of Scope

- Don't refactor unrelated pages
- Don't restyle / change Tailwind classes
- Don't run lint here (prompt 44)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): fix features/vehicles pages after type refactor

Resolved tsc errors in features/vehicles by switching reads to typed snapshot
cols / SignalObservation / AutomationFull / typed channel configs.
All sections show EmptyState when data absent.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/instructions/react-frontend.instructions.md` (null safety, EmptyState rules)
