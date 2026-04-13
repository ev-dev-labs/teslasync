# Fix Broken API Hooks, Null Safety & Always-Show Panels — Global Sweep

> **Problem**: 26 API hooks call wrong or non-existent backend endpoints → pages show
> "Not Found" or crash. Pages that DO get data crash on null with "Cannot read
> properties of undefined". Pages hide panels entirely when data is missing.
>
> **Three-pass approach**:
> 0. Fix 26 broken API hook URLs (WRONG paths + MISSING endpoints)
> 1. Fix all null-safety crashes (`.toLowerCase()`, `.toFixed()`, `.slice()` etc on undefined)
> 2. Convert conditional-hide panels to always-show with empty-state placeholder

---

## Pass 0: Fix 26 Broken API Hook URLs

The `request()` function (`web/src/lib/resilience.ts:164`) auto-adds `/api/v1`.
Hooks must pass paths WITHOUT the `/api/v1` prefix.
Backend routes are in `internal/api/router.go`.

### 0A: WRONG paths — hooks calling incorrect URLs (11 hooks)

Fix these in the hook files. The correct backend route is shown.

**`web/src/api/hooks/useEnergy.ts`**:
| Hook | Wrong URL | Correct URL | Backend Route |
|------|-----------|-------------|---------------|
| `useBatteryHealth` | `/vehicles/${vid}/battery/report` | `/vehicles/${vid}/battery` | line 209 |
| `useVampireDrainEvents` | `/vehicles/${vid}/vampire-drain?limit=X` | `/vampire-drain?vehicle_id=${vid}&limit=X` | line 384 |
| `useVampireDrainStats` | `/vehicles/${vid}/vampire-drain/stats` | `/vampire-drain/stats?vehicle_id=${vid}` | line 385 |

**`web/src/api/hooks/useAnalytics.ts`**:
| Hook | Wrong URL | Correct URL | Backend Route |
|------|-----------|-------------|---------------|
| `useMileageMonthly` | `/vehicles/${vid}/mileage/monthly` | `/mileage/monthly?vehicle_id=${vid}` | line 394 |
| `useTimeline` | `/vehicles/${vid}/timeline` | `/vehicle-states/timeline?vehicle_id=${vid}` | line 403 |
| `useStateSummary` | `/vehicles/${vid}/state-summary` | `/vehicle-states/summary?vehicle_id=${vid}` | line 404 |

**`web/src/api/hooks/useCharging.ts`**:
| Hook | Wrong URL | Correct URL |
|------|-----------|-------------|
| `useChargingSessionById` | `/charging-sessions/${id}` | `/charging/${id}` |

**`web/src/api/hooks/useTelemetry.ts`** — signals routes need `vehicleID` in PATH:
| Hook | Wrong URL | Correct URL | Backend Route |
|------|-----------|-------------|---------------|
| `useAvailableSignals` | `/signals/available` | `/signals/${vid}/available` | line 528 |
| `useSignalStats` | `/signals/stats?vehicle_id=${vid}` | `/signals/${vid}/stats` | line 529 |
| `useSignalHistory` | `/signals/history?signal=X&hours=Y` | `/signals/${vid}/${signalName}/history?hours=Y` | line 559 |
| `useSignalLive` | `/signals/live` | `/signals/${vid}/live` | line 530 |

**Important**: The signal hooks currently don't take vehicleId — you'll need to add
it as a parameter and wire it from the page components.

### 0B: MISSING endpoints — hooks calling routes that don't exist (15 hooks)

These endpoints have NO backend handler. For each, either:
- **(a)** Redirect to an existing endpoint that returns similar data, OR
- **(b)** Make the hook return empty data gracefully (not crash)

| Hook URL | Exists? | Recommendation |
|----------|---------|----------------|
| `/dashboard/stats` | ❌ | Combine: `/vehicles` + `/drives?limit=5` + `/charging?limit=5` — OR create a stub hook that returns `null` and let Dashboard compute from existing hooks |
| `/analytics/summary?days=X` | ❌ | Use `/analytics/fleet` instead (line 277) |
| `/vehicles/${vid}/mileage` | ❌ | Use `/mileage/stats?vehicle_id=${vid}` (line 395) |
| `/vehicles/${vid}/cost-breakdown` | ❌ | Use `/analytics/tco?vehicle_id=${vid}` (line 278) |
| `/vehicles/${vid}/weekly-digest` | ❌ | No equivalent — make hook return `null`, show "Coming soon" |
| `/vehicles/${vid}/battery/cells` | ❌ | No equivalent — make hook return `null`, page shows empty state |
| `/vehicles/${vid}/battery/degradation` | ❌ | Use `/analytics/battery-degradation?vehicle_id=${vid}` (line 281) |
| `/vehicles/${vid}/energy/flow` | ❌ | No equivalent — make hook return `null` |
| `/vehicles/${vid}/battery/projected-range` | ❌ | No equivalent — make hook return `null` |
| `/vehicles/${vid}/sleep?days=X` | ❌ | Use `/analytics/sleep?vehicle_id=${vid}&days=X` (line 279) |
| `/maintenance` | ❌ | No equivalent — make hook return empty array `[]` |
| `/maintenance/records` | ❌ | No equivalent — make hook return empty array `[]` |
| `/users/me` | ❌ | No equivalent — make hook return `null`, page uses fallback |
| `/exports` | ❌ | Use `/export/jobs` (line 607) |
| `/vehicles/${id}/refresh` | ❌ | Not needed — remove or alias to `/vehicles/${id}/wake` |

**For hooks with no backend equivalent**, make them fail gracefully:
```typescript
export function useBatteryCells(vehicleId?: string) {
  return useQuery({
    queryKey: ['battery-cells', vehicleId],
    queryFn: () => request<BatteryCellSummary>(`/vehicles/${vehicleId}/battery/cells`),
    enabled: !!vehicleId,
    retry: false,           // ← Don't retry 404s
    staleTime: Infinity,    // ← Don't refetch
  });
}
```

This way the page gets `{ data: undefined, error: ... }` and can show an
empty state instead of crashing.

---

## Pass 1: Null Safety — Fix Runtime Crashes

### The Pattern

Any method call on a value that could be `undefined` or `null` will crash:
```tsx
// CRASHES when status is undefined
status.toLowerCase()

// SAFE alternatives
status?.toLowerCase() ?? ''
(status ?? '').toLowerCase()
```

### 1A: Fix `.toLowerCase()` / `.toUpperCase()` on nullable strings

**Search**: `grep -rn '\.toLowerCase\(\)\|\.toUpperCase\()' web/src/features/`

Files to fix (add `?.` or `?? ''` guard):

| File | Line(s) | Fix Pattern |
|------|---------|-------------|
| `system/pages/SystemStatusPage.tsx` | 95, 122, 136, 182 | `status` param could be undefined → `(status ?? '').toLowerCase()` |
| `battery/pages/ProjectedRangePage.tsx` | 167 | `f.name` could be undefined → `(f.name ?? '').toLowerCase()` |
| `admin/pages/SecurityAccessPage.tsx` | 70, 105, 581 | `val`/`state` could be undefined → add `?? ''` guard |
| `vehicle-systems/pages/MediaPlayerPage.tsx` | 80, 90, 97 | `source`/`status` could be undefined → add `?? ''` guard |
| `notifications/pages/AlertStudioPage.tsx` | 195-197 | `tpl.name`/`tpl.msg_template`/`tpl.category` → add `?.` |

### 1B: Fix `.toFixed()` on nullable numbers

**Search**: `grep -rn '\.toFixed\(' web/src/features/`

Files to fix (add `?? 0` before `.toFixed()`):

| File | Line(s) | Fix Pattern |
|------|---------|-------------|
| `battery/pages/BatteryCellsPage.tsx` | 116, 152, 155 | `cell.voltage` / `b.low` / `b.high` → `(cell.voltage ?? 0).toFixed(3)` |
| `driving/pages/SpeedProfilePage.tsx` | 167 | `bucket.percentage` → `(bucket.percentage ?? 0).toFixed(1)` |
| `maps/pages/GeofencesPage.tsx` | 332 | `g.latitude`/`g.longitude` → `(g.latitude ?? 0).toFixed(6)` |
| `maps/pages/NavigationRoutePage.tsx` | 288, 298, 556 | `row.latitude`/`row.longitude` → add `?? 0` |
| `vehicle-systems/pages/TirePressurePage.tsx` | 227, 367, 377 | `val`/`summaryStats.avg`/`summaryStats.min` → add `?? 0` |

### 1C: Fix `.slice()` / `.substring()` / `.replace()` on nullable strings

| File | Line(s) | Fix Pattern |
|------|---------|-------------|
| `admin/pages/SecurityAccessPage.tsx` | 128 | `ev.createdAt.slice(0,10)` → `ev.createdAt?.slice(0,10) ?? ''` |
| `analytics/pages/MileagePage.tsx` | 102 | `e.date.slice(0,7)` → `e.date?.slice(0,7) ?? ''` |
| `charging/pages/ChargingCurvePage.tsx` | 400, 457 | `s.start_date.slice()` → `s.start_date?.slice() ?? ''` |
| `maps/pages/LocationsPage.tsx` | 67, 74 | `l.address_name.length` → `(l.address_name ?? '').length` |
| `driving/pages/RouteEfficiencyPage.tsx` | 135 | `r.startLocation.substring()` → `(r.startLocation ?? '').substring()` |
| `admin/pages/ApiLogsPage.tsx` | 251 | `log.url.replace()` → `(log.url ?? '').replace()` |

### 1D: Fix property access on potentially null objects

Look for patterns like `data.someField.method()` where `data` comes from a
TanStack Query hook (could be undefined while loading):

```tsx
// UNSAFE — crashes if stats is undefined
stats.totalCost.toFixed(0)

// SAFE
(stats?.totalCost ?? 0).toFixed(0)
```

**Scan all pages** for this pattern: any `{data.` or `{stats.` or `{drive.` or
`{vehicle.` access inside JSX that isn't guarded by a null check.

### General Rules for Pass 1

1. **String methods** (`.toLowerCase()`, `.toUpperCase()`, `.slice()`, `.split()`,
   `.replace()`, `.trim()`, `.includes()`, `.startsWith()`, `.charAt()`,
   `.substring()`, `.padStart()`):
   → Guard with `?.` or `(value ?? '').method()`

2. **Number methods** (`.toFixed()`, `.toLocaleString()`, `.toPrecision()`):
   → Guard with `(value ?? 0).method()`

3. **Array methods on nullable** (`.map()`, `.filter()`, `.reduce()`, `.length`,
   `.some()`, `.every()`, `.find()`, `.forEach()`):
   → Guard with `(value ?? []).method()` or `value?.method() ?? []`

4. **Nested property access** (`data.field.subfield`):
   → Guard with `data?.field?.subfield ?? fallback`

---

## Pass 2: Always-Show Panels with Empty-State Placeholder

### The Anti-Pattern

```tsx
// BAD — hides the entire section when no data
{data && (
  <GlassPanel>
    <h3>Some Section</h3>
    <Chart data={data} />
  </GlassPanel>
)}
```

### The Correct Pattern

```tsx
// GOOD — always shows the panel shell, empty state when no data
<GlassPanel>
  <h3>Some Section</h3>
  {data && data.length > 0 ? (
    <Chart data={data} />
  ) : (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
      <Info className="h-8 w-8 opacity-20" />
      <p className="text-xs">{t('common.noData', 'No data available')}</p>
    </div>
  )}
</GlassPanel>
```

### Where to Apply

Search for ALL instances of these patterns across `web/src/features/*/pages/*.tsx`:

```
# Conditional panel rendering
{someData && (<GlassPanel     → always render GlassPanel
{someData && (<ChartContainer → always render ChartContainer
{someData && (<FadeIn         → always render FadeIn
{someArray.length > 0 && (    → always render, show placeholder if empty
{someFlag && (<GlassPanel     → check if this is a feature flag (OK) or data guard (fix)
```

**For each match**:
1. Keep the panel shell (GlassPanel/ChartContainer/FadeIn) always visible
2. Move the data check INSIDE the panel
3. Show an empty-state placeholder when data is missing:
   ```tsx
   <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
     <Activity className="h-8 w-8 opacity-20" />
     <p className="text-xs">{t('common.noData', 'No data available')}</p>
   </div>
   ```
4. Use `Activity` from lucide-react as the default empty icon (already imported in most pages)

**Exceptions** — DO NOT convert these:
- Feature flags (`isAdmin && <AdminPanel>`) — legitimate access control
- Error/loading states (`isLoading ? <Skeleton> : ...`) — already handled
- Tabs/modals (`showModal && <Modal>`) — UI state, not data state
- Conditional fields (`vehicle.hasFeatureX && <FeaturePanel>`) — capability check

### Add i18n Key

Add to `web/src/i18n/en.json`:
```json
{
  "common": {
    "noData": "No data available",
    "noDataForPeriod": "No data available for this period"
  }
}
```

---

## Verification

```powershell
# 1. No unguarded .toLowerCase() on nullable
Select-String -Path web\src\features\*\pages\*.tsx -Recurse -Pattern '(?<!\?)\.(toLowerCase|toUpperCase)\(' |
  Where-Object { $_.Line -notmatch 'const \w+ =' -and $_.Line -notmatch '\.filter\(' }

# 2. No unguarded .toFixed() on nullable
Select-String -Path web\src\features\*\pages\*.tsx -Recurse -Pattern '(?<!\?\.)toFixed\(' |
  Where-Object { $_.Line -notmatch 'Math\.' -and $_.Line -notmatch ': number\)' -and $_.Line -notmatch 'parseFloat' }

# 3. TypeScript compiles
cd web && npx tsc --noEmit

# 4. No regressions — all existing functionality preserved
```

## Do NOT:
- Remove any page sections or functionality
- Add new inline styles
- Change API hook URLs (already fixed)
- Break existing null checks that are correct
- Convert feature-flag conditionals to always-show
