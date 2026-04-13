---
description: "DESTROY the ui.tsx monolith — split every component, fix every import, delete the file"
---

# Destroy the ui.tsx Monolith + Fix All Old API Imports

## ⛔ THREE THINGS MUST HAPPEN. NO SHORTCUTS. NO "LEGACY" RE-EXPORTS.

**Branch:** `refactor/full-rewrite`

The previous agent tried to "fix" ui.tsx by re-exporting it through ui/index.ts with
"Legacy" prefixes. **That is NOT refactoring — it's hiding the monolith behind an alias.**

**"Legacy" re-exports are BANNED. Each component gets its own file. Period.**

---

## TASK 1: Split ui.tsx — Every Component Into Its Own File

Here is EVERY export from `web/src/components/ui.tsx` and exactly where it goes.
**Do each one. Check it off. No skipping.**

### Components that ALREADY EXIST as separate files → just delete from ui.tsx

These are already in the right place. Remove them from ui.tsx and from ui/index.ts
"Legacy" re-exports. Update importers to use the proper path.

```
- [ ] Badge         → ALREADY at components/ui/Badge.tsx ✅ delete from ui.tsx
- [ ] Button        → ALREADY at components/ui/Button.tsx ✅ delete from ui.tsx
- [ ] Toggle        → ALREADY at components/ui/Toggle.tsx ✅ delete from ui.tsx
- [ ] Input         → ALREADY at components/ui/Input.tsx ✅ delete from ui.tsx
- [ ] Select        → ALREADY at components/ui/Select.tsx ✅ delete from ui.tsx
- [ ] Tooltip       → ALREADY at components/ui/Tooltip.tsx ✅ delete from ui.tsx
- [ ] GlassPanel    → ALREADY at components/ui/GlassPanel.tsx ✅ delete from ui.tsx
- [ ] Modal         → ALREADY at components/ui/Modal.tsx ✅ delete from ui.tsx
- [ ] StatCard      → ALREADY at components/data-display/StatCard.tsx ✅ delete from ui.tsx
- [ ] StatusBadge   → ALREADY at components/data-display/StatusBadge.tsx ✅ delete from ui.tsx
- [ ] ProgressRing  → ALREADY at components/data-display/ProgressRing.tsx ✅ delete from ui.tsx
- [ ] Skeleton      → ALREADY at components/feedback/Skeleton.tsx ✅ delete from ui.tsx
- [ ] EmptyState    → ALREADY at components/feedback/EmptyState.tsx ✅ delete from ui.tsx
- [ ] ConfirmDialog → ALREADY at components/ui/ConfirmDialog.tsx ✅ delete from ui.tsx (was ConfirmModal)
```

### Components that NEED TO BE EXTRACTED into new files

For each: copy the component code from ui.tsx → create new file → add to barrel → delete from ui.tsx.

```
- [ ] IconBox → CREATE components/ui/IconBox.tsx
      Add to components/ui/index.ts: export { IconBox } from './IconBox';

- [ ] FadeIn → CREATE components/motion/FadeIn.tsx
      Add to components/motion/index.ts: export { FadeIn } from './FadeIn';

- [ ] StaggerContainer → CREATE components/motion/StaggerContainer.tsx
      Add to components/motion/index.ts

- [ ] StaggerItem → CREATE components/motion/StaggerItem.tsx
      Add to components/motion/index.ts

- [ ] PageHeader → CREATE components/layout/PageHeader.tsx
      Add to components/layout/index.ts

- [ ] Sparkline → CREATE components/charts/Sparkline.tsx
      Add to components/charts/index.ts

- [ ] ChartSkeleton → CREATE components/feedback/ChartSkeleton.tsx
      Add to components/feedback/index.ts

- [ ] StatSkeleton → CREATE components/feedback/StatSkeleton.tsx
      Add to components/feedback/index.ts

- [ ] PageLoader → CREATE components/feedback/PageLoader.tsx
      Add to components/feedback/index.ts

- [ ] QueryError → CREATE components/feedback/QueryError.tsx
      Add to components/feedback/index.ts

- [ ] TabNav → CREATE components/ui/TabNav.tsx
      Add to components/ui/index.ts

- [ ] DateRangeFilter → CREATE components/forms/DateRangeFilter.tsx
      Add to components/forms/index.ts

- [ ] Pagination → CREATE components/ui/Pagination.tsx
      Add to components/ui/index.ts

- [ ] MetricCard → CREATE components/data-display/MetricCard.tsx
      Add to components/data-display/index.ts

- [ ] AlertBanner → CREATE components/feedback/AlertBanner.tsx
      Add to components/feedback/index.ts

- [ ] Accordion → CREATE components/ui/Accordion.tsx
      Add to components/ui/index.ts

- [ ] InlineMetric → CREATE components/data-display/InlineMetric.tsx
      Add to components/data-display/index.ts

- [ ] FormSection → CREATE components/forms/FormSection.tsx
      Add to components/forms/index.ts
```

### Also split Atoms.tsx and Composites.tsx (sub-monoliths inside ui/)

```
- [ ] components/ui/Atoms.tsx — exports Badge, Button, IconBox, Toggle, Input, Select, Tooltip
      These already have individual files. Delete Atoms.tsx after verifying individual files exist.
      Remove re-exports from ui/index.ts that point to Atoms.

- [ ] components/ui/Composites.tsx — exports DataTable, Modal, Drawer, ChartContainer, MetricCard, etc.
      For each export: verify individual file exists or create it. Then delete Composites.tsx.

- [ ] components/data-display/Widgets.tsx — another monolith
      Split into individual files. Delete Widgets.tsx.

- [ ] components/charts/Charts.tsx — another monolith
      Split into individual files. Delete Charts.tsx.
```

### Process for each extraction

```bash
COMPONENT="FadeIn"
SOURCE="web/src/components/ui.tsx"
TARGET="web/src/components/motion/FadeIn.tsx"  # adjust category

# 1. Extract the component code from ui.tsx into new file
# 2. Add proper imports at the top of the new file
# 3. Add to barrel: echo "export { $COMPONENT } from './$COMPONENT';" >> web/src/components/motion/index.ts
# 4. Find all importers:
grep -rn "import.*${COMPONENT}.*from.*'@/components/ui'" web/src/ --include="*.tsx" --include="*.ts"
# 5. Update each importer to new path:
#    from '@/components/ui' → from '@/components/motion'  (for FadeIn)
# 6. Verify: npx tsc --noEmit
```

---

## TASK 2: Clean ui/index.ts — Remove ALL "Legacy" Re-exports

After Task 1, `ui/index.ts` must contain ONLY exports of components that live in `ui/`:

```typescript
// web/src/components/ui/index.ts — CLEAN VERSION
// Only components that LIVE in this directory
export { Badge, type BadgeProps } from './Badge';
export { Button, type ButtonProps } from './Button';
export { Card, CardHeader } from './Card';
export { GlassPanel } from './GlassPanel';
export { Input } from './Input';
export { Select } from './Select';
export { Modal } from './Modal';
export { Toggle } from './Toggle';
export { Tooltip } from './Tooltip';
export { Tabs } from './Tabs';
export { StatusPill } from './StatusPill';
export { ConfirmDialog } from './ConfirmDialog';
export { IconBox } from './IconBox';
export { TabNav } from './TabNav';
export { Accordion } from './Accordion';
export { Pagination } from './Pagination';
export { Breadcrumb } from './Breadcrumb';
export { CommandPalette } from './CommandPalette';
export { Logo } from './Logo';
// NO re-exports from ../ui.tsx
// NO "Legacy" prefixed exports
// NO re-exports from Atoms.tsx or Composites.tsx
```

**Delete these lines from ui/index.ts if they exist:**
```
❌ export { ... } from '../ui';
❌ export { GlassPanel as LegacyGlassPanel } from '../ui';
❌ export { ... } from './Atoms';
❌ export { ... } from './Composites';
```

---

## TASK 3: Delete the monoliths

```bash
# Only delete AFTER all exports are extracted and all importers updated
rm web/src/components/ui.tsx
rm web/src/components/ui.test.tsx
rm web/src/components/ui/Atoms.tsx
rm web/src/components/ui/Atoms.test.tsx
rm web/src/components/ui/Composites.tsx
rm web/src/components/ui/Composites.test.tsx
rm web/src/components/data-display/Widgets.tsx
rm web/src/components/charts/Charts.tsx

# Verify build
cd web && npx tsc --noEmit
# If it fails: read the error, find what's missing, create the file, retry
```

---

## TASK 4: Fix 8 old API imports in vehicles features

These 6 files still import old API functions instead of TanStack Query hooks:

```
BatteryComparison.tsx  → getVehicleState from @/api/vehicles
FleetSummary.tsx       → getVehicleState from @/api/vehicles
VehicleCard.tsx        → getVehicleState, getVehicleStatus from @/api/vehicles
VehicleHeader.tsx      → wakeVehicle, getVehicleStatus from @/api/vehicles
VehicleDetailPage.tsx  → from @/api/vehicles, @/api/drives, @/api/charging
VehicleListPage.tsx    → syncVehicles, deleteVehicle from @/api/vehicles
```

### For each file:

**Step 1:** Check what hooks exist:
```bash
grep "export function" web/src/api/hooks/useVehicles.ts
grep "export function" web/src/api/hooks/useDriving.ts 2>/dev/null
grep "export function" web/src/api/hooks/useCharging.ts 2>/dev/null
```

**Step 2:** Create any missing hooks. These are needed:
```
useVehicleState(vehicleId)     — query, returns vehicle state
useVehicleStatus(vehicleId)    — query, returns online/offline status
useWakeVehicle()               — mutation
useSyncVehicles()              — mutation
useDeleteVehicle()             — mutation
useDrives(vehicleId)           — query, returns drives list
useChargingSessions(vehicleId) — query, returns charging sessions
```

**Step 3:** Replace old imports in each file:
```tsx
// BEFORE (direct function call — BAD)
import { getVehicleState } from '@/api/vehicles';
useEffect(() => { getVehicleState(id).then(setData); }, []);

// AFTER (TanStack Query hook — GOOD)
import { useVehicleState } from '@/api/hooks/useVehicles';
const { data, isLoading } = useVehicleState(id);
```

```tsx
// BEFORE (mutation — BAD)
import { deleteVehicle } from '@/api/vehicles';
await deleteVehicle(id);

// AFTER (mutation hook — GOOD)
import { useDeleteVehicle } from '@/api/hooks/useVehicles';
const { mutate: deleteVehicle } = useDeleteVehicle();
deleteVehicle(id);
```

**Step 4:** Verify zero old imports:
```bash
grep -rn "from '@/api/vehicles'\|from '@/api/drives'\|from '@/api/charging'" web/src/features/ --include="*.tsx" | wc -l
# MUST be 0
```

---

## FINAL VERIFICATION — ALL MUST PASS

```bash
echo "======================================="
echo "  FINAL VERIFICATION"
echo "======================================="

echo ""
echo "1. Monolith files (ALL must be gone):"
for f in web/src/components/ui.tsx web/src/components/ui.test.tsx \
         web/src/components/ui/Atoms.tsx web/src/components/ui/Composites.tsx \
         web/src/components/data-display/Widgets.tsx web/src/components/charts/Charts.tsx; do
  test -f "$f" && echo "  ❌ EXISTS: $f" || echo "  ✅ Deleted: $f"
done

echo ""
echo "2. Root component files:"
ROOT=$(find web/src/components/ -maxdepth 1 -name "*.tsx" | wc -l)
echo "  Count: $ROOT (must be 0)"

echo ""
echo "3. Legacy re-exports in ui/index.ts:"
LEGACY=$(grep -c "Legacy\|from '\.\./ui'" web/src/components/ui/index.ts 2>/dev/null)
echo "  Count: $LEGACY (must be 0)"

echo ""
echo "4. Re-exports from Atoms/Composites:"
ATOMS=$(grep -c "Atoms\|Composites" web/src/components/ui/index.ts 2>/dev/null)
echo "  Count: $ATOMS (must be 0)"

echo ""
echo "5. Old API imports in features:"
OLD_API=$(grep -rn "from '@/api/vehicles'\|from '@/api/drives'\|from '@/api/charging'" web/src/features/ --include="*.tsx" 2>/dev/null | wc -l)
echo "  Count: $OLD_API (must be 0)"

echo ""
echo "6. TypeScript:"
cd web && npx tsc --noEmit && echo "  ✅ PASS" || echo "  ❌ FAIL"
cd ..

echo ""
if [ "$ROOT" -eq 0 ] && [ "$LEGACY" -eq 0 ] && [ "$ATOMS" -eq 0 ] && [ "$OLD_API" -eq 0 ]; then
  echo "🟢 ALL CLEAN — ready for page 4"
else
  echo "🔴 VIOLATIONS REMAIN — fix before proceeding"
fi
```

**Paste the output. Must show 🟢. No exceptions. No "will fix later."**
