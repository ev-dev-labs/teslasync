---
description: "Phase 7 — Update all 15 web/src/api/hooks/*.ts for new shapes"
---

# 🟢 Frontend 03 — Update API Hooks

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 3 of 5

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/hooks/*.ts` (15 files) |
| Depends on | `01`, `02` |
| Blocks | `04-fix-page-incidentals` |
| ADR refs | ADR-002, ADR-004 |

## Single Goal

Update every hook in `web/src/api/hooks/` so its return type matches the new backend shapes. Add new hooks for `signal_observations` and `signal_catalog`. Replace automation CRUD with CTI-aware variants.

## What's Being Established

Hooks are the contract layer between Go JSON and React components. Once these compile, prompt 04's page-level fixes are mostly auto-driven by `tsc` errors.

## Recommendation

### Files & changes

| Hook file | Changes |
|-----------|---------|
| `useVehicles.ts` | Drop `raw_state`. Add `useVehicleLiveState(id)` returning typed columns (matches `vehicle_live_state` row) |
| `useTelemetry.ts` | Replace `useSignalsForVehicle` (returned `Record<string, any>`) with `useSignalObservations(vehicle_id, opts)` returning `SignalObservation[]`; add `useSignalCatalog()` |
| `useAutomations.ts` | `useAutomation(id)` returns `AutomationFull`. New mutations: `useCreateAutomationFull`, `useUpdateAutomationFull`. Drop `trigger_config`/`conditions`/`actions: any` mutation shapes |
| `useDriving.ts` | Drop `raw_json` from `Drive` |
| `useCharging.ts` | Drop `raw_json`. Verify charging telemetry shape matches typed cols |
| `useEnergy.ts` | No type changes (aggregates only) |
| `useAnalytics.ts` | No type changes |
| `useNotifications.ts` | `NotificationChannel.config` → typed per-kind interfaces |
| `useSettings.ts` | No type changes |
| `useAdmin.ts` | No type changes |
| `useDashboard.ts` | Verify `useFleetDashboard` doesn't pull `raw_json` |
| `useExports.ts` | No type changes |
| `useLocations.ts` | No type changes (geofences typed already) |
| `useTrips.ts` | Drop `raw_json` |
| `useUser.ts` | No type changes |
| `useVehicleSystems.ts` | Verify all snapshot types match Phase 3 typed cols |

### New hooks to add (in `useTelemetry.ts`)

```typescript
import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import type { SignalObservation, SignalCatalogEntry } from '../types';

export function useSignalCatalog() {
  return useQuery({
    queryKey: ['signal-catalog'],
    queryFn: () => request<SignalCatalogEntry[]>('/signals/catalog'),
    staleTime: 5 * 60_000,
  });
}

export function useSignalObservations(
  vehicleId: number | string,
  opts?: { signal_name?: string; since?: string; until?: string; limit?: number }
) {
  const params = new URLSearchParams();
  params.set('vehicle_id', String(vehicleId));
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

Note snake_case query params (per project convention) and no `/api/v1/` prefix (client adds it).

### Automation CTI shape

```typescript
export function useAutomation(id: number | string | undefined) {
  return useQuery({
    queryKey: ['automation', id],
    queryFn: () => request<AutomationFull>(`/automations/${id}`),
    enabled: !!id,
  });
}

export function useCreateAutomationFull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AutomationFull, 'id'|'created_at'|'updated_at'>) =>
      request<AutomationFull>('/automations', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automations'] }),
  });
}
```

## Suggested Fix

1. Open each of the 15 hook files
2. Apply the changes per the table above
3. Add the 2 new hooks to `useTelemetry.ts`
4. Run `npx tsc --noEmit` — error count should drop substantially after this prompt
5. Commit

## Acceptance Criteria

- [ ] All 15 hook files compile against new types
- [ ] `useSignalCatalog` and `useSignalObservations` exist and return the new types
- [ ] `useAutomation` returns `AutomationFull`
- [ ] No hook URL contains `/api/v1/` prefix (client auto-adds)
- [ ] All query params are snake_case
- [ ] No hook references `raw_json`, `signals`, `trigger_config`, `conditions: any`, `actions: any`
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\hooks\*.ts -Pattern "/api/v1/"
# Expected: 0 hits

Select-String -Path src\api\hooks\*.ts -Pattern "raw_json|trigger_config|\.signals\b|conditions:\s*any|actions:\s*any"
# Expected: 0 hits

# camelCase query params (should be 0 — backend wants snake_case)
Select-String -Path src\api\hooks\*.ts -Pattern '\?[a-z]+[A-Z]'
# Expected: 0 hits in URL strings

npx tsc --noEmit 2>&1 | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-03-tsc.log
# Expected: error count significantly lower than after prompt 02
```

## Out of Scope

- Don't fix page-level errors yet (prompt 04)
- Don't add new endpoints (backend in Phase 6 should already expose `/signals/catalog`, `/signals/observations`; verify)
- Don't change query staleTime conventions (5s live, 5min static)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/src/api/hooks/
git add -f .github/prompts/db-refactor/logs/phase-7-03-tsc.log
git commit -m "web(db-refactor): update hooks for typed snapshots + CTI automations + signal_observations

15 hook files aligned with new backend shapes. New hooks:
useSignalCatalog, useSignalObservations. useAutomation returns
AutomationFull. Dropped raw_json/signals/trigger_config from
return types throughout. snake_case query params; no /api/v1/
double-prefix.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002, ADR-004
- `.github/instructions/react-frontend.instructions.md` (hook conventions)
