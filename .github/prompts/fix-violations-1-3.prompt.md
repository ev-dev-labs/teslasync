---
description: "Fix all violations found in Dashboard + Vehicles pages before continuing to page 4"
---

# Fix Violations in Pages 1-3 (Dashboard + Vehicles)

## ⛔ Do NOT proceed to page 4 until ALL violations below are fixed.

**Branch:** `refactor/full-rewrite`

The audit found 5 categories of violations. Fix them ALL in this order.

---

## Violation 1: Monolith Component Files (6 files with multiple exports)

These files at `components/` root have multiple exports crammed into one file.
**Split each into separate files in the correct subdirectory.**

| Monolith File | Exports | Split Into |
|---|---|---|
| `components/ui.tsx` | 19 exports | Split each into `components/ui/{ComponentName}.tsx` — add to `ui/index.ts` barrel |
| `components/Widgets.tsx` | 6 exports (RadialGauge, MetricBar, etc.) | `components/charts/RadialGauge.tsx`, `components/data-display/MetricBar.tsx`, etc. |
| `components/Charts.tsx` | 12 exports | Split each into `components/charts/{ChartName}.tsx` — add to `charts/index.ts` |
| `components/TeslaCarViz.tsx` | 3 exports | Move to `components/data-display/TeslaCarViz.tsx` |
| `components/CarAnimation.tsx` | 4 exports | Move to `components/motion/CarAnimation.tsx` |
| `components/DriveScore.tsx` | 3 exports | Move to `components/data-display/DriveScore.tsx` |

**For each file:**
```bash
# 1. Create the new file in correct subdirectory
# 2. Move the export there
# 3. Add to barrel index.ts
# 4. Update ALL importers: grep -rn "from '@/components/OldFile'" web/src/
# 5. Delete the old monolith file once empty
# 6. Verify: npx tsc --noEmit
```

## Violation 2: 31 Component Files at components/ Root

These files sit at `components/` root instead of a subdirectory. Move each:

```
components/Breadcrumb.tsx        → components/ui/Breadcrumb.tsx
components/CommandPalette.tsx    → components/ui/CommandPalette.tsx
components/ErrorBoundary.tsx     → components/feedback/ErrorBoundary.tsx
components/HelpTooltip.tsx       → components/ui/HelpTooltip.tsx
components/InsightsEngine.tsx    → components/data-display/InsightsEngine.tsx
components/InstallPrompt.tsx     → components/feedback/InstallPrompt.tsx
components/Layout.tsx            → components/layout/Layout.tsx
components/Logo.tsx              → components/ui/Logo.tsx
components/MapLayerSwitcher.tsx  → components/maps/MapLayerSwitcher.tsx
components/MapTileLayer.tsx      → components/maps/MapTileLayer.tsx
components/OnboardingWizard.tsx  → components/feedback/OnboardingWizard.tsx
components/PollingEngine.tsx     → components/data-display/PollingEngine.tsx
components/ReleaseNotes.tsx      → components/feedback/ReleaseNotes.tsx
components/ReloadPrompt.tsx      → components/feedback/ReloadPrompt.tsx
components/RuleBuilder.tsx       → components/forms/RuleBuilder.tsx
components/ServiceStatus.tsx     → components/data-display/ServiceStatus.tsx
components/SignalConfigModal.tsx  → components/ui/SignalConfigModal.tsx
components/ThemeProvider.tsx     → components/ui/ThemeProvider.tsx
components/Toast.tsx             → components/feedback/Toast.tsx
```

**For EACH file:**
```bash
FILE="Breadcrumb"
OLD="web/src/components/${FILE}.tsx"
NEW="web/src/components/ui/${FILE}.tsx"  # adjust category as needed

# 1. Move file
mv "$OLD" "$NEW"

# 2. Move test file if exists
mv "${OLD%.tsx}.test.tsx" "${NEW%.tsx}.test.tsx" 2>/dev/null

# 3. Add to barrel
echo "export { ${FILE} } from './${FILE}';" >> web/src/components/ui/index.ts

# 4. Update ALL importers
grep -rn "from '@/components/${FILE}'" web/src/ --include="*.tsx" --include="*.ts"
# For each result: update the import path

# 5. Verify
cd web && npx tsc --noEmit && echo "✅" || echo "❌"
cd ..
```

## Violation 3: Missing Barrel Exports (3 directories)

```bash
# Create maps barrel
cat > web/src/components/maps/index.ts << 'EOF'
export { MapContainer } from './MapContainer';
export { MapMarker } from './MapMarker';
export { MapRoute } from './MapRoute';
export { MapLayerSwitcher } from './MapLayerSwitcher';
export { MapTileLayer } from './MapTileLayer';
EOF

# Create forms barrel
cat > web/src/components/forms/index.ts << 'EOF'
export { FormField } from './FormField';
export { SearchInput } from './SearchInput';
export { RuleBuilder } from './RuleBuilder';
EOF

# Create motion barrel
cat > web/src/components/motion/index.ts << 'EOF'
export { FadeIn } from './FadeIn';
export { CarAnimation } from './CarAnimation';
EOF
```

**After creating barrels, update imports in features to use barrel:**
```
BEFORE: import { GlassPanel } from '@/components/ui/GlassPanel';
AFTER:  import { GlassPanel } from '@/components/ui';
```

## Violation 4: Old API Imports (8 imports using old api/ instead of api/hooks/)

These files import directly from old API modules instead of TanStack Query hooks:

```
vehicles/components/BatteryComparison.tsx  → import { getVehicleState } from '@/api/vehicles'
vehicles/components/FleetSummary.tsx       → import { getVehicleState } from '@/api/vehicles'
vehicles/components/VehicleCard.tsx        → import { getVehicleState, getVehicleStatus } from '@/api/vehicles'
vehicles/components/VehicleHeader.tsx      → import { wakeVehicle, getVehicleStatus } from '@/api/vehicles'
vehicles/pages/VehicleDetailPage.tsx       → from '@/api/vehicles', '@/api/drives', '@/api/charging'
vehicles/pages/VehicleListPage.tsx         → import { syncVehicles, deleteVehicle } from '@/api/vehicles'
```

**Fix each:** Replace old API function calls with TanStack Query hooks from `@/api/hooks/useVehicles.ts`:

```tsx
// BEFORE
import { getVehicleState } from '@/api/vehicles';
const data = await getVehicleState(id);

// AFTER
import { useVehicleState } from '@/api/hooks/useVehicles';
const { data } = useVehicleState(id);
```

If the needed hook doesn't exist in `api/hooks/`, CREATE it first.

## Violation 5: Direct Library Imports in Features (recharts + react-leaflet)

```
vehicles/components/VehicleCharts.tsx → from 'recharts'
vehicles/components/VehicleCharts.tsx → from 'react-leaflet'
```

**Fix:** Replace with shared wrappers from `components/charts/` and `components/maps/`:

```tsx
// BEFORE
import { LineChart, Line, XAxis, YAxis } from 'recharts';
import { MapContainer, Polyline, Marker } from 'react-leaflet';

// AFTER
import { TimeSeriesChart } from '@/components/charts';
import { MapContainer, MapRoute, MapMarker } from '@/components/maps';
```

## Violation 6: DashboardPage has old fetch pattern

```bash
grep -n "useEffect\|fetch\|set[A-Z]" web/src/features/dashboard/pages/DashboardPage.tsx
```

Replace any `useEffect(() => { fetch... })` with TanStack Query hooks from `api/hooks/useDashboard.ts`.

## Violation 7: VehicleDetailPage missing PageContainer

```bash
grep -n "PageContainer" web/src/features/vehicles/pages/VehicleDetailPage.tsx
# Should find it — if not, wrap the page content in <PageContainer>
```

---

## After ALL Fixes — Verification

```bash
echo "=== Root component files (must be 0) ==="
ls web/src/components/*.tsx 2>/dev/null | wc -l

echo "=== Barrel exports ==="
for d in ui layout feedback data-display charts maps forms motion; do
  test -f "web/src/components/$d/index.ts" && echo "✅ $d" || echo "❌ $d MISSING"
done

echo "=== Old API imports in features (must be 0) ==="
grep -rc "from '@/api/vehicles'\|from '@/api/charging'\|from '@/api/drives'" web/src/features/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print sum}'

echo "=== Direct recharts/leaflet in features (must be 0) ==="
grep -rc "from 'recharts'\|from 'react-leaflet'" web/src/features/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print sum}'

echo "=== fetch in features (must be 0) ==="
grep -rc "fetch(" web/src/features/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print sum}'

echo "=== Build ==="
cd web && npx tsc --noEmit && echo "✅ TS OK" || echo "❌ TS FAIL"
npm run build 2>&1 | tail -3
[ $? -eq 0 ] && echo "✅ Build OK" || echo "❌ Build FAIL"
cd ..
```

**ALL counts must be 0. Build must pass. Paste output.**
