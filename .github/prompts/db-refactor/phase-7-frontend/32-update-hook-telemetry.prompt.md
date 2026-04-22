---
description: "Phase 7 — Replace `useSignalsForVehicle` with `useSignalObservations`; add `useSignalCatalog`"
---

# 🔵 Frontend 32 — Replace `useSignalsForVehicle` with `useSignalObservations`; add `useSignalCatalog`

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 32 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/hooks/useTelemetry.ts` |
| Depends on | 31-update-hook-vehicles |
| Blocks | 33-update-hook-automations |
| ADR refs | ADR-002 |


## Single Goal

Delete the legacy `useSignalsForVehicle` hook (returned `Record<string, any>`). Add `useSignalObservations` and `useSignalCatalog`, both typed.

## Recommendation

### Edit `web/src/api/hooks/useTelemetry.ts`

```typescript
import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import type { SignalObservation, SignalCatalogEntry } from '../types';

// DELETE: useSignalsForVehicle (legacy Record<string, any>)

export function useSignalCatalog() {
  return useQuery({
    queryKey: ['signal-catalog'],
    queryFn: () => request<SignalCatalogEntry[]>('/signals/catalog'),
    staleTime: 5 * 60_000,
  });
}

export function useSignalObservations(
  vehicleId: number | string | undefined,
  opts?: { signal_name?: string; since?: string; until?: string; limit?: number },
) {
  const params = new URLSearchParams();
  if (vehicleId != null) params.set('vehicle_id', String(vehicleId));
  if (opts?.signal_name) params.set('signal_name', opts.signal_name);
  if (opts?.since) params.set('since', opts.since);
  if (opts?.until) params.set('until', opts.until);
  if (opts?.limit) params.set('limit', String(opts.limit));

  return useQuery({
    queryKey: ['signal-observations', vehicleId, opts],
    queryFn: () => request<SignalObservation[]>(`/signals/observations?${params}`),
    enabled: !!vehicleId,
    staleTime: 5_000,
  });
}
```

snake_case query params; no `/api/v1/` prefix.

## Acceptance Criteria

- [ ] `useSignalsForVehicle` removed
- [ ] `useSignalCatalog` returns `SignalCatalogEntry[]`
- [ ] `useSignalObservations` returns `SignalObservation[]`, takes typed opts
- [ ] All query params snake_case
- [ ] No `/api/v1/` prefix
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\hooks\useTelemetry.ts -Pattern 'useSignalsForVehicle'
# Expected: 0 hits
Select-String -Path src\api\hooks\useTelemetry.ts -Pattern 'useSignalObservations|useSignalCatalog'
# Expected: >= 2 hits
Select-String -Path src\api\hooks\useTelemetry.ts -Pattern '/api/v1/'
# Expected: 0 hits
```

## Out of Scope

- Don't update telemetry pages here (prompt 42)
- Don't change live MQTT subscription hooks

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): replace useSignalsForVehicle with typed signal hooks

useSignalCatalog (5min stale) + useSignalObservations (5s stale, typed
filters). Phase 6 backs both endpoints.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 6: /signals/catalog and /signals/observations handlers
