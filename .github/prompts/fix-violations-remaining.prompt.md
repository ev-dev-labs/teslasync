---
description: "Fix 3 remaining violations: ui.tsx monolith, old API imports, missing PageContainer"
---

# Fix 3 Remaining Violations

## ⛔ Fix ALL 3 before proceeding to page 4. No partial fixes.

**Branch:** `refactor/full-rewrite`

---

## Violation 1: components/ui.tsx monolith (23 exports at root)

`web/src/components/ui.tsx` has 23 exports in a single file sitting at the components root.
The individual components already exist in `components/ui/*.tsx` and are exported from `components/ui/index.ts`.

**Check if ui.tsx exports are already in the subdirectory:**

```bash
echo "=== Exports in components/ui.tsx ==="
grep "^export" web/src/components/ui.tsx | head -25

echo ""
echo "=== Exports in components/ui/index.ts ==="
grep "^export" web/src/components/ui/index.ts
```

**If every export from ui.tsx already exists in ui/index.ts → just delete the monolith:**

```bash
# Check who still imports from the monolith
grep -rn "from '@/components/ui'" web/src/ --include="*.tsx" --include="*.ts" | head -20
# NOTE: "from '@/components/ui'" hits BOTH the barrel (ui/index.ts) and the monolith (ui.tsx)
# TypeScript resolves to ui/index.ts first if it exists, so deleting ui.tsx should be safe

# Delete the monolith
rm web/src/components/ui.tsx
rm web/src/components/ui.test.tsx

# Verify nothing broke
cd web && npx tsc --noEmit && echo "✅ TS OK" || echo "❌ TS FAIL — some component was only in ui.tsx"
cd ..
```

**If tsc fails after deleting → some exports only existed in ui.tsx:**
1. Find what's missing from the error messages
2. Create the missing component in `components/ui/{Name}.tsx`
3. Add it to `components/ui/index.ts`
4. Re-run tsc

**After fix:**
```bash
ls web/src/components/*.tsx 2>/dev/null | wc -l  # must be 0
```

---

## Violation 2: 8 old API imports in vehicles features

These 6 files import functions directly from old API modules instead of using TanStack Query hooks:

```
BatteryComparison.tsx  → import { getVehicleState } from '@/api/vehicles'
FleetSummary.tsx       → import { getVehicleState } from '@/api/vehicles'
VehicleCard.tsx        → import { getVehicleState, getVehicleStatus } from '@/api/vehicles'
VehicleHeader.tsx      → import { wakeVehicle, getVehicleStatus } from '@/api/vehicles'
VehicleDetailPage.tsx  → from '@/api/vehicles', '@/api/drives', '@/api/charging'
VehicleListPage.tsx    → import { syncVehicles, deleteVehicle } from '@/api/vehicles'
```

### Step 1: Check what hooks already exist

```bash
echo "=== Existing vehicle hooks ==="
grep "export function" web/src/api/hooks/useVehicles.ts
echo ""
echo "=== Existing driving hooks ==="
grep "export function" web/src/api/hooks/useDriving.ts 2>/dev/null
echo ""
echo "=== Existing charging hooks ==="
grep "export function" web/src/api/hooks/useCharging.ts 2>/dev/null
```

### Step 2: Create any missing hooks

If these don't exist in `api/hooks/useVehicles.ts`, add them:

```typescript
// Hooks needed for vehicles feature:
useVehicleState(vehicleId)      — fetches vehicle state data
useVehicleStatus(vehicleId)     — fetches vehicle online/offline status
useWakeVehicle()                — mutation to wake vehicle
useSyncVehicles()               — mutation to sync fleet
useDeleteVehicle()              — mutation to delete vehicle
```

If these don't exist in `api/hooks/useDriving.ts` or `useTrips.ts`:
```typescript
useDrives(vehicleId)            — fetches drives for a vehicle
```

If these don't exist in `api/hooks/useCharging.ts`:
```typescript
useChargingSessions(vehicleId)  — fetches charging sessions for a vehicle
```

**Follow the existing hook pattern in the file.** Use query key factories, apiClient, proper types.

### Step 3: Replace old imports in each file

For each of the 6 files:

```tsx
// BEFORE — direct API function call
import { getVehicleState } from '@/api/vehicles';
// ... somewhere in the component:
const state = await getVehicleState(vehicleId);

// AFTER — TanStack Query hook
import { useVehicleState } from '@/api/hooks/useVehicles';
// ... in the component:
const { data: state, isLoading } = useVehicleState(vehicleId);
```

**For mutations:**
```tsx
// BEFORE
import { deleteVehicle } from '@/api/vehicles';
await deleteVehicle(id);

// AFTER
import { useDeleteVehicle } from '@/api/hooks/useVehicles';
const deleteMutation = useDeleteVehicle();
deleteMutation.mutate(id);
```

**Fix all 6 files. Each file must have ZERO imports from `@/api/vehicles`, `@/api/drives`, or `@/api/charging`.**

### Step 4: Verify

```bash
echo "=== Old API imports (must be 0) ==="
grep -rn "from '@/api/vehicles'\|from '@/api/drives'\|from '@/api/charging'" web/src/features/ --include="*.tsx" | wc -l

echo ""
echo "=== New hook imports (should be >0) ==="
grep -rn "from '@/api/hooks/" web/src/features/vehicles/ web/src/features/dashboard/ --include="*.tsx" | wc -l

cd web && npx tsc --noEmit && echo "✅ TS OK" || echo "❌ TS FAIL"
cd ..
```

---

## Violation 3: VehicleDetailPage missing PageContainer

```bash
echo "=== Current VehicleDetailPage wrapper ==="
head -30 web/src/features/vehicles/pages/VehicleDetailPage.tsx
```

**Wrap the page in PageContainer:**

```tsx
import { PageContainer } from '@/components/layout/PageContainer';

export default function VehicleDetailPage() {
  const { data: vehicle, isLoading, error } = useVehicle(id);

  return (
    <PageContainer
      title={vehicle?.display_name ?? t('vehicles.detail.title')}
      loading={isLoading}
      error={error}
    >
      {/* ... existing page content ... */}
    </PageContainer>
  );
}
```

**Verify:**
```bash
grep -q "PageContainer" web/src/features/vehicles/pages/VehicleDetailPage.tsx && echo "✅ Has PageContainer" || echo "❌ MISSING"
```

---

## Final Verification — ALL 3 Violations Must Be Resolved

```bash
echo "======================================="
echo "  FINAL CHECK"
echo "======================================="

echo ""
echo "1. Root component files:"
ROOT_COUNT=$(ls web/src/components/*.tsx 2>/dev/null | wc -l)
echo "   Count: $ROOT_COUNT (must be 0)"

echo ""
echo "2. Old API imports in features:"
OLD_API=$(grep -rn "from '@/api/vehicles'\|from '@/api/drives'\|from '@/api/charging'" web/src/features/ --include="*.tsx" 2>/dev/null | wc -l)
echo "   Count: $OLD_API (must be 0)"

echo ""
echo "3. PageContainer in VehicleDetailPage:"
grep -q "PageContainer" web/src/features/vehicles/pages/VehicleDetailPage.tsx && echo "   ✅ Present" || echo "   ❌ MISSING"

echo ""
echo "4. TypeScript:"
cd web && npx tsc --noEmit && echo "   ✅ PASS" || echo "   ❌ FAIL"
cd ..

echo ""
if [ "$ROOT_COUNT" -eq 0 ] && [ "$OLD_API" -eq 0 ]; then
  echo "🟢 ALL VIOLATIONS FIXED — ready for page 4"
else
  echo "🔴 VIOLATIONS REMAIN — fix before proceeding"
fi
```

**Paste the output. Must show 🟢 before you can claim done.**
