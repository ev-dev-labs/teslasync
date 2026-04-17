# Fix Old API Imports — Replace `../api` Barrel Imports with Hooks or `request()`

## Rule: `old-api-import`

Files must NOT import from the old `../api`, `../../api`, or `@/api` barrel (`web/src/api/index.ts`). All data fetching must use TanStack Query hooks from `@/api/hooks/`. The old barrel re-exports legacy imperative functions (`getVehicles()`, `getSettings()`, etc.) that bypass caching, deduplication, and error handling.

## Files to Fix (5 violations)

### 1. `web/src/api/index.ts` — Line 5 (the barrel file itself)

**Assessment:** This is the old barrel file. It re-exports everything from `./client`, `./types`, `./auth`, `./vehicles`, `./drives`, `./charging`, `./settings`, `./analytics`, `./devtools`.

**Action:**
- Check if ANY file still imports from `@/api` or `../api` or `../../api` (other than the files listed in this prompt).
- Run: `cd web && grep -rn "from ['\"].*\/api['\"]" src/ --include="*.ts" --include="*.tsx" | grep -v "api/hooks" | grep -v "api/client" | grep -v "api/types" | grep -v "api/auth" | grep -v "api/index" | grep -v "node_modules"`
- If there are remaining consumers beyond the 4 files below, those must be fixed first.
- Once all consumers are migrated, add a deprecation comment at the top of `api/index.ts`:
  ```typescript
  /**
   * @deprecated — Do not import from this barrel. Use hooks from @/api/hooks/ instead.
   * This file exists only for backward compatibility and will be removed.
   */
  ```
- Do NOT delete the file yet — it may have other consumers we haven't audited.

### 2. `web/src/components/forms/RuleBuilder.tsx` — Line 9

**Current import:**
```typescript
import type { RuleConditionTree } from '../../api'
```

**Fix:** This is a TYPE-only import. The type `RuleConditionTree` is defined in `web/src/api/types.ts`.

**Replace with:**
```typescript
import type { RuleConditionTree } from '@/api/types'
```

This is a type import, so it doesn't need a hook — it just needs to import from the types file directly instead of through the old barrel.

### 3. `web/src/components/layout/Layout.tsx` — Line 62

**Current import:**
```typescript
import { getAlerts, getVehicles, getVehicleState, getVersionInfo, checkForUpdates, getStaleSessions } from '../../api'
```

**Fix:** Replace each imperative function with its TanStack Query hook equivalent.

**Steps:**
1. Read the full `Layout.tsx` file to understand how each function is called.
2. Find the equivalent hooks:
   - `getAlerts` → `useAlerts` from `@/api/hooks/useNotifications`
   - `getVehicles` → `useVehicles` from `@/api/hooks/useVehicles`
   - `getVehicleState` → `useVehicleState` from `@/api/hooks/useVehicles`
   - `getVersionInfo` → `useVersionInfo` from `@/api/hooks/useAdmin`
   - `checkForUpdates` → `useUpdateCheck` from `@/api/hooks/useAdmin`
   - `getStaleSessions` → check `useAdmin` hooks for stale sessions
3. Search the hook files to confirm exact export names:
   ```bash
   grep -n "export.*useAlerts\|export.*useVehicles\|export.*useVehicleState\|export.*useVersionInfo\|export.*useUpdateCheck\|export.*useStaleSessions" web/src/api/hooks/*.ts
   ```
4. Replace the `useEffect + setState` pattern with direct hook usage:
   ```typescript
   // BEFORE:
   const [vehicles, setVehicles] = useState<Vehicle[]>([])
   useEffect(() => { getVehicles().then(setVehicles) }, [])

   // AFTER:
   const { data: vehicles } = useVehicles()
   const items = vehicles ?? []
   ```
5. If any of the imported functions are used in event handlers (not data loading), use the `request()` function from `@/api/client` directly instead of a hook.

**Important:** Layout.tsx is a critical file — be very careful with this refactor. Test that navigation, sidebar, alerts badge, and version display still work.

### 4. `web/src/components/maps/MapTileLayer.tsx` — Line 4

**Current import:**
```typescript
import { getMapConfig } from '../../api'
```

**Fix:** This file already uses `useQuery` from TanStack Query (line 2). It calls `getMapConfig` inside a `useQuery` queryFn. The fix is to either:

**Option A (preferred):** Check if `useSettings` or another hook already provides map config, and use that.
```bash
grep -n "mapConfig\|map_config\|useMapConfig" web/src/api/hooks/*.ts web/src/hooks/*.ts
```

**Option B:** Import `getMapConfig` from `@/api/settings` (the direct module) instead of the barrel:
```typescript
import { getMapConfig } from '@/api/settings'
```

**Option C:** If `getMapConfig` is just a `request('/settings/map')` wrapper, inline the call:
```typescript
import { request } from '@/api/client'
// ... inside useQuery:
queryFn: () => request<MapConfig>('/settings/map')
```

Choose the option that best fits the existing codebase patterns. Check what `getMapConfig` actually does:
```bash
grep -n "getMapConfig" web/src/api/settings.ts
```

### 5. `web/src/hooks/useSettings.ts` — Line 2

**Current import:**
```typescript
import { getSettings, type AppSettings } from '../api'
```

**Fix:** This hook itself IS a TanStack Query hook (it uses `useQuery`). It just needs to import from the correct location:

**For the type:**
```typescript
import type { AppSettings } from '@/api/types'
```

**For the function:** Check if `useSettings` already exists in `@/api/hooks/useSettings.ts`:
```bash
cat web/src/api/hooks/useSettings.ts | head -30
```

- If `@/api/hooks/useSettings.ts` exports a `useSettings` hook, then `web/src/hooks/useSettings.ts` may be a DUPLICATE. Check if they do the same thing and consolidate.
- If `@/api/hooks/useSettings.ts` only exports the raw query hook, and `web/src/hooks/useSettings.ts` adds unit conversion logic on top, then import `getSettings` from `@/api/settings` directly:
  ```typescript
  import { getSettings } from '@/api/settings'
  import type { AppSettings } from '@/api/types'
  ```

## Verification

After all changes:

```bash
cd web && npx tsc --noEmit
```

Must compile with zero errors. Pay special attention to:
- Type mismatches from changing hook return types
- Missing properties that the old functions provided but hooks structure differently
- Components that relied on the imperative fetch pattern (setState in useEffect)

Also verify no remaining old-api imports:
```bash
cd web && grep -rn "from ['\"]\.\.\/api['\"]" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v "api/index.ts"
cd web && grep -rn "from ['\"]\.\.\/\.\.\/api['\"]" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v "api/index.ts"
```

## Anti-Revert Warning

Do NOT revert to the old imperative fetch pattern. The fix is to move FORWARD to hooks, not backward to `useEffect(() => { fetch().then(setState) }, [])`.
