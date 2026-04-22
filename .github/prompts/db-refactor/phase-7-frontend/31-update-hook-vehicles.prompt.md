---
description: "Phase 7 — Update `useVehicles.ts`: drop raw_state; add `useVehicleLiveState`"
---

# 🟢 Frontend 31 — Update `useVehicles.ts`: drop raw_state; add `useVehicleLiveState`

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 31 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/hooks/useVehicles.ts` |
| Depends on | 30-add-type-channel-pushover |
| Blocks | 32-update-hook-telemetry |
| ADR refs | ADR-001 |


## Single Goal

Drop any return-type usage of `raw_state` in `useVehicles`. Add a new `useVehicleLiveState(vehicleId)` hook that fetches `/vehicles/:id/live-state` and returns `VehicleLiveState`.

## Recommendation

### Edit `web/src/api/hooks/useVehicles.ts`

```typescript
import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import type { Vehicle, VehicleLiveState } from '../types';

// existing useVehicles() — leave unchanged except drop any raw_state references

export function useVehicleLiveState(vehicleId: number | string | undefined) {
  return useQuery({
    queryKey: ['vehicle-live-state', vehicleId],
    queryFn: () => request<VehicleLiveState>(`/vehicles/${vehicleId}/live-state`),
    enabled: !!vehicleId,
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}
```

Note: no `/api/v1/` prefix (client adds it). Path is snake_case-friendly per backend.

## Acceptance Criteria

- [ ] `useVehicleLiveState` exported and returns `VehicleLiveState`
- [ ] Zero `raw_state` references remain in this file
- [ ] No `/api/v1/` prefix in the URL
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\hooks\useVehicles.ts -Pattern 'raw_state'
# Expected: 0 hits
Select-String -Path src\api\hooks\useVehicles.ts -Pattern 'useVehicleLiveState'
# Expected: >= 1 hit
Select-String -Path src\api\hooks\useVehicles.ts -Pattern '/api/v1/'
# Expected: 0 hits
```

## Out of Scope

- Don't update consumer pages (prompt 39)
- Don't change useVehicles list shape

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): useVehicles drops raw_state; add useVehicleLiveState

Live state served from new vehicle_live_state typed columns; staleTime 5s,
refetch 10s for near-real-time UI without flooding the API.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6: GET /vehicles/:id/live-state handler
