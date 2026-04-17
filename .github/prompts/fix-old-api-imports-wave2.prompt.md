# Fix Old API Imports — Wave 2 (5 violations, 4 files)

> **Context**: The audit found 5 `[old-api-import]` violations — files importing from the
> old `../../api` barrel or individual old API modules instead of using `@/api/hooks/` hooks
> or `@/api/types` for type-only imports.

---

## ⛔ Rules

- **DO NOT** change any component logic, rendering, or styling.
- **DO NOT** revert to old `useEffect`+fetch patterns.
- Replace old `queryFn: oldFunction` calls with inline `() => request<T>(path)` or an existing hook.
- For **type-only** imports, switch to `import type { X } from '@/api/types'`.
- For **function** imports used as `queryFn`, replace with the equivalent TanStack Query hook from `@/api/hooks/` if one exists. If no hook exists, replace the raw function import with `request()` from `@/api/client`.
- `request()` auto-adds `/api/v1` — paths must NOT include that prefix.
- After all changes, run `npx tsc --noEmit` and `audit_code` to verify zero violations.

---

## File 1: `web/src/hooks/useSettings.ts`

**Violation**: Line 2 imports `getSettings` and `AppSettings` type from `../api`.

```ts
// BEFORE (line 2):
import { getSettings, type AppSettings } from '../api'

// AFTER:
import { request } from '@/api/client'
import type { AppSettings } from '@/api/types'
```

Then update the `queryFn` inside the hook (around line 41–44):

```ts
// BEFORE:
queryFn: getSettings,

// AFTER:
queryFn: () => request<AppSettings>('/settings'),
```

---

## File 2: `web/src/components/maps/MapTileLayer.tsx`

**Violation**: Line 4 imports `getMapConfig` from `../../api`.

```ts
// BEFORE (line 4):
import { getMapConfig } from '../../api'

// AFTER:
import { request } from '@/api/client'
```

Then update the `queryFn` (around line 55):

```ts
// BEFORE:
queryFn: getMapConfig,

// AFTER:
queryFn: () => request<{ provider: string; api_key: string }>('/system/map-config').catch(() => ({ provider: 'free', api_key: '' })),
```

Note: The old `getMapConfig` in `api/settings.ts` used a raw `fetch` with manual error handling
that returned a fallback on failure. Replicate that with `.catch()`.

---

## File 3: `web/src/components/forms/RuleBuilder.tsx`

**Violation**: Line 9 imports `RuleConditionTree` type from `../../api`.

This is a **type-only** import. Switch to `@/api/types`:

```ts
// BEFORE (line 9):
import type { RuleConditionTree } from '../../api'

// AFTER:
import type { RuleConditionTree } from '@/api/types'
```

No other changes needed in this file (the style violations are handled in a separate prompt).

---

## File 4: `web/src/components/layout/Layout.tsx`

**Violation**: Line 62 imports 6 old API functions:

```ts
import { getAlerts, getVehicles, getVehicleState, getVersionInfo, checkForUpdates, getStaleSessions } from '../../api'
```

These are used as `queryFn` in manual `useQuery` calls (lines 263–281).
Replace with `request()` from the client:

```ts
// BEFORE (line 62):
import { getAlerts, getVehicles, getVehicleState, getVersionInfo, checkForUpdates, getStaleSessions } from '../../api'

// AFTER:
import { request } from '@/api/client'
import type { Alert, Vehicle, VehicleState, VersionInfo, UpdateCheckResult, StaleSessionsResponse } from '@/api/types'
```

Then update each `queryFn`:

| Line | Before | After |
|------|--------|-------|
| 263 | `queryFn: getVersionInfo` | `queryFn: () => request<VersionInfo>('/system/version')` |
| 264 | `queryFn: checkForUpdates` | `queryFn: () => request<UpdateCheckResult>('/system/update-check')` |
| 267 | `queryFn: () => getAlerts(50)` | `queryFn: () => request<Alert[]>('/alerts?limit=50&offset=0')` |
| 268 | `queryFn: getVehicles` | `queryFn: () => request<Vehicle[]>('/vehicles')` |
| 272 | `queryFn: () => getVehicleState(primaryVehicle!.id)` | `queryFn: () => request<{ state?: VehicleState; live: boolean }>(`/vehicles/${primaryVehicle!.id}/state`)` |
| 281 | `queryFn: getStaleSessions` | `queryFn: () => request<StaleSessionsResponse>('/dev-tools/stale-sessions')` |

**Important**: Verify the types `VersionInfo`, `UpdateCheckResult`, `StaleSessionsResponse`
exist in `@/api/types`. If any are missing, check what the old functions returned and add the
type or use `Record<string, unknown>` as a last resort.

---

## File 5: `web/src/api/index.ts` (informational — no action needed)

The barrel file itself was flagged because it re-exports old API functions. This file exists
as a **transitional bridge** for consumers that haven't migrated yet. Once all consumers are
migrated (including Layout.tsx above), individual old modules (`vehicles.ts`, `settings.ts`,
`devtools.ts`, etc.) and this barrel can be deleted in a future cleanup wave.

**No changes to this file in this prompt.**

---

## Verification

```bash
cd web
npx tsc --noEmit          # must pass
```

Then run `audit_code` on each changed file to confirm `[old-api-import]` violations are gone.
The only remaining `[old-api-import]` should be `api/index.ts` itself (the barrel).
