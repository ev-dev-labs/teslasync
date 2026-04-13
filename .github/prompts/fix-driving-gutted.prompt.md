---
description: "Fix 8 gutted Driving pages — restore full functionality from originals"
---

# Fix Gutted Driving Pages — Restore Full Functionality

## ⛔ 8 pages at 10-47% of original. ALL must reach ≥70%. ONE AT A TIME.

**Branch:** `refactor/full-rewrite`

| Page | Current | Original | Ratio | Target |
|------|---------|----------|-------|--------|
| DriveDetailPage | 87 | 796 | 11% | ≥557 lines |
| DriveScorePage | 93 | 889 | 10% | ≥622 lines |
| DrivingDynamicsPage | 90 | 618 | 15% | ≥433 lines |
| DrivetrainHealthPage | 89 | 667 | 13% | ≥467 lines |
| EfficiencyPage | 84 | 317 | 26% | ≥222 lines |
| SpeedProfilePage | 93 | 197 | 47% | ≥138 lines |
| RegenEfficiencyPage | 78 | 208 | 38% | ≥146 lines |
| RouteEfficiencyPage | 102 | 283 | 36% | ≥198 lines |

**For EACH page: retrieve original → catalog sections → create missing components → rebuild → verify.**

**Do them ONE AT A TIME. Verify line count after each. Do NOT batch.**

---

## Page 1: DriveDetailPage (87 → ≥557 lines)

```bash
git show feature/premium-ui:web/src/pages/DriveDetail.tsx > /tmp/old_DriveDetail.tsx
```

**Original sections to rebuild:**
```
- [ ] Drive header (date, duration, distance, back nav)
- [ ] Route map (MapContainer + Polyline + CircleMarker for start/end)
      Use @/components/maps/ wrappers — NOT direct react-leaflet
- [ ] Map layer switcher
- [ ] Stat cards grid: Distance, Duration, Efficiency, Avg Speed, Max Speed, 
      Energy Used, Battery Start→End, Elevation Change
- [ ] Speed over time chart (AreaChart — speed vs distance/time)
- [ ] Energy consumption chart (Line — kWh vs distance)
- [ ] Elevation profile chart (Area — elevation vs distance)
- [ ] Power/torque chart (ComposedChart — power + regen)
- [ ] Temperature during drive (Line — inside + outside temp)
- [ ] Drive segments table (if multi-stop)
```

## Page 2: DriveScorePage (93 → ≥622 lines)

```bash
git show feature/premium-ui:web/src/pages/DriveScore.tsx > /tmp/old_DriveScore.tsx
```

**Original sections to rebuild:**
```
- [ ] Overall score circular gauge (animated, 0-100)
- [ ] Score breakdown cards: Smoothness, Efficiency, Safety, Speed Compliance
      Each with its own gauge and score
- [ ] Score trend chart (LineChart — score over time/drives)
- [ ] Score by category bar chart
- [ ] Tips/recommendations based on low scores (Lightbulb icons)
- [ ] Drive history table with per-drive scores
- [ ] Date range filter
- [ ] Score comparison (current period vs previous)
- [ ] Achievement badges (Trophy, Award icons)
```

## Page 3: DrivingDynamicsPage (90 → ≥433 lines)

```bash
git show feature/premium-ui:web/src/pages/DrivingDynamics.tsx > /tmp/old_DrivingDynamics.tsx
```

**Original sections to rebuild:**
```
- [ ] G-force circular gauge (real-time or last-drive)
- [ ] Lateral vs longitudinal acceleration scatter/chart
- [ ] Speed distribution chart (AreaChart)
- [ ] Acceleration/deceleration events chart
- [ ] Motor temperature chart (LineChart)
- [ ] Torque distribution chart
- [ ] Metric cards: Peak acceleration, avg g-force, max speed, brake events
- [ ] Period selector (Select)
```

## Page 4: DrivetrainHealthPage (89 → ≥467 lines)

```bash
git show feature/premium-ui:web/src/pages/DrivetrainHealth.tsx > /tmp/old_DrivetrainHealth.tsx
```

**Original sections to rebuild:**
```
- [ ] Health status overview (CheckCircle/AlertTriangle indicators)
- [ ] Motor temperature chart (front + rear, LineChart over time)
- [ ] Inverter temperature chart
- [ ] Torque output chart (ComposedChart)
- [ ] Heatsink temperature trend
- [ ] Alert banner for any health warnings
- [ ] Metric cards: Motor temp, inverter temp, stator temp, battery voltage
- [ ] Health score gauge
- [ ] Historical comparison (Select for time period)
```

## Page 5: EfficiencyPage (84 → ≥222 lines)

```bash
git show feature/premium-ui:web/src/pages/Efficiency.tsx > /tmp/old_Efficiency.tsx
```

**Original sections to rebuild:**
```
- [ ] Efficiency metric cards: Wh/mi avg, best, worst, lifetime
- [ ] Daily efficiency chart (AreaChart)
- [ ] Efficiency by speed range (BarChart)
- [ ] Efficiency scatter plot (efficiency vs speed or temp)
- [ ] Date range filter + period selector
- [ ] Efficiency data table (daily breakdown)
- [ ] Temperature impact on efficiency chart
```

## Page 6: SpeedProfilePage (93 → ≥138 lines)

```bash
git show feature/premium-ui:web/src/pages/SpeedProfile.tsx > /tmp/old_SpeedProfile.tsx
```

**Original sections to rebuild:**
```
- [ ] Speed distribution bar chart (% time in speed buckets)
- [ ] Speed vs time scatter chart
- [ ] Stat cards: Avg speed, max speed, time over limit
- [ ] Speed bucket icons (city/highway/residential)
- [ ] Period selector
```

## Page 7: RegenEfficiencyPage (78 → ≥146 lines)

```bash
git show feature/premium-ui:web/src/pages/RegenEfficiency.tsx > /tmp/old_RegenEfficiency.tsx
```

**Original sections to rebuild:**
```
- [ ] Regen gauge (custom circular gauge)
- [ ] Monthly regen chart (ComposedChart — Line + Bar)
- [ ] Metric cards: Regen %, total regen kWh, regen per drive
- [ ] Regen data table with columns
- [ ] Period selector
```

## Page 8: RouteEfficiencyPage (102 → ≥198 lines)

```bash
git show feature/premium-ui:web/src/pages/RouteEfficiency.tsx > /tmp/old_RouteEfficiency.tsx
```

**Original sections to rebuild:**
```
- [ ] Route list with efficiency comparison
- [ ] Route efficiency bar chart
- [ ] Route trend line chart
- [ ] Metric cards: Most efficient route, worst route, avg efficiency
- [ ] Data table: Route name, drives count, avg Wh/mi, distance
- [ ] Sparkline per route showing trend
- [ ] Icon boxes for start/end locations
```

---

## RULES (same as charging fix — proven to work)

```
1. Retrieve old page: git show feature/premium-ui:web/src/pages/{Name}.tsx
2. Read it — understand ALL sections
3. Check if needed shared components exist — create in components/ if missing
4. Rebuild with ALL sections using shared components
5. Use PageContainer, useTranslation, TanStack Query hooks
6. NO raw HTML, NO direct recharts/leaflet, NO old API imports
7. Verify line count ≥70% of original
8. npx tsc --noEmit must pass
9. Commit after each page
```

---

## Verification After ALL 8 Pages

```bash
echo "=== LINE COUNTS ==="
for pair in "DriveDetailPage.tsx:796" "DriveScorePage.tsx:889" "DrivingDynamicsPage.tsx:618" \
            "DrivetrainHealthPage.tsx:667" "EfficiencyPage.tsx:317" "SpeedProfilePage.tsx:197" \
            "RegenEfficiencyPage.tsx:208" "RouteEfficiencyPage.tsx:283"; do
  FILE=$(echo $pair | cut -d: -f1)
  OLD=$(echo $pair | cut -d: -f2)
  FOUND=$(find web/src/features/driving/ -name "$FILE")
  if [ -n "$FOUND" ]; then
    NEW=$(wc -l < "$FOUND")
    PCT=$((NEW * 100 / OLD))
    if [ $PCT -ge 70 ]; then echo "  ✅ $FILE: $NEW/$OLD ($PCT%)"
    else echo "  ❌ $FILE: $NEW/$OLD ($PCT%) — STILL GUTTED"; fi
  fi
done

echo ""
echo "=== VIOLATIONS ==="
echo "Direct lib imports:"
grep -rn "from 'recharts'\|from 'react-leaflet'" web/src/features/driving/ --include="*.tsx" | wc -l
echo "Old API imports:"
grep -rn "from '@/api/vehicles'\|from '@/api/drives'" web/src/features/driving/ --include="*.tsx" | wc -l
echo "Raw HTML:"
grep -rc "<button \|<input \|<table \|<select " web/src/features/driving/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print sum}'
echo "Missing PageContainer:"
for f in $(find web/src/features/driving/ -name "*Page.tsx"); do
  grep -q "PageContainer" "$f" || echo "  ❌ $(basename $f)"
done

echo ""
echo "=== TypeScript ==="
cd web && npx tsc --noEmit && echo "✅ PASS" || echo "❌ FAIL"
cd ..
```

**ALL line counts ≥70%. Zero violations. TS passes. No exceptions.**
