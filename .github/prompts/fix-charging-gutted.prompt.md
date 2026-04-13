---
description: "Fix 3 gutted Charging pages + raw HTML in ChargingListPage"
---

# Fix Gutted Charging Pages — Restore Full Functionality

## ⛔ These pages are 8-11% of the original. That is unacceptable.

**Branch:** `refactor/full-rewrite`

| Page | Current | Original | Ratio | Status |
|------|---------|----------|-------|--------|
| ChargingDetailPage | 60 lines | 527 lines | 11% | ❌ GUTTED |
| ChargingCurvePage | 84 lines | 935 lines | 9% | ❌ GUTTED |
| CostAnalysisPage | 85 lines | 1016 lines | 8% | ❌ GUTTED |
| ChargingListPage | 869 lines | 721 lines | 121% | ⚠️ has 2 raw HTML + 4 inline styles |

**Minimum target: each page ≥ 70% of original line count with ALL sections present.**

---

## Fix 1: ChargingDetailPage (60 → minimum 369 lines)

**Retrieve original:**
```bash
git show feature/premium-ui:web/src/pages/ChargeDetail.tsx > /tmp/old_ChargeDetail.tsx
wc -l /tmp/old_ChargeDetail.tsx  # 527 lines
```

**Original had these sections (ALL must be rebuilt):**
```
- [ ] Page header with session ID, date, back navigation
- [ ] 8 stat cards in a grid:
      Energy Added (kWh), Duration, Peak Power (kW), SoC Range (start% → end%),
      Total Cost ($), Cost Per kWh, Range Gained, Efficiency
- [ ] Charging curve chart (power kW vs time, battery % overlay)
- [ ] Session timeline / phases (connecting → ramping → steady → tapering → complete)
- [ ] Charger info section (charger type, voltage, amps, phases, location)
- [ ] Cost breakdown (energy cost, time-of-use rates if applicable)
- [ ] Location map showing where charging happened
- [ ] Comparison with previous sessions at same location
```

**Rebuild using shared components:**
```
StatCard from @/components/data-display
ChartContainer + TimeSeriesChart from @/components/charts
Timeline from @/components/data-display
MapContainer + MapMarker from @/components/maps
GlassPanel from @/components/ui
PageContainer from @/components/layout
useChargingSession from @/api/hooks/useCharging
useTranslation from react-i18next
```

---

## Fix 2: ChargingCurvePage (84 → minimum 654 lines)

**Retrieve original:**
```bash
git show feature/premium-ui:web/src/pages/ChargingCurve.tsx > /tmp/old_ChargingCurve.tsx
wc -l /tmp/old_ChargingCurve.tsx  # 935 lines
```

**Original had these sections (ALL must be rebuilt):**
```
- [ ] Session selector dropdown (pick which charging session to view)
- [ ] Main charging curve chart:
      X-axis: time or SoC%, Y-axis: power (kW)
      Shows power tapering as battery fills
      Custom tooltip with detailed values
- [ ] Session comparison mode (overlay 2+ sessions on same chart)
- [ ] Charger type breakdown (Supercharger vs Home vs Public DC)
      Colored by charger type
- [ ] Statistics summary cards:
      Avg power, peak power, total energy, charge rate, time to 80%
- [ ] Monthly charging pattern chart (bar chart by month)
- [ ] Efficiency metrics (kWh added vs kWh from grid, losses)
- [ ] Session list/table at bottom with sortable columns
```

**Rebuild using shared components:**
```
ChartContainer + TimeSeriesChart + BarChart from @/components/charts
Select from @/components/ui (session picker)
StatCard from @/components/data-display
DataTable from @/components/data-display
GlassPanel from @/components/ui
PageContainer from @/components/layout
```

---

## Fix 3: CostAnalysisPage (85 → minimum 711 lines)

**Retrieve original:**
```bash
git show feature/premium-ui:web/src/pages/CostAnalysis.tsx > /tmp/old_CostAnalysis.tsx
wc -l /tmp/old_CostAnalysis.tsx  # 1016 lines
```

**Original had these sections (ALL must be rebuilt):**
```
- [ ] Date range filter with presets (7d, 30d, 90d, 1y, custom)
- [ ] Summary stat cards:
      Total cost, cost per kWh, cost per mile, total energy,
      savings vs gas (calculated from gas price comparison)
- [ ] Cost over time chart (line/area chart, monthly or weekly)
- [ ] Cost by charger type breakdown (pie/bar chart):
      Supercharger vs Home vs Public DC vs Work
- [ ] Gas vs Electric comparison:
      What it would cost to drive same miles on gas
      Savings amount and percentage
- [ ] Monthly cost table with columns:
      Month, Sessions, Energy (kWh), Cost ($), Avg $/kWh, Savings vs Gas
- [ ] Cost per session chart (scatter or bar)
- [ ] Time-of-use analysis (if applicable — peak vs off-peak charging cost)
- [ ] Projected annual cost based on current trends
```

**Rebuild using shared components:**
```
DateRangeFilter from @/components/forms
StatCard from @/components/data-display
ChartContainer + TimeSeriesChart + BarChart + PieChart from @/components/charts
DataTable from @/components/data-display
GlassPanel from @/components/ui
PageContainer from @/components/layout
```

---

## Fix 4: ChargingListPage raw HTML + inline styles

```bash
echo "=== Find raw HTML ==="
grep -n "<button \|<input \|<table \|<select " web/src/features/charging/pages/ChargingListPage.tsx

echo "=== Find inline styles ==="
grep -n "style={" web/src/features/charging/pages/ChargingListPage.tsx
```

Replace each:
- `<button>` → `Button` from `@/components/ui`
- `<input>` → `Input` from `@/components/ui`
- `<table>` → `DataTable` from `@/components/data-display`
- `<select>` → `Select` from `@/components/ui`
- `style={{color: ...}}` → Tailwind `text-[color]` or `className` with dynamic class

---

## Verification — ALL must pass

```bash
echo "=== Line counts (all must be ≥70% of original) ==="
for pair in "ChargingDetailPage.tsx:527" "ChargingCurvePage.tsx:935" "CostAnalysisPage.tsx:1016" "ChargingListPage.tsx:721"; do
  FILE=$(echo $pair | cut -d: -f1)
  OLD=$(echo $pair | cut -d: -f2)
  FOUND=$(find web/src/features/charging/ -name "$FILE")
  if [ -n "$FOUND" ]; then
    NEW=$(wc -l < "$FOUND")
    PCT=$((NEW * 100 / OLD))
    if [ $PCT -ge 70 ]; then
      echo "  ✅ $FILE: $NEW/$OLD lines ($PCT%)"
    else
      echo "  ❌ $FILE: $NEW/$OLD lines ($PCT%) — STILL GUTTED"
    fi
  fi
done

echo ""
echo "=== Raw HTML (must be 0) ==="
grep -rc "<button \|<input \|<table \|<select " web/src/features/charging/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print "  Count:", sum}'

echo ""
echo "=== Inline styles (should be ≤2 per file) ==="
for f in $(find web/src/features/charging/ -name "*.tsx"); do
  COUNT=$(grep -c "style={" "$f" 2>/dev/null)
  if [ "$COUNT" -gt 2 ]; then
    echo "  ⚠️ $(basename $f): $COUNT inline styles"
  fi
done

echo ""
echo "=== TypeScript ==="
cd web && npx tsc --noEmit && echo "  ✅ PASS" || echo "  ❌ FAIL"
cd ..

echo ""
echo "=== Docker rebuild + verify ==="
docker build -f deploy/docker/Dockerfile.web -t teslasync-web:refactor ./web 2>&1 | tail -3
docker compose up -d web && sleep 5
curl -sf http://localhost:3000/ && echo "  ✅ Web loads" || echo "  ❌ Web broken"
```

**ALL line counts must be ≥70%. Zero raw HTML. TypeScript passes. Page loads in Docker.**
