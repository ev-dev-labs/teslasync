---
description: "Restore ALL original page functionality — refactored pages must match or exceed the originals"
---

# Restore Full Page Functionality — The Refactoring Broke the UI

## ⛔ THE REFACTORING IS A REGRESSION. FIX IT.

The refactored pages use shared components but **deleted 80% of the original functionality**.
A page that "uses PageContainer and StatCard" but shows 5 plain text cards where the original
had gauges, charts, live telemetry, car visualization, and 20+ sections is NOT a successful
migration — it's a demolition.

**Rule: Every migrated page must have ALL the features of the original page. Not fewer.**

**Branch:** `refactor/full-rewrite`

---

## How This Happened

The agent treated "uses shared components" as the goal. The actual goal is:
**Same features + better architecture.** The user must not notice a downgrade.

```
WRONG approach (what the agent did):
  1. Read old page
  2. Create new page with PageContainer + 3 StatCards
  3. Declare done (deleted 80% of the original UI)

CORRECT approach (what must happen now):
  1. Read old page — catalog EVERY section, widget, chart, interaction
  2. For each section: find or create the shared component
  3. Recreate ALL sections using shared components
  4. Compare side-by-side: does the new page show everything the old one did?
  5. Only then declare done
```

---

## Process For EVERY Page

### Step 1: Retrieve the original page from git history

```bash
PAGE_NAME="Dashboard"  # change for each page

# Get the old page content from before the refactoring
git show main:web/src/pages/${PAGE_NAME}.tsx > /tmp/old_${PAGE_NAME}.tsx

echo "=== Old page sections ==="
# Find all major UI sections in the old page
grep -n "return\|<.*Card\|<.*Chart\|<.*Map\|<.*Table\|<.*Grid\|<.*Section\|<.*List\|className.*section\|className.*card\|<h[1-6]\|<Heading" /tmp/old_${PAGE_NAME}.tsx | head -40

echo ""
echo "=== Old page line count ==="
wc -l /tmp/old_${PAGE_NAME}.tsx

echo ""
echo "=== New page line count ==="
NEW_FILE=$(find web/src/features/ -name "${PAGE_NAME}Page.tsx" -o -name "${PAGE_NAME}ListPage.tsx" | head -1)
wc -l "$NEW_FILE"
```

**If the new page is significantly shorter than the old page (e.g., 50 lines vs 300 lines),
it's missing functionality.**

### Step 2: Catalog every feature of the original page

List EVERY widget, section, chart, card, table, interaction in the old page:

```
FEATURE CATALOG for [PageName]:
  [ ] Section 1: [description] — what data, what visualization
  [ ] Section 2: [description]
  [ ] Chart: [type, what data it shows]
  [ ] Table: [what columns, what data]
  [ ] Interactive: [buttons, filters, tabs]
  [ ] Real-time: [any live data, WebSocket, polling]
  ...
```

### Step 3: Check what shared components exist

```bash
# Do we have what we need?
echo "=== Available shared components ==="
find web/src/components/ -name "*.tsx" | sort

echo ""
echo "=== Available chart components ==="
ls web/src/components/charts/

echo ""
echo "=== Available data-display components ==="
ls web/src/components/data-display/
```

### Step 4: Create any missing shared components

If the old page had a widget type that doesn't exist as a shared component:

```
Old page has a gauge/circle chart    → Create components/charts/GaugeChart.tsx
Old page has a car visualization     → Create components/data-display/VehicleVisualization.tsx
Old page has a live telemetry panel  → Create components/data-display/TelemetryPanel.tsx
Old page has quick-nav cards         → Create components/ui/QuickNavCard.tsx
Old page has a timeline              → Verify components/data-display/Timeline.tsx exists
Old page has sparklines              → Create components/charts/SparklineChart.tsx
```

**Create the shared component FIRST, then use it in the page.**

### Step 5: Rebuild the page with ALL features

Recreate every section from Step 2 using shared components. Check off each item:

```
  [x] Section 1: recreated using [component]
  [x] Section 2: recreated using [component]
  [x] Chart: recreated using ChartContainer + TimeSeriesChart
  ...
```

### Step 6: Side-by-side comparison

```bash
echo "=== Old page features ==="
grep -c "Card\|Chart\|Table\|Grid\|Section\|Timeline\|Gauge\|Map" /tmp/old_${PAGE_NAME}.tsx

echo "=== New page features ==="
grep -c "Card\|Chart\|Table\|Grid\|Section\|Timeline\|Gauge\|Map" "$NEW_FILE"

echo "=== Old line count ==="
wc -l /tmp/old_${PAGE_NAME}.tsx

echo "=== New line count ==="
wc -l "$NEW_FILE"
```

**The new page should have EQUAL OR MORE component references than the old page.
If the new page has significantly fewer, features are missing.**

### Step 7: Verify build

```bash
cd web && npx tsc --noEmit && echo "✅ TS OK" || echo "❌ TS FAIL"
cd ..
```

### Step 8: Commit

```bash
git add -A
git commit -m "fix: restore full functionality for ${PAGE_NAME}Page — matches original"
```

---

## Priority Pages — Fix These First

These are the most-used pages. Fix in this order:

### 1. Dashboard (MOST CRITICAL)

Original had:
```
[ ] Vehicle name + VIN + online/offline status badge
[ ] Car visualization image with status indicators (locked/sentry/charging)
[ ] 5 gauge circles (Battery %, Range, Inside temp, Outside temp, + 1 more)
[ ] Stat row: Inside Temp, Outside Temp (with units)
[ ] Stat row: Odometer, Range (with units + icons)
[ ] Stat row: Status (Locked/Unlocked), Sentry (On/Off)
[ ] Stat row: Firmware version, Power
[ ] Tabs: Details | Commands | Live Map
[ ] Other Vehicles selector
[ ] Fleet Stats (30 days): Distance, Energy, Cost, Efficiency
[ ] Fleet counts: Drives, Charges, Unread Alerts
[ ] Recent Drives list (Start → End, distance)
[ ] Recent Charges list (kWh, cost)
[ ] LIVE TELEMETRY section:
    [ ] Drivetrain panel (Torque, Motor Temp, Gear, G-Force)
    [ ] Climate panel (Cabin temp, Outside, HVAC Power, Fan)
    [ ] Security panel (Lock, Sentry, Doors, Windows)
    [ ] Tire Pressure panel (4 tires with PSI + warning)
    [ ] Media panel (Artist, Status, Volume)
    [ ] Navigation panel (Destination, Distance, ETA)
```

### 2. Vehicle Detail Page

### 3. Charging Pages (List + Detail + Curve)

### 4. Trip Pages (List + Detail)

### 5. All other pages — same process

---

## Verification After ALL Pages Restored

```bash
echo "=== Line count comparison: old vs new ==="
for page in Dashboard Vehicles VehicleDetail Charging ChargeDetail Trips Settings; do
  OLD_LINES=$(git show main:web/src/pages/${page}.tsx 2>/dev/null | wc -l)
  NEW_FILE=$(find web/src/features/ -name "${page}*Page.tsx" | head -1)
  NEW_LINES=$(wc -l < "$NEW_FILE" 2>/dev/null)
  RATIO=$(echo "scale=0; $NEW_LINES * 100 / $OLD_LINES" | bc 2>/dev/null)
  echo "$page: old=${OLD_LINES}L new=${NEW_LINES}L (${RATIO}%)"
done

echo ""
echo "=== Component usage count (should be HIGH) ==="
grep -rc "from '@/components/" web/src/features/ --include="*.tsx" | awk -F: '{sum+=$2}END{print "Total shared component imports:", sum}'

echo ""
echo "=== Build ==="
cd web && npm run build && echo "✅ OK" || echo "❌ FAIL"
```

**New pages should be 80-120% the line count of old pages. If a new page is 30% of the
old page's size, it's missing features.**

---

## Do NOT say "done" until:

- [ ] Every page has ALL the features of its original version
- [ ] Dashboard has gauges, charts, live telemetry, fleet stats, recent activity
- [ ] No page is a "skeleton" with just a PageContainer + 3 StatCards
- [ ] Build passes
- [ ] You have compared old vs new line counts and component counts for major pages
