---
description: "Fix 37 pages with raw HTML — replace with shared components from components/"
---

# Fix Raw HTML in 37 Pages — Replace with Shared Components

## ⛔ THESE PAGES WERE MOVED, NOT MIGRATED. FIX THEM NOW.

**Branch:** `refactor/full-rewrite`

The audit found 37 pages that still use raw HTML elements (`<button>`, `<input>`, `<table>`,
`<select>`, `<textarea>`) instead of shared components. This means they were `git mv`'d
(renamed) but NOT rewritten to use the component library.

**Process each page ONE AT A TIME. Verify after EACH page. Do NOT batch.**

---

## Replacement Rules

```
RAW HTML                              REPLACE WITH
────────                              ────────────
<button ...>                      →   import { Button } from '@/components/ui'
<button> with just icon           →   import { IconButton } from '@/components/ui'
<input type="text" ...>           →   import { Input } from '@/components/ui'
<input type="checkbox" ...>       →   import { Checkbox } from '@/components/ui'
<input type="number" ...>         →   import { NumberInput } from '@/components/forms'
<select ...>                      →   import { Select } from '@/components/ui'
<textarea ...>                    →   import { Input } from '@/components/ui' (multiline prop)
<table ...>                       →   import { DataTable } from '@/components/data-display'
<div class="card...">             →   import { Card } from '@/components/ui'
<div class="modal...">            →   import { Modal } from '@/components/ui'
<div class="badge...">            →   import { Badge } from '@/components/ui'
<div class="spinner/loading...">  →   import { Spinner } from '@/components/feedback'
<div class="empty...">            →   import { EmptyState } from '@/components/feedback'
<div class="alert/banner...">     →   import { Banner } from '@/components/feedback'
<div class="tabs...">             →   import { Tabs } from '@/components/ui'
<div class="toggle/switch...">    →   import { Toggle } from '@/components/ui'
```

---

## Pages to Fix (37 total)

Process in this order, one at a time:

```
 1. APIKeysPage.tsx
 2. ApiLogsPage.tsx
 3. BackupRestorePage.tsx
 4. DevToolsPage.tsx
 5. FleetAPIPage.tsx
 6. SecurityAccessPage.tsx
 7. ComparePage.tsx
 8. BatteryCellsPage.tsx
 9. BatteryDegradationPage.tsx
10. BatteryHealthPage.tsx
11. EnergyFlowPage.tsx
12. EnergyPage.tsx
13. ProjectedRangePage.tsx
14. SleepEfficiencyPage.tsx
15. VampireDrainPage.tsx
16. GeofencesPage.tsx
17. AlertsPage.tsx
18. AlertStudioPage.tsx
19. NotificationsPage.tsx
20. SettingsPage.tsx
21. ChatbotPage.tsx
22. CommandsPage.tsx
23. DataExportPage.tsx
24. DataRepairPage.tsx
25. DBHealthPage.tsx
26. StateMachineDebuggerPage.tsx
27. LiveSignalMonitorPage.tsx
28. SignalDiffPage.tsx
29. SignalExplorerPage.tsx
30. SignalGapDetectorPage.tsx
31. SignalLogViewerPage.tsx
32. ClimateControlPage.tsx
33. MediaPlayerPage.tsx
34. SafetySettingsPage.tsx
35. SoftwareUpdatesPage.tsx
36. TirePressurePage.tsx
37. VehicleDetailPage.tsx
```

---

## For EACH Page — Follow This Exact Process

### Step 1: Find the raw HTML

```bash
PAGE="[PageName]Page.tsx"
FILEPATH=$(find web/src/features/ -name "$PAGE")
echo "=== Raw HTML in $PAGE ==="
grep -n "<button\|<input\|<table\|<select\|<textarea" "$FILEPATH"
```

### Step 2: Replace each raw element with the shared component

- Read the raw HTML — understand what props it has (onClick, className, value, onChange, etc.)
- Import the matching shared component
- Replace the raw HTML with the shared component, mapping props correctly
- Preserve ALL existing behavior (click handlers, values, disabled states, etc.)

**Example:**
```tsx
// BEFORE (raw HTML)
<button 
  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
  onClick={() => handleRefresh()}
  disabled={isLoading}
>
  Refresh Data
</button>

// AFTER (shared component)
<Button 
  variant="primary"
  onClick={() => handleRefresh()}
  loading={isLoading}
>
  {t('actions.refresh')}
</Button>
```

```tsx
// BEFORE (raw table)
<table className="min-w-full divide-y">
  <thead><tr><th>Name</th><th>Value</th></tr></thead>
  <tbody>{data.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.value}</td></tr>)}</tbody>
</table>

// AFTER (shared DataTable)
<DataTable
  columns={[
    { key: 'name', header: t('columns.name'), render: (row) => row.name },
    { key: 'value', header: t('columns.value'), render: (row) => row.value },
  ]}
  data={data}
  keyExtractor={(row) => row.id}
/>
```

### Step 3: Verify this page is clean

```bash
RAW=$(grep -c "<button \|<input \|<table \|<select \|<textarea " "$FILEPATH" 2>/dev/null)
echo "$PAGE: raw HTML count = $RAW"
if [ "$RAW" -eq 0 ]; then
  echo "✅ CLEAN"
else
  echo "❌ STILL HAS $RAW raw elements — fix them"
fi
```

### Step 4: Verify build still works

```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
if [ $? -eq 0 ]; then echo "✅ TS OK"; else echo "❌ TS ERRORS — fix before next page"; fi
cd ..
```

### Step 5: Commit this page

```bash
git add -A
git commit -m "fix: replace raw HTML in $PAGE with shared components [N/37]"
```

### Step 6: Move to next page. Do NOT stop until all 37 are done.

---

## After ALL 37 Pages Fixed — Final Verification

```bash
echo "========================================="
echo "  FINAL RAW HTML AUDIT"
echo "========================================="

TOTAL_RAW=0
FAILING=""

for f in $(find web/src/features/ -name "*Page.tsx" | sort); do
  NAME=$(basename "$f")
  RAW=$(grep -c "<button \|<input \|<table \|<select \|<textarea " "$f" 2>/dev/null)
  if [ "$RAW" -gt 0 ]; then
    TOTAL_RAW=$((TOTAL_RAW + RAW))
    FAILING="$FAILING\n  ❌ $NAME ($RAW raw elements)"
  fi
done

if [ "$TOTAL_RAW" -eq 0 ]; then
  echo "✅ ALL 72 PAGES CLEAN — zero raw HTML elements"
else
  echo "❌ STILL HAVE $TOTAL_RAW raw HTML elements:"
  echo -e "$FAILING"
  echo ""
  echo "GO BACK AND FIX THESE BEFORE CLAIMING DONE."
fi

echo ""
echo "=== Build check ==="
cd web && npx tsc --noEmit && echo "✅ TypeScript OK" || echo "❌ TS FAIL"
npm run build 2>&1 | tail -3
[ $? -eq 0 ] && echo "✅ Build OK" || echo "❌ Build FAIL"
cd ..
```

**Paste the output. Raw HTML count MUST be 0. Build MUST pass.**

**Do NOT say "done" unless the final audit shows "ALL 72 PAGES CLEAN."**
