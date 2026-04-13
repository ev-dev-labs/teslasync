---
description: "Fix 5 minor charging violations — PageContainer, raw HTML, inline styles, direct import"
---

# Fix Charging Page Violations — 5 Quick Fixes

## ⛔ Fix ALL 5. These are small but they block moving to page 5.

**Branch:** `refactor/full-rewrite`

---

## Fix 1: ChargingCurvePage.tsx — missing PageContainer + 7 inline styles

```bash
grep -n "PageContainer" web/src/features/charging/pages/ChargingCurvePage.tsx
# If nothing found → wrap page content in PageContainer
grep -n "style={" web/src/features/charging/pages/ChargingCurvePage.tsx
# Each one → replace with Tailwind class
```

**Add PageContainer:**
```tsx
import { PageContainer } from '@/components/layout';

export default function ChargingCurvePage() {
  return (
    <PageContainer title={t('charging.curve.title')} loading={isLoading} error={error}>
      {/* ... existing content ... */}
    </PageContainer>
  );
}
```

**Replace inline styles with Tailwind:**
```
style={{ color: '#10b981' }}     →  className="text-emerald-500"
style={{ color: '#f59e0b' }}     →  className="text-amber-500"
style={{ color: '#a855f7' }}     →  className="text-purple-500"
style={{ color: '#00f0ff' }}     →  className="text-cyan-400"
style={{ color: '#ef4444' }}     →  className="text-red-500"
style={{ color: '#6b7280' }}     →  className="text-gray-500"
style={{ width: '...' }}         →  className="w-[value]"
style={{ height: '...' }}        →  className="h-[value]"
```

For truly dynamic values (color from a variable), use `style` but keep to ≤2 per file.

---

## Fix 2: CostAnalysisPage.tsx — missing PageContainer + 3 inline styles

Same process:
```bash
grep -n "PageContainer" web/src/features/charging/pages/CostAnalysisPage.tsx
grep -n "style={" web/src/features/charging/pages/CostAnalysisPage.tsx
```
Add PageContainer wrapper. Replace inline styles with Tailwind where possible.

---

## Fix 3: ChargingListPage.tsx — 2 raw HTML buttons + 4 inline styles

The raw HTML is actually `<Button>` components (already using shared component) but grep
caught them. Verify:
```bash
grep -n "<button \|<Button" web/src/features/charging/pages/ChargingListPage.tsx | head -5
```
If they're `<Button>` (uppercase) from the shared library → that's fine, not a violation.
If they're `<button>` (lowercase) → replace with `Button` from `@/components/ui`.

Fix the 4 inline styles same as Fix 1.

---

## Fix 4: ChargingDetailPage.tsx — 1 direct react-leaflet import

```bash
grep -n "from 'react-leaflet'" web/src/features/charging/pages/ChargingDetailPage.tsx
```

This imports `CircleMarker` directly from react-leaflet. Fix:
- If `components/maps/` has a wrapper for CircleMarker → use it
- If not → create `components/maps/MapCircleMarker.tsx`, add to barrel, use it
- Or if CircleMarker is only used once, consider using `MapMarker` with custom styling

```tsx
// BEFORE
import { CircleMarker } from 'react-leaflet';

// AFTER — option A: use existing MapMarker
import { MapMarker } from '@/components/maps';

// AFTER — option B: create new wrapper
import { MapCircleMarker } from '@/components/maps';
```

---

## Fix 5: ChargingHeatmapPage.tsx — 47% of original (thin)

```bash
git show feature/premium-ui:web/src/pages/ChargingHeatmap.tsx > /tmp/old_ChargingHeatmap.tsx
wc -l /tmp/old_ChargingHeatmap.tsx  # 178 lines
wc -l web/src/features/charging/pages/ChargingHeatmapPage.tsx  # currently 84 lines
```

Read the original. Identify what's missing. Add the missing sections.
Target: ≥125 lines (70% of 178).

---

## Verification

```bash
echo "=== PageContainer check ==="
for f in ChargingCurvePage ChargingDetailPage ChargingListPage CostAnalysisPage ChargingHeatmapPage; do
  FILE=$(find web/src/features/charging/ -name "${f}.tsx")
  if grep -q "PageContainer" "$FILE"; then echo "  ✅ $f"; else echo "  ❌ $f MISSING"; fi
done

echo ""
echo "=== Direct library imports (must be 0) ==="
grep -rn "from 'recharts'\|from 'react-leaflet'\|from 'framer-motion'" web/src/features/charging/ --include="*.tsx" | wc -l

echo ""
echo "=== Inline styles per file (each ≤2) ==="
for f in $(find web/src/features/charging/ -name "*.tsx"); do
  COUNT=$(grep -c "style={" "$f" 2>/dev/null)
  NAME=$(basename "$f")
  if [ "$COUNT" -gt 2 ]; then echo "  ❌ $NAME: $COUNT"; else echo "  ✅ $NAME: $COUNT"; fi
done

echo ""
echo "=== Raw HTML (must be 0) ==="
grep -rc "<button \|<input \|<table \|<select " web/src/features/charging/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print "  Count:", sum}'

echo ""
echo "=== ChargingHeatmapPage line count ==="
wc -l web/src/features/charging/pages/ChargingHeatmapPage.tsx

echo ""
echo "=== TypeScript ==="
cd web && npx tsc --noEmit && echo "  ✅ PASS" || echo "  ❌ FAIL"
cd ..
```

**All PageContainers present. Zero direct imports. Each file ≤2 inline styles. Zero raw HTML. TS passes.**
