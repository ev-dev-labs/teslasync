---
description: "Restore SignalGapDetector page — rebuild with shared components matching original 199-line page"
---

# Restore: SignalGapDetector → features/telemetry/pages/SignalGapDetectorPage.tsx

## Context

| Property | Value |
|----------|-------|
| **Old page** | `web/src/pages/SignalGapDetector.tsx` (199 lines) |
| **New page** | `web/src/features/telemetry/pages/SignalGapDetectorPage.tsx` |
| **Status** | GUTTED — new page is a skeleton missing most features |
| **Goal** | Rebuild to match ALL original functionality using shared components |

## ⛔ STRATEGY: Components First, Then Page

`
STEP 1: Retrieve the old page from git
STEP 2: Catalog every component, section, chart, interaction in the old page
STEP 3: For each component used — check if shared version exists
STEP 4: If shared version MISSING → create it in components/ FIRST
STEP 5: ONLY AFTER all components exist → rebuild the page
STEP 6: Compare old vs new — verify nothing is missing
`

## Step 1: Retrieve the original page

```bash
git show feature/premium-ui:web/src/pages/SignalGapDetector.tsx > /tmp/old_SignalGapDetector.tsx
wc -l /tmp/old_SignalGapDetector.tsx
```

## Step 2: Catalog the original page

Read the old page carefully. List EVERY section and widget it had.

**Components the old page used:**
```
  - <AlertTriangle
  - <ArrowUpDown
  - <Badge
  - <button
  - <DataTable
  - <div
  - <FadeIn
  - <Filter
  - <FilterMode
  - <GlassPanel
  - <input
  - <LiveSignalState
  - <PageHeader
  - <RefreshCw
  - <SignalRow
  - <Skeleton
  - <SortMode
  - <span
  - <StatCard
  - <string
```

**Hooks the old page used:**
```
  - useMemo(
  - usePageTitle(
  - useState(
```

**Charts/visualizations:**
```
  - line
```

**Raw HTML elements in old page: 3**

Write a FULL feature checklist:
```
[ ] Section: [name] — [what it shows]
[ ] Section: ...
[ ] Chart: [type] — [what data]
[ ] Table: [columns]
[ ] Interactive: [buttons, filters, tabs, modals]
[ ] Real-time: [polling, WebSocket, live data]
```


## SECTION PROGRESS TRACKER

**Update this checklist as you rebuild each section. Every box must be ✅ before done.**

### Page Sections (extracted from original SignalGapDetector.tsx)

- [ ] *(Run Step 2 to catalog sections from original page)*

### Charts & Visualizations

- [ ] **line chart** — using shared ChartContainer + component

### Tables

- [ ] **DataTable** with columns: Status, Signal, Last Value, Last Updated, Time Since

### Shared Components Required

- [ ] PageContainer (wrapper with loading/error/empty)
- [ ] StatCard / Metric (for key stats)
- [ ] i18n translations created
- [ ] TanStack Query hook wired
- [ ] Dark mode verified
- [ ] Mobile responsive verified
- [ ] All missing shared components created in components/ BEFORE use

### Infrastructure

- [ ] Route wired in App.tsx with React.lazy
- [ ] Old page deleted from pages/
- [ ] TypeScript compiles (`npx tsc --noEmit`)
- [ ] Docker web image rebuilt and page loads in browser
- [ ] Visual comparison with original — all sections present

**Do NOT skip sections. Check each box only AFTER verifying it exists in the rendered page.**

## Step 3: Check shared component availability

```bash
echo "=== Available shared components ==="
find web/src/components/ -name "*.tsx" | sort

echo ""
echo "=== What this page needs but might not exist ==="
# Compare old page components against shared library
```

For each component the old page used, determine:
- ✅ Shared version exists → use it
- ❌ Shared version missing → create it in Step 4

## Step 4: Create missing shared components FIRST

**Do NOT touch the page file yet.** Create any missing shared components:

```
If old page had gauges/circles   → components/charts/GaugeChart.tsx (if missing)
If old page had sparklines       → components/charts/SparklineChart.tsx (if missing)
If old page had a data table     → verify components/data-display/DataTable.tsx exists
If old page had a timeline       → verify components/data-display/Timeline.tsx exists
If old page had toggle/switch    → verify components/ui/Toggle.tsx exists
If old page had tabs             → verify components/ui/Tabs.tsx exists
If old page had modals           → verify components/ui/Modal.tsx exists
If old page had status badges    → verify components/ui/StateBadge.tsx exists
If old page had map              → verify components/maps/MapContainer.tsx exists
If old page had date picker      → verify components/forms/DateRangePicker.tsx exists
```

For each new component:
- Create in correct `components/` subdirectory
- Add to barrel `index.ts`
- forwardRef + className via cn() + dark mode
- Basic test

## Step 5: Rebuild the page

Now rewrite `web/src/features/telemetry/pages/SignalGapDetectorPage.tsx`:

**RULES:**
- Must have ALL sections from the Step 2 checklist
- Must use PageContainer as wrapper
- Must use TanStack Query hooks (from api/hooks/) — NO fetch/useEffect
- Must use useTranslation() — NO hardcoded strings  
- Must use ONLY shared components — NO raw HTML
- Must handle: loading, error, empty states
- Must be similar line count to original (199 lines ± 30%)

## Step 6: Verify — COMPLETION DEFINITION

```bash
OLD_FILE="/tmp/old_SignalGapDetector.tsx"
NEW_FILE="web/src/features/telemetry/pages/SignalGapDetectorPage.tsx"

echo "=== Line count ==="
echo "Old: $(wc -l < $OLD_FILE) lines"
echo "New: $(wc -l < $NEW_FILE) lines"

echo ""
echo "=== Component usage count ==="
echo "Old components: $(grep -c '<[A-Z]' $OLD_FILE)"
echo "New components: $(grep -c '<[A-Z]' $NEW_FILE)"

echo ""
echo "=== Quality checks ==="
RAW=$(grep -c '<button \|<input \|<table \|<select ' "$NEW_FILE" 2>/dev/null)
echo "Raw HTML: $RAW (must be 0)"

FETCH=$(grep -c 'fetch(\|useEffect.*set' "$NEW_FILE" 2>/dev/null)
echo "Old fetch: $FETCH (must be 0)"

ANY=$(grep -c ': any' "$NEW_FILE" 2>/dev/null)
echo "any types: $ANY (must be 0)"

grep -q 'PageContainer' "$NEW_FILE" && echo "PageContainer: ✅" || echo "PageContainer: ❌"
grep -q 'useTranslation' "$NEW_FILE" && echo "i18n: ✅" || echo "i18n: ❌"

echo ""
echo "=== Build ==="
cd web && npx tsc --noEmit && echo "✅ TS OK" || echo "❌ TS FAIL"
cd ..
```



## Step 7: Build and run in local Docker

```bash
# Rebuild web image with the updated page
docker build -f deploy/docker/Dockerfile.web -t teslasync-web:refactor ./web

# Restart just the web container
docker compose up -d web

# Wait for it
sleep 5

# Verify web UI loads
curl -sf http://localhost:3000/ && echo "✅ Web UI alive" || echo "❌ Web UI failed"

# Open in browser and visually verify this page:
echo "👉 Open http://localhost:3000 and navigate to the page you just fixed"
echo "👉 Compare with the original — does it have ALL sections, charts, cards?"
echo "👉 Check: loading state (refresh with throttled network)"
echo "👉 Check: dark mode (toggle if available)"
echo "👉 Check: mobile view (resize browser to 375px width)"
```

**The page must LOOK complete in the browser — not just compile.**

**COMPLETION DEFINITION — ALL must be true:**
- [ ] New page line count is ≥ 70% of old page (199 lines → minimum 139 lines)
- [ ] New page component count ≥ old page component count
- [ ] Raw HTML count = 0
- [ ] fetch/useEffect for data = 0
- [ ] any types = 0
- [ ] PageContainer = ✅
- [ ] i18n = ✅
- [ ] TypeScript compiles
- [ ] All sections from Step 2 checklist are ✅

**If ANY check fails → fix before saying done. Paste the verification output.**
